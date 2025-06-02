import asyncio
from collections import defaultdict
from functools import partial
import ipykernel.ipkernel
from ipykernel.ipkernel import *
from tokenize import TokenError

"""The IPython kernel implementation"""

import ast
import sys
import time
import inspect

from traitlets import Type
from ipykernel.jsonutil import json_clean

from ipykernel.comm import Comm
from IPython import get_ipython

try:
    from IPython.core.interactiveshell import _asyncio_runner
except ImportError:
    _asyncio_runner = None

from .zmqshell import ZMQInteractiveShell
from dfnbutils import (
    ground_refs,
    convert_dollar,
    convert_identifier,
    ref_replacer,
    identifier_replacer,
    dollar_replacer,
    dollar_disp_replacer,
    dollar_disp_no_tag_replacer,
)


def _accepts_cell_id(meth):
    parameters = inspect.signature(meth).parameters
    cid_param = parameters.get("cell_id")
    return (cid_param and cid_param.kind == cid_param.KEYWORD_ONLY) or any(
        p.kind == p.VAR_KEYWORD for p in parameters.values()
    )


class IPythonKernel(ipykernel.ipkernel.IPythonKernel):
    shell_class = Type(ZMQInteractiveShell)
    execution_count = None

    def __init__(self, **kwargs):
        super(IPythonKernel, self).__init__(**kwargs)
        self.shell.displayhook.get_execution_count = lambda: int(
            self.execution_count, 16
        )
        self.shell.display_pub.get_execution_count = lambda: int(
            self.execution_count, 16
        )
        self.comm_manager.register_target('dfcode', self.dfcode_comm)
        
        # # first use nest_ayncio for nested async, then add asyncio.Future to tornado
        # nest_asyncio.apply()
        # # from maartenbreddels: https://github.com/jupyter/nbclient/pull/71/files/a79ae70eeccf1ab8bdd28370cd28f9546bd4f657
        # # If tornado is imported, add the patched asyncio.Future to its tuple of acceptable Futures"""
        # # original from vaex/asyncio.py
        # if 'tornado' in sys.modules:
        #     import tornado.concurrent
        #     if asyncio.Future not in tornado.concurrent.FUTURES:
        #         tornado.concurrent.FUTURES = tornado.concurrent.FUTURES + (
        #         asyncio.Future,)

    @property
    def df_controller(self):
        return self.shell.df_controller

    @property
    def execution_count(self):
        # return self.shell.execution_count
        return self.shell.uuid

    @execution_count.setter
    def execution_count(self, value):
        # Ignore the incrememnting done by KernelBase, in favour of our shell's
        # execution counter.
        pass
    
    def dfcode_comm(self, comm, msg):
        @comm.on_msg
        def _recv(msg):
            try:
                dfMetadata = msg['content']['data']['dfMetadata']
                update_executed_code = msg['content']['data'].get('updateExecutedCode', False)
                tag_remap = msg['content']['data'].get('tagRemap', {})
                use_tags = msg['content']['data'].get('useTags', False)

                cell_data_dict = self.update_code_cells(dfMetadata['cell_data_dict'], update_executed_code, 
                    use_tags=use_tags, tag_remap=tag_remap)
                comm.send({'cell_data_dict': cell_data_dict})
            except Exception as e:
                self.log.error('Error in conversion')
                self.log.error(e)
                comm.send({'error': str(e)})
            finally:
                comm.close()

    def convert_code(self, code, uuid, use_tags=False, input_refs=None, tag_remap={}):
        if use_tags:
            disp_replacer = dollar_disp_replacer
        else:
            disp_replacer = dollar_disp_no_tag_replacer
        persistent_code = code
        
        dollar_converted = False
        orig_code = code
        parsed_code = ''
        new_input_refs = {}

        try:
            code = convert_dollar(
                code, self.df_controller, uuid, identifier_replacer, self.df_controller.output_tags,
                input_tags=self.df_controller.input_tags, tag_remap=tag_remap
            )
            dollar_converted = True
            parsed_code = code
            code = ground_refs(
                code, self.df_controller, uuid, identifier_replacer, self.df_controller.input_tags, output_tags=self.df_controller.output_tags,
                cell_refs=input_refs
            )
            persistent_code, new_input_refs = convert_identifier(code, dollar_replacer)
            code, _ = convert_identifier(code, disp_replacer)
            dollar_converted = False
        except SyntaxError as e:
            if dollar_converted:
                code = orig_code
                parsed_code = ''
            pass
        except TokenError as e:
            # ignore this for now, catch it in do_execute
            parsed_code = ''
            pass

        return {
            'persistent_code': persistent_code, 
            'code': code,
            'input_refs': new_input_refs
        }

    def process_cell_data(self, cell_data_dict, use_tags=False):
        for cell_id, cell_data in cell_data_dict.items():
            updated_cell_data = self.convert_code(cell_data.pop('code'), cell_id,
                use_tags=use_tags,
            )
            cell_data_dict[cell_id].update(updated_cell_data)

        self.df_controller.update_cells(cell_data_dict)
        self.df_controller.add_links(self.df_controller.output_tags)


    async def execute_request(self, stream, ident, parent):
        """handle an execute_request"""
        try:
            content = parent["content"]
            code = content["code"]
            silent = content["silent"]
            store_history = content.get("store_history", not silent)
            user_expressions = content.get("user_expressions", {})
            allow_stdin = content.get("allow_stdin", False)
        except:
            self.log.error("Got bad msg: ")
            self.log.error("%s", parent)
            return

        stop_on_error = content.get("stop_on_error", True)

        # grab and remove dfkernel_data from user_expressions
        # there just for convenience of not modifying the msg protocol
        dfkernel_data = user_expressions.pop("__dfkernel_data__", {})
        self.process_cell_data(dfkernel_data['cell_data_dict'], dfkernel_data.get('use_tags', False))
        self.df_controller.reset_did_run()

        self._outer_stream = stream
        self._outer_ident = ident
        self._outer_parent = parent
        self._outer_stop_on_error = stop_on_error
        self._outer_allow_stdin = allow_stdin
        
        res = await self.inner_execute_request(
            code,
            dfkernel_data["uuid"],
            silent,
            store_history,
            user_expressions,
        )

        # print("DONE RUNNING CELL:", dfkernel_data["uuid"])

    async def inner_execute_request(
        self, code, uuid, silent, store_history=True, user_expressions=None
    ):
        stream = self._outer_stream
        ident = self._outer_ident
        parent = self._outer_parent
        stop_on_error = self._outer_stop_on_error
        allow_stdin = self._outer_allow_stdin

        execution_count = int(uuid, 16)

        # FIXME does it make sense to reparent a request?
        metadata = self.init_metadata(parent)

        cell = self.df_controller.cells[uuid]

        # self.log.error(f"DISPLAY CODE: {cell.code} PERSISTENT CODE: {cell.persistent_code}")
        if not silent:
            self._publish_execute_input(cell.code, parent, execution_count)
        else:
            self._publish_execute_input(cell.persistent_code, parent, execution_count)

        # set the executed code to the code we are running
        cell.executed_code = cell.code

        try:
            # no remaps going on here, just persistent code
            code = convert_dollar(
                cell.persistent_code, self.df_controller, uuid, ref_replacer,
                output_tags=self.df_controller.output_tags
            )
        except SyntaxError as e:
            # ignore this for now, catch it in do_execute
            pass
        except TokenError as e:
            # ignore this for now, catch it in do_execute
            pass

        cell_id = (parent.get("metadata") or {}).get("cellId")
        if _accepts_cell_id(self.do_execute):
            reply_content = self.do_execute(
                code,
                uuid,
                # dfkernel_data,
                silent,
                store_history,
                user_expressions,
                allow_stdin,
                cell_id=cell_id,
            )
        else:
            reply_content = self.do_execute(
                code,
                uuid,
                # dfkernel_data,
                silent,
                store_history,
                user_expressions,
                allow_stdin,
            )

        if inspect.isawaitable(reply_content):
            reply_content = await reply_content

        # need to unpack
        reply_content, res = reply_content

        # Flush output before sending the reply.
        sys.stdout.flush()
        sys.stderr.flush()
        # FIXME: on rare occasions, the flush doesn't seem to make it to the
        # clients... This seems to mitigate the problem, but we definitely need
        # to better understand what's going on.
        if self._execute_sleep:
            time.sleep(self._execute_sleep)

        # Send the reply.
        reply_content = json_clean(reply_content)
        metadata = self.finish_metadata(parent, metadata, reply_content)

        reply_msg = self.session.send(
            stream,
            "execute_reply",
            reply_content,
            parent,
            metadata=metadata,
            ident=ident,
        )

        self.log.debug("%s", reply_msg)

        if not silent and reply_msg["content"]["status"] == "error" and stop_on_error:
            self._abort_queues()

        return res

    async def do_execute(
        self,
        code,
        uuid,
        silent,
        store_history=True,
        user_expressions=None,
        allow_stdin=False,
        *,
        cell_id=None,
    ):
        shell = self.shell  # we'll need this a lot here

        self._forward_input(allow_stdin)

        reply_content = {}
        if hasattr(shell, "run_cell_async") and hasattr(shell, "should_run_async"):
            run_cell = partial(
                shell.run_cell_async_override, uuid=uuid, # dfkernel_data=dfkernel_data
            )
            should_run_async = shell.should_run_async
            with_cell_id = _accepts_cell_id(run_cell)
        else:
            should_run_async = lambda cell: False

            # older IPython,
            # use blocking run_cell and wrap it in coroutine
            async def run_cell(*args, **kwargs):
                kwargs["uuid"] = uuid
                # kwargs["dfkernel_data"] = dfkernel_data
                return shell.run_cell(*args, **kwargs)

            with_cell_id = _accepts_cell_id(shell.run_cell)

        res = None
        try:
            # default case: runner is asyncio and asyncio is already running
            # TODO: this should check every case for "are we inside the runner",
            # not just asyncio
            preprocessing_exc_tuple = None
            try:
                transformed_cell = self.shell.transform_cell(code)
            except Exception:
                transformed_cell = code
                preprocessing_exc_tuple = sys.exc_info()

            if (
                _asyncio_runner
                and shell.loop_runner is _asyncio_runner
                and asyncio.get_event_loop().is_running()
                and should_run_async(
                    code,
                    transformed_cell=transformed_cell,
                    preprocessing_exc_tuple=preprocessing_exc_tuple,
                )
            ):
                # print("RUNNING CELL ASYNC:", uuid, file=sys.__stdout__)
                if with_cell_id:
                    coro = run_cell(
                        code,
                        store_history=store_history,
                        silent=silent,
                        transformed_cell=transformed_cell,
                        preprocessing_exc_tuple=preprocessing_exc_tuple,
                        cell_id=cell_id,
                    )
                else:
                    coro = run_cell(
                        code,
                        store_history=store_history,
                        silent=silent,
                        transformed_cell=transformed_cell,
                        preprocessing_exc_tuple=preprocessing_exc_tuple,
                    )
                coro_future = asyncio.ensure_future(coro)

                with self._cancel_on_sigint(coro_future):
                    try:
                        # print("TRYING TO YIELD CORO_FUTURE")
                        res = await coro_future
                    finally:
                        shell.events.trigger("post_execute")
                        if not silent:
                            shell.events.trigger("post_run_cell", res)
            else:
                # runner isn't already running,
                # make synchronous call,
                # letting shell dispatch to loop runners
                if with_cell_id:
                    res = shell.run_cell(
                        code,
                        uuid=uuid,
                        store_history=store_history,
                        silent=silent,
                        cell_id=cell_id,
                    )
                else:
                    res = shell.run_cell(
                        code,
                        uuid=uuid,
                        store_history=store_history,
                        silent=silent,
                    )
        finally:
            self._restore_input()

        if res.error_before_exec is not None:
            err = res.error_before_exec
        else:
            err = res.error_in_exec

        if hasattr(res, "deleted_cells"):
            reply_content["deleted_cells"] = res.deleted_cells
        reply_content["cell_data_dict"] = self.df_controller.cells_to_dict()
        reply_content["df_graph_edges"] = self.df_controller.df_graph_edges

        if res.success:
            reply_content["status"] = "ok"
        else:
            reply_content["status"] = "error"
            reply_content.update(
                {
                    "traceback": shell._last_traceback or [],
                    "ename": str(type(err).__name__),
                    "evalue": str(err),
                }
            )

            # FIXME: deprecated piece for ipyparallel (remove in 5.0):
            e_info = dict(
                engine_uuid=self.ident, engine_id=self.int_id, method="execute"
            )
            reply_content["engine_info"] = e_info

        # Return the execution counter so clients can display prompts
        reply_content["execution_count"] = int(uuid, 16)
        # reply_content['execution_count'] = shell.execution_count - 1

        if "traceback" in reply_content:
            self.log.info(
                "Exception in execute request:\n%s",
                "\n".join(reply_content["traceback"]),
            )

        # At this point, we can tell whether the main code execution succeeded
        # or not.  If it did, we proceed to evaluate user_expressions
        if reply_content["status"] == "ok":
            reply_content["user_expressions"] = shell.user_expressions(
                user_expressions or {}
            )
        else:
            # If there was an error, don't even try to compute expressions
            reply_content["user_expressions"] = {}

        # Payloads should be retrieved regardless of outcome, so we can both
        # recover partial output (that could have been generated early in a
        # block, before an error) and always clear the payload system.
        reply_content["payload"] = shell.payload_manager.read_payload()
        # Be aggressive about clearing the payload because we don't want
        # it to sit in memory until the next execute_request comes in.
        shell.payload_manager.clear_payload()

        return reply_content, res

    def update_code_cells(self, cell_data_dict, update_executed_code=False, use_tags=False,
        tag_remap={}):
        self.df_controller.update_cells(cell_data_dict)


        for cell_id, cell_data in cell_data_dict.items():
            updated_cell_data = self.convert_code(cell_data['code'], cell_id, use_tags, cell_data['input_refs'],
                tag_remap=tag_remap)
            self.df_controller.cells[cell_id].code = updated_cell_data['code']

            if update_executed_code and cell_data['executed_code']:
                updated_executed_cell_data = self.convert_code(cell_data['executed_code'], cell_id, use_tags, cell_data['input_refs'],
                    tag_remap=tag_remap)
                self.df_controller.cells[cell_id].executed_code = updated_executed_cell_data['code']

        return self.df_controller.cells_to_dict()


# This exists only for backwards compatibility - use IPythonKernel instead
class Kernel(IPythonKernel):
    def __init__(self, *args, **kwargs):
        import warnings

        warnings.warn(
            "Kernel is a deprecated alias of dfnotebook.kernel.ipkernel.IPythonKernel",
            DeprecationWarning,
        )
        super(Kernel, self).__init__(*args, **kwargs)