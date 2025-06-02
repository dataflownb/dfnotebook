"""Replacements for ipykernel.displayhook."""

import sys

from ipykernel.displayhook import ZMQShellDisplayHook as ipyZMQShellDisplayHook
from ipykernel.displayhook import ZMQDisplayHook
from ipykernel.jsonutil import encode_images, json_clean

from .dflink import LinkedResult

# Updated to consider format_dict/md_dict as a dictionary of dictionaries
# This allows us to follow the original code, adding loops
# to handle multiple outputs

class ZMQShellDisplayHook(ipyZMQShellDisplayHook):
    def get_execution_count(self):
        raise NotImplementedError()

    def write_output_prompt(self, tag=None):
        self.msg["content"]["execution_count"] = self.get_execution_count()

    @property
    def prompt_count(self):
        return self.shell.uuid

    def update_dataflow_ns(self, result):
        self.shell.dataflow_state.remove_links(result.__uuid__)
        for res_tag in result.keys():
            self.shell.dataflow_state.add_link(res_tag, result.__uuid__)

    # from IPython.core.displayhook
    def compute_format_data(self, result):
        # we assume we either get a LinkedResult or a "normal" result
        format_dicts = {}
        md_dicts = {}
        if not isinstance(result, LinkedResult):
            # make non-linked result look like a linked result
            result = {None: result}
        for i, (res_tag, res) in enumerate(result.items()):
            format_dict, md_dict = super().compute_format_data(res)
            if res_tag is not None:
                md_dict["output_tag"] = res_tag
            format_dicts[i] = format_dict
            md_dicts[i] = md_dict
        return format_dicts, md_dicts

    # from ipykernel.ipykernel.displayhook
    def write_format_data(self, format_dicts, md_dicts=None):
        if self.msg:
            new_format_dicts = {}
            for i, format_dict in format_dicts.items():
                new_format_dicts[i] = json_clean(encode_images(format_dict))
            self.msg["content"]["data"] = new_format_dicts
            self.msg["content"]["metadata"] = md_dicts

    # from ipykernel.ipykernel.displayhook
    def finish_displayhook(self):
        """Finish up all displayhook activities."""
        sys.stdout.flush()
        sys.stderr.flush()
        if self.msg and self.msg["content"]["data"] and self.session:
            format_dicts = self.msg["content"]["data"]
            md_dicts = self.msg["content"]["metadata"]            
            for i, format_data in format_dicts.items():
                self.msg["content"]["data"] = format_data
                self.msg["content"]["metadata"] = md_dicts.get(i, None)
                self.session.send(self.pub_socket, self.msg, ident=self.topic)
        self.msg = None

    # from IPython.core.displayhook
    # updated to remove underscore refs
    def update_user_ns(self, result):
        # Avoid recursive reference when displaying _oh/Out
        # not sure this is triggered
        if isinstance(result, LinkedResult):
            self.update_dataflow_ns(result)
        if self.cache_size and result is not self.shell.user_ns["_oh"]:
            if len(self.shell.user_ns["_oh"]) >= self.cache_size and self.do_full_cache:
                self.cull_cache()

    # from IPython.core.displayhook
    # updated to clear df namespace, not underscore refs
    def flush(self):
        # without this, we get an error upon exit since the prompt_count is not an int
        if not self.do_full_cache:
            raise ValueError(
                "You shouldn't have reached the cache flush "
                "if full caching is not enabled!"
            )

        self.shell.user_ns.clear()

        import gc
        # TODO: Is this really needed?
        # IronPython blocks here forever
        if sys.platform != "cli":
            gc.collect()

    def cull_cache(self):
        # FIXME need to decide what to do here
        # due to the dataflow, we can't necessarily remove
        # whatever we feel like here...
        pass

