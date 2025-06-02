"""A ZMQ-based subclass of InteractiveShell.
"""

from __future__ import print_function

from ipykernel.zmqshell import *
import ipykernel.zmqshell

import ast
import asyncio
import collections
from functools import partial
import inspect
import nest_asyncio
import sys
import types
from IPython.core import magic_arguments
from IPython.core.interactiveshell import InteractiveShellABC, \
    _assign_nodes, _single_targets_nodes
try:
    from IPython.core.interactiveshell import _asyncio_runner
except ImportError:
    _asyncio_runner = None
from IPython.core.interactiveshell import ExecutionResult, ExecutionInfo
from IPython.core.compilerop import CachingCompiler
from IPython.core.magic import magics_class, Magics, cell_magic, line_magic, \
    needs_local_scope
from IPython.core.history import HistoryManager
from IPython.core.error import InputRejected
from ipykernel.jsonutil import json_clean, encode_images
from dfnotebook.kernel.dflink import LinkedResult
from dfnotebook.kernel.displayhook import ZMQShellDisplayHook
from dfnotebook.kernel.safe_attr import safe_attr
from traitlets import (
    Integer, Instance, Type, Unicode, validate
)
from warnings import warn
from typing import List as ListType, Tuple, Iterable, Optional
from IPython.core.completer import _FakeJediCompletion

from ast import AST
import importlib

from .dataflow import DataflowController, DataflowFunctionManager, \
    DataflowNamespace, DataflowCellException, DataflowState, DuplicateNameError
from .dflink import build_linked_result

# Python 3.10 removed the alias from collections
from collections.abc import Mapping

#-----------------------------------------------------------------------------
# Functions and classes
#-----------------------------------------------------------------------------

class ZMQDisplayPublisher(ipykernel.zmqshell.ZMQDisplayPublisher):
    """A display publisher that publishes data using a ZeroMQ PUB socket."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._add_uuid_hook()

    def uuid_hook(self, msg):
        msg['content']['execution_count'] = self.get_execution_count()
        return msg

    def _add_uuid_hook(self):
        self.register_hook(self.uuid_hook)

    def get_execution_count(self):
        raise NotImplementedError("Should be added by the kernelapp");

@magics_class
class FunctionMagics(Magics):
    @cell_magic
    def func(self, line, cell):
        #FIXME better argument parsing (-i and -o, intelligent split)
        arr = line.split('-o')
        ivars = [v.strip() for v in (arr[0].split(',')
                                     if arr[0].strip() != ""
                                     else [])]
        self.shell.dataflow_function_manager.set_cell_ivars(self.shell.uuid,
                                                            ivars)
        ovars = [v.strip() for v in (arr[1].split(',')
                                     if len(arr) > 1 and arr[1].strip() != ""
                                     else [])]
        self.shell.dataflow_function_manager.set_cell_ovars(self.shell.uuid,
                                                            ovars)
        self.shell.dataflow_function_manager.set_function_body(self.shell.uuid,
                                                               cell)

class nameddict(Mapping):
    def __init__(self, *args, **kwargs):
        self.__raw_mapping__ = {}
        self._fields = []
        self.__field_mapping__ = {}

    def __getattr__(self, item):
        if item in self._fields:
            return self.__field_mapping__[item]
        return getattr(self.__raw_mapping__, item)

    def __getitem__(self, key):
        if key in self._fields:
            return self.__field_mapping__[key]
        return self.__raw_mapping__[key]

    def __iter__(self):
        return iter(self.__raw_mapping__)

    def __len__(self):
        return len(self.__raw_mapping__)

    @staticmethod
    def from_mapping(mapping):
        nd = nameddict()
        nd.__raw_mapping__ = nd
        for key, value in sorted(mapping.items(), key=lambda x: str(x[0])):
            attr = safe_attr(key)
            nd._fields.append(attr)
            nd.__field_mapping__[attr] = value
        return nd

@magics_class
class OutputMagics(Magics):
    @magic_arguments.magic_arguments()
    @magic_arguments.argument(
        '-n', '--names', default="",
        help="""Specify output names."""
    )
    @magic_arguments.argument('expr', nargs='*',
        help="""Expression to output"""
    )

    def display(self, line, local_ns=None):
        args = magic_arguments.parse_argstring(self.display, line)

        names = args.names
        if (names and
                ((names.startswith('"') and names.endswith('"'))
                or (names.startswith("'") and names.endswith("'")))):
            names = names[1:-1]
        names = [x.strip() for x in names.split(',') if x.strip() != ""]

        line = ' '.join(args.expr)

        # follow %time code...
        expr = self.shell.input_transformer_manager.transform_cell(line)
        expr_ast = self.shell.compile.ast_parse(expr)
        expr_ast = self.shell.transform_ast(expr_ast)
        if len(expr_ast.body)==1 and isinstance(expr_ast.body[0], ast.Expr):
            mode = 'eval'
            source = '<display eval>'
            expr_ast = ast.Expression(expr_ast.body[0].value)
        else:
            mode = 'exec'
            source = '<display exec>'
        import sys
        sys.stdout.write("COMPILE CALLED\n")
        sys.stdout.flush()
        code = self.shell.compile(expr_ast, source, mode)
        sys.stdout.write("COMPILE DONE\n")
        sys.stdout.flush()

        glob = self.shell.user_ns
        if mode=='eval':
            try:
                out = eval(code, local_ns, glob)
            except:
                self.shell.showtraceback()
                return
        else:
            try:
                exec(code, local_ns, glob)
            except:
                self.shell.showtraceback()
                return
            out = None

        if isinstance(out, collections.Mapping):
            # wrap out according to names
            # if is dictionary-like
            return build_linked_result(self.shell.uuid,[],False, list(out.items()))
            # return nameddict.from_mapping(out)
        elif isinstance(out, collections.Sequence):
            # wrap out according to names or indicies
            names = [safe_attr(names[i] if i < len(names) else i)
                     for i in range(len(out))]
            return collections.namedtuple('namedtuple', ' '.join(names))(*out)
        else:
            if len(names) < 1:
                names = ['res']
            return collections.namedtuple('namedtuple', ' '.join(names))(out)
        return out

    @needs_local_scope
    @line_magic
    def split_out(self, line, local_ns=None):
        """Takes an output and splits into multiple outputs.
        mapping -> each key-value pair becomes a separate output
        tuple -> each tuple becomes a separate output
        list -> each entry becomes a separate output
        """
        return self.display(line, local_ns)

    @needs_local_scope
    @line_magic
    def name_out(self, line, local_ns=None):
        """Adds names to an output.
        Mirrors split_out except that this makes sense for a single output.
        object -> adds a name to the output
        """
        return self.display(line, local_ns)

# TODO move to its own package
def expr2id(node):
    """Convert ast node to valid python identifier.

    If the expression is just an identifier, return the identifier.
    If the expression contains a function, return the function name.
    If the expression contains an operator, return the name of the operator followed by the subexpressions.
    """
    # print("expr2id", ast.dump(node))
    if isinstance(node, str):
        node = ast.parse(node)
        if len(node.body) != 1:
            raise ValueError("Node should have only one expression")
        if not isinstance(node.body[0], ast.Expr):
            raise ValueError("Node must be an expression")
        node = node.body[0]

    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Num):
        return 'c' # node.n
    elif isinstance(node, ast.Str):
        return 'c' # node.s
    elif isinstance(node, ast.Attribute):
        # concatenate?
        return expr2id(node.value) + "_" + node.attr
    elif isinstance(node, ast.Subscript):
        slice = ""
        if isinstance(node.slice, ast.Index):
            if isinstance(node.slice.value, ast.Num):
                slice = "_{}".format(node.slice.value.n)
            elif isinstance(node.slice.value, ast.Str):
                slice = "_{}".format(node.slice.value.s)
        return expr2id(node.value) + slice
    elif isinstance(node, ast.Index):
        return expr2id(node.value)
    else:
        return 'x'

# FIXME should mix the pprint for seq and dict
# FIXME use normal printer if _fields doesn't exist
def tuple_formatter(arg, p, cycle):
    with p.group(1, '(', ')'):
        for i in range(len(arg)):
            if hasattr(arg, '_fields'):
                p.text(arg._fields[i] + ": ")
            p.pretty(arg[i])
            if i != len(arg) - 1:
                p.text(',')
                p.breakable()


class CellIdTransformer(ast.NodeTransformer):
    def visit_Subscript(self, node):
        super().generic_visit(node)
        if (isinstance(node.value, ast.Name) and
                    node.value.id == "Out" and
                isinstance(node.slice, ast.Index) and
                isinstance(node.slice.value, ast.Name)):
            return ast.copy_location(ast.Subscript(
                value=ast.Name(id=node.value.id, ctx=node.value.ctx),
                slice=ast.Index(value=ast.Str(s=node.slice.value.id)),
                ctx=node.ctx), node)
        return node

class ZMQInteractiveShell(ipykernel.zmqshell.ZMQInteractiveShell):
    """A subclass of InteractiveShell for ZMQ."""

    displayhook_class = Type(ZMQShellDisplayHook)
    display_pub_class = Type(ZMQDisplayPublisher)

    execution_count = Integer(0)
    # UUID passed from notebook interface
    uuid = Unicode(allow_none=True)
    df_controller = Instance(DataflowController)
    dataflow_function_manager = Instance(DataflowFunctionManager)

    def __init__(self, *args, **kwargs):
        if 'user_ns' not in kwargs or kwargs['user_ns'] is None:
            kwargs['user_ns'] = DataflowNamespace()
        super().__init__(*args, **kwargs)

        # stacks to deal with recursion
        # may need to reset these at higher level...
        self.uuid_stack = [] # [None]
        self.result_stack = [] # [None]
        self.execution_count_stack = []
        self.input_tags = {}
        self.max_execution_count = 0

        #FIXME: This is really just a simple fix to turn it on with Kernel boot, but this seems like a bandaid fix
        self.ast_node_interactivity = 'last_expr_or_assign'
        self.ast_transformers.append(CellIdTransformer())
        self.display_formatter.formatters["text/plain"].for_type(tuple, tuple_formatter)

        self.Completer.splitter.delims = self.Completer.splitter.delims.replace('$','')

        self.Completer._old_complete = self.Completer._complete
        def new_complete(self, *, cursor_line, cursor_pos, line_buffer=None,
                      text=None,
                      full_text=None) -> Tuple[
            str, ListType[str], ListType[str], Iterable[_FakeJediCompletion]]:
            print("RUNNING NEW COMPLETE", file=sys.__stdout__)
            if cursor_pos is None:
                cursor_pos = len(line_buffer) if text is None else len(text)

            # if self.use_main_ns:
            #     self.namespace = __main__.__dict__

            # if text is either None or an empty string, rely on the line buffer
            if (not line_buffer) and full_text:
                line_buffer = full_text.split('\n')[cursor_line]
            if not text:
                text = self.splitter.split_line(line_buffer, cursor_pos)

            use_jedi = self.use_jedi
            if '$' in text:
                # only deal with our matchers
                print("ONLY OUR MATCHERS!", file=sys.__stdout__)
                def get_matchers(self):
                    return [*self.custom_matchers]
                self.__class__._old_matchers = self.__class__.matchers
                self.__class__.matchers = property(get_matchers)
                self.use_jedi = False
            else:
                print("NO STAR", file=sys.__stdout__)
            try:
                return self._old_complete(cursor_line=cursor_line, cursor_pos=cursor_pos,
                                                    line_buffer=line_buffer, text=text,
                                                     full_text=full_text)
            finally:
                if '$' in text:
                    self.__class__.matchers = self.__class__._old_matchers
                    self.use_jedi = use_jedi

        self.Completer.__class__._complete = new_complete

        # print("DELIMS:", self.Completer.splitter.delims, file=sys.__stdout__)
        #
        def cell_scope_completer(completer, text):
            print("GOT COMPLETION REQUEST:", completer, text,
                  file=sys.__stdout__)
            results = self.dataflow_state.complete(text, self.input_tags)
            return results
        self.set_custom_completer(cell_scope_completer)


        def cell_exception_handler(shell, etype, value, tb, tb_offset=None):
            stb = shell.InteractiveTB.structured_traceback(
                etype, value, tb, tb_offset=tb_offset)
            self._showtraceback(etype, value, stb[:2] + stb[3:-4] + stb[-1:])
        
        self.set_custom_exc((DataflowCellException,), cell_exception_handler)

        # def duplicate_name_handler(shell, etype, value, tb, tb_offset=None):
        #     retval = shell.InteractiveTB.structured_traceback(
        #         etype, value, tb, tb_offset=tb_offset)
        #     print("DUP NAME:", retval)
        #     new_retval = retval[:-4] + retval[-1:]
        #     print("NEW RETVAL:", new_retval)
        #     return new_retval
        # self.set_custom_exc((DuplicateNameError,), duplicate_name_handler)

    def run_cell_as_execute_request(self, code, uuid, store_history=False, silent=False,
                                    shell_futures=True, update_downstream_deps=False):
        if (
            _asyncio_runner
            and self.loop_runner is _asyncio_runner
            and asyncio.get_event_loop().is_running()
        ):
            res = self.kernel.inner_execute_request(
                code=code,
                uuid=uuid,
                silent=silent,
                store_history=store_history,
            )
            if inspect.isawaitable(res):
                # make this synchronous here for now
                nest_asyncio.apply()
                res = asyncio.get_event_loop().run_until_complete(res)
            return res 
        else:
            raise Exception("FIXME asyncio not enabled")

    def _showtraceback(self, etype, evalue, stb):
        # try to preserve ordering of tracebacks and print statements
        sys.stdout.flush()
        sys.stderr.flush()

        exc_content = {
            u'traceback' : stb,
            u'ename' : str(etype.__name__),
            u'evalue' : str(evalue),
            u'execution_count': self.uuid,
        }

        dh = self.displayhook
        # Send exception info over pub socket for other clients than the caller
        # to pick up
        topic = None
        if dh.topic:
            topic = dh.topic.replace(b'execute_result', b'error')

        exc_msg = dh.session.send(dh.pub_socket, u'error', json_clean(exc_content),
                                  dh.parent_header, ident=topic)

        # FIXME - Once we rely on Python 3, the traceback is stored on the
        # exception object, so we shouldn't need to store it here.
        self._last_traceback = stb

    def init_magics(self):
        super(ZMQInteractiveShell, self).init_magics()
        #self.register_magics(FunctionMagics)
        self.register_magics(OutputMagics)

    # FIXME hack to be notified of change before it happens?
    @validate('uuid')
    def _uuid_to_change(self, proposal):
        # print("UUID TO CHANGE TO", proposal['value'], file=sys.__stdout__)
        if hasattr(sys.stdout, 'get_execution_count'):
            sys.stdout.flush()
        if hasattr(sys.stderr, 'get_execution_count'):
            sys.stderr.flush()
        return proposal['value']

    def push_uuid(self):
        # want self.uuid to be the current uuid at any time (stashing uuid there)
        self.uuid_stack.append(self.uuid)

    def pop_uuid(self):
        self.uuid = self.uuid_stack.pop(-1)

    def parent_uuid(self):
        if len(self.uuid_stack) > 0:
            return self.uuid_stack[-1]
        return None

    def push_execution_count(self):
        # want self.execution_count to be the current execution count at any time (stashing execution_count there)
        self.execution_count_stack.append(self.execution_count)
        # print("PUSH EXECUTION COUNT:", self.execution_count)
        self.execution_count += 1
        self.max_execution_count = max(self.max_execution_count, self.execution_count)

    def pop_execution_count(self):
        self.execution_count = self.execution_count_stack.pop(-1)
        # print("POP EXECUTION COUNT:", self.execution_count)

    def push_result(self):
        # want self.display_hook.exec_result to be current result, but popped to previous...
        # print("PUSHING EXEC RESULT", self.displayhook.exec_result, len(self.result_stack))
        self.result_stack.append(self.displayhook.exec_result)
        # this step is done by run_cell_async
        # self.displayhook.exec_result = result

    def pop_result(self):
        # Reset this so later displayed values do not modify the
        # ExecutionResult
        self.displayhook.exec_result = self.result_stack.pop(-1)
        # print("POPPING DISPLAYHOOK EXEC_RESULT:", self.displayhook.exec_result, len(self.result_stack))

    # execution_count is something
    # run cell, execution_count is incremented in most cases
    # inside, we might call run_cell recursively
    # after recursive call, need to increment execution_count so don't step
    # need to reset self.execution_count to store history correctly

    def run_cell(self, raw_cell, uuid=None, dfkernel_data={},
                 store_history=False, silent=False, shell_futures=True, cell_id=None):
        # set partial on run_cell_async
        # print("RUN CELL:", uuid, self.max_execution_count, self.execution_count)
        self.run_cell_async = partial(self.run_cell_async_override, uuid=uuid, dfkernel_data=dfkernel_data)
        # self.execution_count = int(uuid, 16)
        res = super().run_cell(raw_cell, store_history=store_history, silent=silent, shell_futures=shell_futures,
            cell_id=cell_id)
        # self.max_execution_count = max(self.max_execution_count, self.execution_count)
        # print("DONE:", self.uuid, self.execution_count)
        return res

    async def run_cell_async_override(self, raw_cell: str, store_history=False,
                             silent=False, shell_futures=True, uuid=None,
                             dfkernel_data={},
                             update_downstream_deps=False,
                             *,
                             transformed_cell: Optional[str] = None,
                             preprocessing_exc_tuple: Optional[Any] = None,
                             cell_id=None) -> ExecutionResult:

        code_dict = dfkernel_data.get("code_dict", {})
        output_tags = dfkernel_data.get("output_tags", {})
        auto_update_flags = dfkernel_data.get("auto_update_flags", [])
        force_cached_flags = dfkernel_data.get("force_cached_flags", [])
        # print("CODE_DICT:", code_dict)
        # print("ASYNC RUNNING CELL", uuid, raw_cell)
        # print("RUN_CELL USER_NS:", self.user_ns)
        self._last_traceback = None
        self.execution_count = self.max_execution_count
        old_deps = []

        if store_history:
            self.df_controller.update_codes(code_dict)
            self.df_controller.update_auto_update(auto_update_flags)
            self.df_controller.update_force_cached(force_cached_flags)
            self.dataflow_state.add_links(output_tags)
            # also put the current cell into the cache and force recompute
            if uuid not in code_dict:
                self.df_controller.update_code(uuid, raw_cell)
            if uuid in self.df_controller.value_cache and uuid in self.df_controller.dep_parents:
                old_deps = self.df_controller.all_upstream(uuid)
                for i in list(self.df_controller.dep_parents[uuid]):
                    self.df_controller.remove_dependencies(i,uuid)
                self.df_controller.dep_semantic_parents[uuid] = {}
            self.df_controller.update_flags(
                store_history=store_history,
                silent=silent,
                shell_futures=shell_futures,
                update_downstream_deps=update_downstream_deps)

        result_deleted_cells = self.df_controller.deleted_cells
        self.df_controller.deleted_cells = []

        #FIXME low priority possibly change how these are calculated, this can probably be moved elsewhere
        internalnodes = []
        for node in ast.walk(ast.parse(transformed_cell)):
            if (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)):
                internalnodes.append(node.id)

        # before run_ast_nodes runs, have some code to run, used to be in run_cell
        # but should be able to live in run_ast_nodes...
        # need to use a stack instead of the recursion...

        # BEFORE RUN_AST_NODES CODE
        # # displayhook exec_result changed to reflect recursion
        # old_result = self.displayhook.exec_result
        # self.displayhook.exec_result = result
        # old_uuid = self.uuid
        # self.uuid = uuid
        # self.user_ns._start_uuid(self.uuid)

        self.uuid = uuid
        self.push_result()

        result = await super().run_cell_async(raw_cell,
                                              store_history=store_history,
                                              silent=silent,
                                              shell_futures=shell_futures,
                                              transformed_cell=transformed_cell,
                                              preprocessing_exc_tuple=preprocessing_exc_tuple,
                                              cell_id=cell_id
                                              )

        self.pop_result()
        uuid = self.uuid

        # AFTER RUN_AST_NODES CODE
        # # Reset this so later displayed values do not modify the
        # # ExecutionResult
        # self.displayhook.exec_result = old_result
        # self.uuid = old_uuid
        # self.user_ns._revisit_uuid(self.uuid)

        # print("LAST EXECUTE SUCCEEDED?", self.last_execution_succeeded, self.uuid, uuid, file=sys.__stdout__)

        if not self.last_execution_succeeded:
            for j in self.df_controller.storeditems:
                self.df_controller.remove_dependencies(j['parent'],
                                                                  j['child'])
            result.deleted_cells = result_deleted_cells

        if isinstance(result.result, LinkedResult):
            result.result.__sethist__(self.df_controller)

        self.df_controller.storeditems = []

        if store_history:
            result.execution_count = int(uuid, 16)

        import sys
        # print("LAST EXECUTE SUCCEEDED?", self.last_execution_succeeded, file=sys.__stdout__)
        # sys.stdout.flush()
        if self.last_execution_succeeded:
            if store_history:
                # print("STORING HISTORY", cur_execution_count)
                # print("STORING UPDATE VALUE:", uuid, result)
                self.df_controller.update_value(uuid, result.result)
                self.df_controller.set_not_stale(uuid)

            if store_history:
                cells = []
                nodes = []
                for uid in self.df_controller.sorted_keys():
                    cells.append(uid)
                if uuid in self.df_controller.value_cache:
                    if(self.df_controller.value_cache[uuid] is not None):
                        nodes.append('Out_'+uuid+'')
                    if isinstance(self.df_controller.value_cache[uuid], LinkedResult):
                        nodes = list(self.df_controller.value_cache[uuid].keys())
                result.nodes = nodes
                result.cells = cells
                result.links = self.df_controller.raw_semantic_upstream(uuid)
                result.deleted_cells = self.df_controller.deleted_cells

                result.internal_nodes = internalnodes
                # print("GOT DELETED CELLS:", result.deleted_cells, file=sys.__stdout__)
                self.df_controller.deleted_cells = []

                result.imm_upstream_deps = self.df_controller.get_semantic_upstream(uuid)
                result.all_upstream_deps = self.df_controller.all_upstream(uuid)
                result.update_downstreams = []
                for i in set(self.df_controller.all_upstream(uuid)+old_deps):
                    result.update_downstreams.append({'key':i, 'data':self.df_controller.get_downstream(i)})
                result.imm_downstream_deps = self.df_controller.get_downstream(uuid)
                result.all_downstream_deps = self.df_controller.all_downstream(uuid)

            # run auto_updates
            self.df_controller.run_auto_updates(uuid)
        return result

    # def run_cell(self, raw_cell, store_history=False, silent=False, shell_futures=True,
    #              uuid=None, dfkernel_data={}, update_downstream_deps=False):
    #     """Run a complete IPython cell.
    #
    #     Parameters
    #     ----------
    #     raw_cell : str
    #       The code (including IPython code such as %magic functions) to run.
    #     store_history : bool
    #       If True, the raw and translated cell will be stored in IPython's
    #       history. For user code calling back into IPython's machinery, this
    #       should be set to False.
    #     silent : bool
    #       If True, avoid side-effects, such as implicit displayhooks and
    #       and logging.  silent=True forces store_history=False.
    #     shell_futures : bool
    #       If True, the code will share future statements with the interactive
    #       shell. It will both be affected by previous __future__ imports, and
    #       any __future__ imports in the code will affect the shell. If False,
    #       __future__ imports are not shared in either direction.
    #
    #     Returns
    #     -------
    #     result : :class:`ExecutionResult`
    #     """
    #
    #     code_dict = dfkernel_data.get("code_dict", {})
    #     output_tags = dfkernel_data.get("output_tags", {})
    #     auto_update_flags = dfkernel_data.get("auto_update_flags", [])
    #     force_cached_flags = dfkernel_data.get("force_cached_flags", [])
    #     # print("CODE_DICT:", code_dict)
    #     #print("RUNNING CELL", uuid, raw_cell)
    #     # print("RUN_CELL USER_NS:", self.user_ns)
    #     self._last_traceback = None
    #     old_deps = []
    #
    #     if store_history:
    #         self.df_controller.update_codes(code_dict)
    #         self.df_controller.update_auto_update(auto_update_flags)
    #         self.df_controller.update_force_cached(force_cached_flags)
    #         self.user_ns._add_links(output_tags)
    #         # also put the current cell into the cache and force recompute
    #         if uuid not in code_dict:
    #             self.df_controller.update_code(uuid, raw_cell)
    #         if uuid in self.df_controller.value_cache and uuid in self.df_controller.dep_parents:
    #             old_deps = self.df_controller.all_upstream(uuid)
    #             for i in list(self.df_controller.dep_parents[uuid]):
    #                 self.df_controller.remove_dependencies(i,uuid)
    #             self.df_controller.dep_semantic_parents[uuid] = {}
    #         self.df_controller.update_flags(
    #             store_history=store_history,
    #             silent=silent,
    #             shell_futures=shell_futures,
    #             update_downstream_deps=update_downstream_deps)
    #
    #     info = ExecutionInfo(
    #         raw_cell, store_history, silent, shell_futures)
    #     result = ExecutionResult(info)
    #
    #     result.deleted_cells = self.df_controller.deleted_cells
    #     self.df_controller.deleted_cells = []
    #
    #
    #     if (not raw_cell) or raw_cell.isspace():
    #         self.last_execution_succeeded = True
    #         return result
    #
    #     if silent:
    #         store_history = False
    #
    #     if store_history:
    #         result.execution_count = uuid
    #
    #     def error_before_exec(value):
    #         result.error_before_exec = value
    #         self.last_execution_succeeded = False
    #         return result
    #
    #     self.events.trigger('pre_execute')
    #     if not silent:
    #         self.events.trigger('pre_run_cell')
    #
    #     # If any of our input transformation (input_transformer_manager or
    #     # prefilter_manager) raises an exception, we store it in this variable
    #     # so that we can display the error after logging the input and storing
    #     # it in the history.
    #     preprocessing_exc_tuple = None
    #     try:
    #         # Static input transformations
    #         cell = self.input_transformer_manager.transform_cell(raw_cell)
    #     except SyntaxError:
    #         preprocessing_exc_tuple = sys.exc_info()
    #         cell = raw_cell  # cell has to exist so it can be stored/logged
    #     else:
    #         if len(cell.splitlines()) == 1:
    #             # Dynamic transformations - only applied for single line commands
    #             with self.builtin_trap:
    #                 try:
    #                     # use prefilter_lines to handle trailing newlines
    #                     # restore trailing newline for ast.parse
    #                     cell = self.prefilter_manager.prefilter_lines(cell) + '\n'
    #                 except Exception:
    #                     # don't allow prefilter errors to crash IPython
    #                     preprocessing_exc_tuple = sys.exc_info()
    #
    #     # Store raw and processed history
    #     if store_history:
    #         self.execution_count += 1
    #         # store cur_execution_count because of recursion
    #         cur_execution_count = self.execution_count
    #         # print("STORING INPUTS:", self.execution_count)
    #         self.history_manager.store_inputs(self.execution_count,
    #                                           cell, raw_cell)
    #     if not silent:
    #         self.logger.log(cell, raw_cell)
    #
    #     # Display the exception if input processing failed.
    #     if preprocessing_exc_tuple is not None:
    #         self.showtraceback(preprocessing_exc_tuple)
    #         # if store_history:
    #         #     self.execution_count += 1
    #         return error_before_exec(preprocessing_exc_tuple[2])
    #
    #     # Our own compiler remembers the __future__ environment. If we want to
    #     # run code with a separate __future__ environment, use the default
    #     # compiler
    #     compiler = self.compile if shell_futures else CachingCompiler()
    #
    #     with self.builtin_trap:
    #         # TODO seems that uuid is more appropriate than execution_count here
    #         cell_name = self.compile.cache(cell, uuid)
    #
    #         with self.display_trap:
    #             # Compile to bytecode
    #             try:
    #                 code_ast = compiler.ast_parse(cell, filename=cell_name)
    #             except self.custom_exceptions as e:
    #                 etype, value, tb = sys.exc_info()
    #                 self.CustomTB(etype, value, tb)
    #                 return error_before_exec(e)
    #             except IndentationError as e:
    #                 self.showindentationerror()
    #                 # if store_history:
    #                 #     self.execution_count += 1
    #                 return error_before_exec(e)
    #             except (OverflowError, SyntaxError, ValueError, TypeError,
    #                     MemoryError) as e:
    #                 self.showsyntaxerror()
    #                 # if store_history:
    #                 #     self.execution_count += 1
    #                 return error_before_exec(e)
    #
    #             # Apply AST transformations
    #             try:
    #                 code_ast = self.transform_ast(code_ast)
    #             except InputRejected as e:
    #                 self.showtraceback()
    #                 # if store_history:
    #                 #     self.execution_count += 1
    #                 return error_before_exec(e)
    #
    #             internalnodes = []
    #             for node in ast.walk(code_ast):
    #                 if(isinstance(node,ast.Name) and isinstance(node.ctx,ast.Store)):
    #                     internalnodes.append(node.id)
    #
    #             # Give the displayhook a reference to our ExecutionResult so it
    #             # can fill in the output value.
    #
    #             # displayhook exec_result changed to reflect recursion
    #             old_result = self.displayhook.exec_result
    #             self.displayhook.exec_result = result
    #             old_uuid = self.uuid
    #             self.uuid = uuid
    #             self.user_ns._start_uuid(self.uuid)
    #
    #             # user_ns = copy.copy(self.user_ns)
    #
    #             # Execute the user code
    #             interactivity = "none" if silent else self.ast_node_interactivity
    #             has_raised = self.run_ast_nodes(code_ast.body, cell_name,
    #                                             interactivity=interactivity, compiler=compiler, result=result)
    #
    #             self.last_execution_succeeded = not has_raised
    #
    #             # Reset this so later displayed values do not modify the
    #             # ExecutionResult
    #             self.displayhook.exec_result = old_result
    #             self.uuid = old_uuid
    #             self.user_ns._revisit_uuid(self.uuid)
    #
    #             # self.user_ns = user_ns
    #
    #             if(not self.last_execution_succeeded):
    #                 for j in self.df_controller.storeditems:
    #                     self.df_controller.remove_dependencies(j['parent'],j['child'])
    #
    #             if isinstance(result.result, LinkedResult):
    #                 result.result.__sethist__(self.df_controller)
    #
    #             self.df_controller.storeditems = []
    #             self.events.trigger('post_execute')
    #             if not silent:
    #                 self.events.trigger('post_run_cell')
    #
    #     if not has_raised:
    #         if store_history:
    #             # Write output to the database. Does nothing unless
    #             # history output logging is enabled.
    #             # print("STORING HISTORY", cur_execution_count)
    #             self.history_manager.store_output(cur_execution_count)
    #             # print("STORING UPDATE VALUE:", uuid, result)
    #             self.df_controller.update_value(uuid, result.result)
    #             self.df_controller.set_not_stale(uuid)
    #
    #             # Each cell is a *single* input, regardless of how many lines it has
    #             # self.execution_count += 1
    #
    #         if store_history:
    #             cells = []
    #             nodes = []
    #             for uid in self.df_controller.sorted_keys():
    #                 cells.append(uid)
    #             if uuid in self.df_controller.value_cache:
    #                 if(self.df_controller.value_cache[uuid] is not None):
    #                     nodes.append('Out_'+uuid+'')
    #                 if isinstance(self.df_controller.value_cache[uuid], LinkedResult):
    #                     nodes = list(self.df_controller.value_cache[uuid].keys())
    #             result.nodes = nodes
    #             result.cells = cells
    #             result.links = self.df_controller.raw_semantic_upstream(uuid)
    #             result.deleted_cells = self.df_controller.deleted_cells
    #             self.df_controller.deleted_cells = []
    #             result.internal_nodes = internalnodes
    #
    #             result.imm_upstream_deps = self.df_controller.get_semantic_upstream(uuid)
    #             result.all_upstream_deps = self.df_controller.all_upstream(uuid)
    #             result.update_downstreams = []
    #             for i in set(self.df_controller.all_upstream(uuid)+old_deps):
    #                 result.update_downstreams.append({'key':i, 'data':self.df_controller.get_downstream(i)})
    #             result.imm_downstream_deps = self.df_controller.get_downstream(uuid)
    #             result.all_downstream_deps = self.df_controller.all_downstream(uuid)
    #
    #         # run auto_updates
    #         self.df_controller.run_auto_updates(uuid)
    #
    #
    #     return result

    def get_linked_vars(self, node):
        create_node = True
        append_node = True
        vars = []
        unnamed = []
        if isinstance(node, _assign_nodes):
            asg = node
            if isinstance(asg, ast.Assign) and len(asg.targets) == 1:
                target = asg.targets[0]
            elif isinstance(asg, _single_targets_nodes):
                target = asg.target
            else:
                target = None
            if isinstance(target, ast.Name):
                vars.append(target.id)
            elif isinstance(target, ast.Tuple):
                for elt in target.elts:
                    if not isinstance(elt, ast.Name):
                        vars = []
                        create_node = False
                        break
                    vars.append(elt.id)
            else:
                create_node = False
        elif isinstance(node, ast.Expr):
            append_node = False
            if isinstance(node.value, ast.Tuple):
                asg = node.value
                for outnum, elt in enumerate(asg.elts):
                    if (not isinstance(elt, ast.Name)):
                        unnamed.append((outnum,elt))
                    # FIXME does this always work?
                    # are there cases where we want to just display a variable
                    # that means we are not redefining it? Can we detect that?
                    # probably safer to just print it...
                    # shouldn't do this so much
                    #
                    # elif self.user_ns._is_external_link(elt.id, self.uuid):
                    #     vars = []
                    #     create_node = False
                    #     break
                    else:
                        vars.append(elt.id)
            elif isinstance(node.value, ast.Name):
                elt = node.value
                vars.append(elt.id)
                # FIXME make sure this works
                # if self.user_ns._is_external_link(elt.id, self.uuid):
                #     create_node = False
                # else:
                #     vars.append(elt.id)
            #elif isinstance(node.value, ast.Expr) or isinstance(node.value,ast.Num):
                #unnamed.append((0,node.value))
            else:
                unnamed.append((-1, node.value))
                #create_node = False
        else:
            create_node = False
        return vars, unnamed, create_node, append_node

    async def run_ast_nodes(self, nodelist:ListType[AST], cell_name:str, interactivity='last_expr',
                        compiler=compile, result=None):
        # FIXME remove these lines!
        # import copy
        # orig_nodelist = copy.copy(nodelist)
        # self.push_result(result)
        self.push_execution_count()
        self.push_uuid()

        no_link_vars = []
        auto_add_libs = True # FIXME add a configuration option that sets this
        # FIXME allow closure to be configurable?
        # if so, need to also adjset tb_offset values (should be config option)
        closure = True
        future_elt = False # Flag for determining if there's a __future__ import
        if len(nodelist) > 0 and interactivity == 'last_expr_or_assign':
            keep_last_node = False
            vars, unnamed, create_node, append_node = self.get_linked_vars(nodelist[-1])
            no_link_vars.extend(vars)
            libs = []

            # FIXME async requires 3.8
            # FIXME do we have to execute each line async autowait, too?? ugh
            # FIXME for now, just do last line
            has_await = False
            if sys.version_info > (3, 8):
                def compare(code):
                    is_async = (
                                inspect.CO_COROUTINE & code.co_flags == inspect.CO_COROUTINE)
                    return is_async

                mode = 'exec'
                node = nodelist[-1]
                # for node in nodelist:
                mod = ast.Module([node], [])
                with compiler.extra_flags(
                        getattr(ast, 'PyCF_ALLOW_TOP_LEVEL_AWAIT',
                                0x0) if self.autoawait else 0x0):
                    code = compiler(mod, cell_name, mode)
                    has_await = compare(code)

            if auto_add_libs:
                lnames = []
                new_node_list = []
                for elt in nodelist:
                    if (isinstance(elt, ast.Import) or
                            isinstance(elt,ast.ImportFrom)):
                        if isinstance(elt, ast.ImportFrom) and elt.module == '__future__':
                            import copy
                            if isinstance(future_elt,list):
                                future_elt.append(copy.deepcopy(elt))
                            else:
                                future_elt = [copy.deepcopy(elt)]
                        else:
                            new_node_list.append(elt)
                            for name in elt.names:
                                if name.asname:
                                    lnames.append(name.asname)
                                else:
                                    if '.' in name.name:
                                        lnames.append(name.name.split('.',1)[0])
                                    else:
                                        lnames.append(name.name)
                    else:
                        new_node_list.append(elt)
                nodelist = new_node_list
                if len(lnames) > 0:
                    diff = set(lnames) - set(vars)
                    if len(diff) > 0:
                        if not create_node and isinstance(nodelist[-1], ast.Expr):
                            keep_last_node = True
                        create_node = True
                        append_node = True
                        libs = list(diff)

            if(len(unnamed) <= 1 and len(vars)+len(libs) < 1):
                create_node = False
                # if(len(unnamed) < 1):
                #     closure = False
                if(closure and isinstance(nodelist[-1],ast.Expr)):
                    nnode = ast.Return(nodelist[-1].value)
                    ast.fix_missing_locations(nnode)
                    nodelist[-1] = nnode

            def unnamed_var_tuple(i, output):
                var_name = '[' + self.uuid + ']'
                if i >= 0:
                    var_name += '[' + str(i) + ']'
                return ast.Tuple([ast.Str(var_name), output],ast.Load())
            if create_node:
                keywords = [ast.Tuple([ast.Str(var), ast.Name(var, ast.Load())],ast.Load()) for var in (libs+vars)]
                none_flag = bool(len(vars))
                for out in unnamed:
                    #FIXME: Thought it would make more sense to use _ notation here but this doesn't seem to cause any issues
                    #might be better to double check though to ensure that this is actually fine
                    if(len(unnamed)+len(vars) == 1):
                        keywords.append(unnamed_var_tuple(-1, out[1]))
                    elif(out[0]>=0):
                        keywords.insert(out[0]+len(libs), unnamed_var_tuple(out[0], out[1]))
                    else:
                        keywords.append(unnamed_var_tuple(len(vars),out[1]))

                if keep_last_node:
                    nnode = ast.Expr(ast.Tuple(
                        [ast.Call(ast.Name('_build_linked_result', ast.Load()),
                                 [ast.Str(self.uuid),ast.Tuple([ast.Str(lib) for lib in libs],ast.Load()),ast.NameConstant(none_flag),ast.List(keywords,ast.Load())], [])],
                    ast.Load()))
                else:
                    innercall = ast.Call(ast.Name('_build_linked_result', ast.Load()), [ast.Str(self.uuid),ast.Tuple([ast.Str(lib) for lib in libs],ast.Load()),ast.NameConstant(none_flag),ast.List(keywords,ast.Load())],[])
                    if closure:
                        nnode = ast.Return(innercall)
                    else:
                        nnode = ast.Expr(innercall)

                ast.fix_missing_locations(nnode)
                if isinstance(nodelist[-1],ast.Expr):
                    nodelist[-1] = nnode
                elif append_node:
                    nodelist.append(nnode)
                else:
                    nodelist[-1] = nnode
                # also need to pull off the values so they don't recurse on themselves
            if closure:
                # arguments = (arg * posonlyargs, arg * args, arg
                #              ? vararg, arg * kwonlyargs,
                #              expr * kw_defaults, arg? kwarg, expr * defaults)
                if has_await:
                    # print("HAS AWAIT")
                    closure_expr = ast.Expr(ast.Await(ast.Call(ast.Name("__closure__", ast.Load()), [], [])))
                else:
                    closure_expr = ast.Expr(ast.Call(ast.Name("__closure__", ast.Load()), [], []))
                nodelist = [ast.FunctionDef("__closure__",ast.arguments(posonlyargs=[],args=[],vararg=None,kwonlyargs=[],kw_defaults=[],kwarg=None,defaults=[]),nodelist,[],None),closure_expr]
                if future_elt:
                    nodelist = future_elt + nodelist
                for node in nodelist:
                    ast.fix_missing_locations(node)
            interactivity = 'last_expr'

        # import astor
        # import inspect
        # if sys.version_info > (3, 8):
        #     from ast import Module
        #     def compare(code):
        #         is_async = (
        #                     inspect.CO_COROUTINE & code.co_flags == inspect.CO_COROUTINE)
        #         return is_async

        # print("CALLING RUN AST NODES") # , compiler, astor.to_source(nodelist[0]))
        # for node in orig_nodelist:
        #     # if mode == 'exec':
        #     mod = Module([node], [])
        #     mode = 'exec'
        #     # elif mode == 'single':
        #     # mod = ast.Interactive([node])
        #     with compiler.extra_flags(getattr(ast, 'PyCF_ALLOW_TOP_LEVEL_AWAIT',
        #                                       0x0) if self.autoawait else 0x0):
        #         code = compiler(mod, cell_name, mode)
        #         asy = compare(code)
        #     if (await self.run_code(code, result, async_=asy)):
        #         return True
        #
        # import astor
        # print("CODE")
        # mod = ast.Module(body=nodelist)
        # print(astor.to_source(mod))
        # print("END CODE")
        res = await super().run_ast_nodes(nodelist, cell_name, interactivity, compiler, result)
        # print("DONE WITH AST NODES")
        self.pop_uuid()
        self.pop_execution_count()

        return res

    # def run_code(self, code_obj, result=None):
    #     """Execute a code object.
    #
    #     When an exception occurs, self.showtraceback() is called to display a
    #     traceback.
    #
    #     Parameters
    #     ----------
    #     code_obj : code object
    #       A compiled code object, to be executed
    #     result : ExecutionResult, optional
    #       An object to store exceptions that occur during execution.
    #
    #     Returns
    #     -------
    #     False : successful execution.
    #     True : an error occurred.
    #     """
    #     # Set our own excepthook in case the user code tries to call it
    #     # directly, so that the IPython crash handler doesn't get triggered
    #     old_excepthook, sys.excepthook = sys.excepthook, self.excepthook
    #
    #     # we save the original sys.excepthook in the instance, in case config
    #     # code (such as magics) needs access to it.
    #     self.sys_excepthook = old_excepthook
    #     outflag = True  # happens in more places, so it's easier as default
    #     try:
    #         try:
    #             self.hooks.pre_run_code_hook()
    #             # rprint('Running code', repr(code_obj)) # dbg
    #             # user_global_ns = {}
    #             exec(code_obj, self.user_global_ns, self.user_ns)
    #         finally:
    #             # Reset our crash handler in place
    #             sys.excepthook = old_excepthook
    #     except SystemExit as e:
    #         if result is not None:
    #             result.error_in_exec = e
    #         self.showtraceback(exception_only=True)
    #         warn("To exit: use 'exit', 'quit', or Ctrl-D.", stacklevel=1)
    #     except self.custom_exceptions:
    #         etype, value, tb = sys.exc_info()
    #         if result is not None:
    #             result.error_in_exec = value
    #         # IMPORTANT: tb_offset=2 depends on *every* cell
    #         # being wrapped in a closure
    #         self._showtraceback(etype, value, self.CustomTB(etype, value, tb, tb_offset=2))
    #     except:
    #         if result is not None:
    #             result.error_in_exec = sys.exc_info()[1]
    #         # IMPORTANT: tb_offset=2 depends on *every* cell
    #         # being wrapped in a closure
    #         self.showtraceback(running_compiled_code=True, tb_offset=2)
    #     else:
    #         outflag = False
    #     return outflag

    def init_user_ns(self):
        """Initialize all user-visible namespaces to their minimum defaults.

                Certain history lists are also initialized here, as they effectively
                act as user namespaces.

                Notes
                -----
                All data structures here are only filled in, they are NOT reset by this
                method.  If they were not empty before, data will simply be added to
                therm.
                """
        # This function works in two parts: first we put a few things in
        # user_ns, and we sync that contents into user_ns_hidden so that these
        # initial variables aren't shown by %who.  After the sync, we add the
        # rest of what we *do* want the user to see with %who even on a new
        # session (probably nothing, so they really only see their own stuff)

        # The user dict must *always* have a __builtin__ reference to the
        # Python standard __builtin__ namespace,  which must be imported.
        # This is so that certain operations in prompt evaluation can be
        # reliably executed with builtins.  Note that we can NOT use
        # __builtins__ (note the 's'),  because that can either be a dict or a
        # module, and can even mutate at runtime, depending on the context
        # (Python makes no guarantees on it).  In contrast, __builtin__ is
        # always a module object, though it must be explicitly imported.

        # For more details:
        # http://mail.python.org/pipermail/python-dev/2001-April/014068.html
        ns = {}

        # make global variables for user access to the histories
        ns['_ih'] = self.history_manager.input_hist_parsed
        # ns['_oh'] = self.history_manager.output_hist
        ns['_dh'] = self.history_manager.dir_hist
        ns['_oh'] = self.df_controller
        ns['_func'] = self.dataflow_function_manager

        # user aliases to input and output histories.  These shouldn't show up
        # in %who, as they can have very large reprs.
        ns['In'] = self.history_manager.input_hist_parsed
        # ns['Out'] = self.history_manager.output_hist
        ns['Out'] = self.df_controller
        ns['Func'] = self.dataflow_function_manager
        ns['_build_linked_result'] = build_linked_result
        ns['_ns'] = self.user_ns

        self.dataflow_state = DataflowState(self.df_controller)
        self.user_ns.__df_state__ = self.dataflow_state

        # Store myself as the public api!!!
        ns['get_ipython'] = self.get_ipython

        ns['exit'] = self.exiter
        ns['quit'] = self.exiter

        # Sync what we've added so far to user_ns_hidden so these aren't seen
        # by %who
        self.user_ns_hidden.update(ns)

        # Anything put into ns now would show up in %who.  Think twice before
        # putting anything here, as we really want %who to show the user their
        # stuff, not our variables.

        # Finally, update the real user's namespace
        self.user_ns.update(ns)


    def init_history(self):
        """Sets up the command history, and starts regular autosaves."""
        self.history_manager = HistoryManager(shell=self, parent=self)
        self.df_controller = DataflowController(shell=self)
        self.dataflow_function_manager = \
            DataflowFunctionManager(self.df_controller)
        self.configurables.append(self.history_manager)

    # def prepare_user_module(self, user_module=None, user_ns=None):
    #     print("USER_NS", user_ns, file=sys.__stdout__, flush=True)
    #
    #     return super().prepare_user_module(user_module, user_ns)


InteractiveShellABC.register(ZMQInteractiveShell)
