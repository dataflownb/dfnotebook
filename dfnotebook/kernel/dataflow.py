from collections import defaultdict, namedtuple
from collections.abc import KeysView, ItemsView, ValuesView, MutableMapping
from .dflink import LinkedResult
import itertools

class DataflowCellException(Exception):
    def __init__(self, cid):
        self.cid = cid

    def __str__(self):
        return "Cell '{}' raised an exception".format(self.cid)

class DataflowCacheError(DataflowCellException):
    def __str__(self):
        return "Cell '{}' has not yet been computed".format(self.cid)

class DataflowInvalidRefError(DataflowCellException):
    '''Called when an Invalid OutCell is called'''
    def __str__(self):
        return "Invalid Reference to Cell '{}'".format(self.cid)

class DataflowHistoryManager(object):
    deleted_cells = []
    storeditems = []
    tup_flag = False

    def __init__(self, shell, **kwargs):
        self.shell = shell
        self.flags = dict(kwargs)
        self.auto_update_flags = {}
        self.force_cached_flags = {}
        # self.flags['silent'] = True
        self.clear()

    def update_flags(self, **kwargs):
        self.flags.update(kwargs)
        # self.flags['silent'] = True

    def update_code(self, key, code):        
        # print("CALLING UPDATE CODE", key, code)
        # if code is empty, remove the code_cache, remove links
        if code == '' and key in self.value_cache and key in self.code_cache:
            self.set_stale(key)
            del self.value_cache[key]
            del self.code_cache[key]
            for child in self.all_downstream(key):
                self.remove_dependencies(key, child)
                self.remove_semantic_dependencies(key, child)
            for parent in self.all_upstream(key):
                self.remove_dependencies(key, parent)
                self.remove_semantic_dependencies(key, parent)
            self.shell.dataflow_state.reset_cell(key)
            self.deleted_cells.append(key)
            del self.last_calculated[key]
        elif key not in self.code_cache or self.code_cache[key] != code:
            # clear out the old __links__ and __rev_links__ (if exist)
            self.shell.dataflow_state.reset_cell(key)
            self.func_cached[key] = False
            self.code_cache[key] = code
            self.set_stale(key)
            if key not in self.auto_update_flags:
                self.auto_update_flags[key] = False;
            if key not in self.force_cached_flags:
                self.force_cached_flags[key] = False;

    def update_codes(self, code_dict):
        existing_keys = set(self.code_cache.keys())
        deleted_keys = existing_keys.difference(code_dict.keys())
        for key, val in code_dict.items():
            self.update_code(key, val)
        for key in deleted_keys:
            self.update_code(key, '')

    def update_auto_update(self, flags):
        self.auto_update_flags.update(flags)

    def update_force_cached(self, flags):
        self.force_cached_flags.update(flags)

    def set_stale(self, key):
        self.code_stale[key] = True
        # need to make sure everything downstream also gets set to stale
        for cid in self.all_downstream(key):
            self.code_stale[cid] = True

    def set_not_stale(self, key):
        self.code_stale[key] = False

    def is_stale(self, key):
        return key in self.code_stale and self.code_stale[key]

    def update_value(self, key, value):

        self.value_cache[key] = value
        self.last_calculated[key] = self.last_calculated_ctr
        self.last_calculated_ctr += 1

    def sorted_keys(self):
        return (k2 for (v2, k2) in sorted((v, k) for (k, v) in self.last_calculated.items()))

    def clear(self):
        self.func_cached = {}
        self.code_cache = {}
        self.code_stale = {}
        self.value_cache = {}
        self.last_calculated = {}
        # dependencies are a DAG
        self.dep_parents = defaultdict(set) # child -> list(parent)
        self.dep_children = defaultdict(set) # parent -> list(child)
        self.dep_semantic_parents = defaultdict(dict)
        self.last_calculated_ctr = 0

    def update_dependencies(self, parent, child):
        self.storeditems.append({'parent':parent, 'child':child})
        self.dep_parents[child].add(parent)
        self.dep_children[parent].add(child)
        if parent not in self.dep_semantic_parents[child]:
            self.dep_semantic_parents[child][parent] = set([parent])

    def update_semantic_dependencies(self, parent, child,item=None):
        if item:
            self.dep_semantic_parents[child][parent].add(item)

    def remove_dependencies(self, parent, child):
        self.remove_dep(parent, child, self.dep_parents, self.dep_children)

    def remove_semantic_dependencies(self, parent, child,item=None):
        if parent in self.dep_semantic_parents[child]:
            if item:
                self.dep_semantic_parents[child][parent].discard(item)
            else:
                 self.dep_semantic_parents[child][parent].discard(parent)

    @staticmethod
    def remove_dep(parent, child, parents, children):
        if parent in parents[child]:
            parents[child].remove(parent)
            children[parent].remove(child)


    def all_semantic_upstream(self, k):
        return self.get_all_upstreams(k, True)

    def all_upstream(self, k):
        return self.get_all_upstreams(k, False)


    def get_all_upstreams(self, k, semantic=False):
        visited = set()
        res = set(self.get_semantic_upstream(k)) if semantic else set()
        frontier = list(self.dep_parents[k])
        while frontier:
            cid = frontier.pop(0)
            visited.add(cid)
            if semantic:
                res.update(self.get_semantic_upstream(cid))
            else:
                res.add(cid)
            for pid in self.dep_parents[cid]:
                if pid not in visited:
                    frontier.append(pid)
        return list(res)


    def all_downstream(self, k):
        return self.get_all_downstream(k)

    def get_all_downstream(self, k):
        visited = set()
        res = set()
        frontier = list(self.dep_children[k])
        while frontier:
            cid = frontier.pop(0)
            visited.add(cid)
            res.add(cid)
            for pid in self.dep_children[cid]:
                if pid not in visited:
                    frontier.append(pid)
        return list(res)

    def get_downstream(self, k):
        return list(self.dep_children[k])

    def get_upstream(self, k):
        return list(self.dep_parents[k])

    def get_semantic_upstream(self, k):
        semantic_up = []
        for key in self.dep_semantic_parents[k].keys():
            semantic_up += [key+item for item in self.dep_semantic_parents[k][key]]
        return semantic_up

    def raw_semantic_upstream(self,k):
        return self.dep_semantic_parents[k]

    def update_downstream(self, k):
        # this recurses via run_cell which checks for the update_downstream_deps
        # flag at the end of its run
        for uid in self.dep_children[k]:
            parent_uuid = k
            retval = self.shell.run_cell_as_execute_request(self.code_cache[uid], uid,
                                                            **self.flags)
            # FIXME can we just rely on run_cell?
            self.shell.uuid = parent_uuid
            if not retval.success:
                # FIXME really want to just raise this error and not the bits of the
                # stack that are internal (get_item, etc.)
                retval.raise_error()

    def execute_cell(self, k, **flags):
        # print("EXECUTING CELL", k)
        local_flags = dict(self.flags)
        local_flags.update(flags)
        # print("LOCAL FLAGS:", local_flags)
        for cid in self.dep_parents[k]:
            if cid in self.dep_children[k]:
                raise CyclicalCallError(k)
        child_uuid = self.shell.uuid
        retval = self.shell.run_cell_as_execute_request(self.code_cache[k], k,
                                                   **self.flags)
        # print('retval:', retval)
        self.shell.uuid = child_uuid
        if not retval.success:
            raise DataflowCellException(k)
        # FIXME can we just rely on run_cell?
        return retval.result

    def run_auto_updates(self, k):
        for cid in self.get_downstream(k):
            if self.auto_update_flags[cid]:
                upstreams = self.get_all_upstreams(cid)
                if all(not self.is_stale(upcid) or self.auto_update_flags[upcid]
                       for upcid in upstreams):
                    retval = self.execute_cell(cid)

    def __getitem__(self, k):
        res = self.get_item(k)
        if isinstance(res, LinkedResult):
            if res.__tuple__() is None:
                return res
            return res.__tuple__()
        return res

    def stale_check(self, k):
        if k not in self.code_stale:
            raise DataflowInvalidRefError(k)

    def get_item(self, k):
        self.stale_check(k)
        self.update_dependencies(k, self.shell.uuid)
        # if k in self.value_cache:
        #     print(k, "in cache", self.value_cache[k])

        # force recompute
        if self.force_cached_flags[k]:
            if k not in self.value_cache:
                raise DataflowCacheError(k)
            # print("returning cache", k)
            return self.value_cache[k]

        # check if we need to recompute
        if not self.is_stale(k):
            # print("returning not stale cache", k)
            return self.value_cache[k]
        # print('executing cell', k)
        return self.execute_cell(k)

    def __setitem__(self, key, value):
        class InvalidCellModification(KeyError):
            '''This error results when another cell tries to modify an Out reference'''
        if key == self.shell.uuid:
            self.update_value(key, value)
        else:
            raise InvalidCellModification("Out[" + key + "] can only be modified by it's own cell")

    def get(self, k, default=None):
        try:
            return self.__getitem__(k)
        except KeyError:
            return default

    def __len__(self):
        return len(self.code_cache)

    def __iter__(self):
        return self.code_cache.__iter__()



class DataflowFunction(object):
    def __init__(self, df_f_manager, cell_uuid):
        self.df_f_manager = df_f_manager
        self.cell_uuid = cell_uuid

    def __call__(self, *args, **kwargs):
        # print("CALLING AS FUNCTION!", self.cell_uuid)
        return self.df_f_manager.run_as_function(self.cell_uuid, *args, **kwargs)

class DataflowFunctionManager(object):
    def __init__(self, df_hist_manager):
        self.df_hist_manager = df_hist_manager
        self.clear()

    def clear(self):
        self.cell_ivars = {}
        self.cell_ovars = {}

    def set_cell_ivars(self, uid, ivars):
        self.cell_ivars[uid] = ivars

    def set_cell_ovars(self, uid, ovars):
        self.cell_ovars[uid] = ovars

    def __getitem__(self, k):
        # need to pass vars through to function
        return DataflowFunction(self, k)

    def set_function_body(self, uid, code):
        self.df_hist_manager.code_cache[uid] = code
        self.df_hist_manager.func_cached[uid] = True

    def run_as_function(self, uuid, *args, **kwargs):
        # FIXME use kwargs
        if (uuid not in self.df_hist_manager.func_cached or
                not self.df_hist_manager.func_cached[uuid]):
            # run cell magic
            # print("RUNNING CELL MAGIC")
            self.df_hist_manager.execute_cell(uuid)

        local_args = set()
        for (arg_name, arg) in zip(self.cell_ivars[uuid], args):
            # print("SETTING ARG:", arg_name, arg)
            local_args.add(arg_name)
            self.df_hist_manager.shell.user_ns[arg_name] = arg
        # print("==== USER NS BEFORE ====")
        # for k,v in self.df_hist_manager.shell.user_ns.items():
        #     print(' ', k, ':', v)
        # print("==== USER NS DONE ====")
        retval = self.df_hist_manager.execute_cell(uuid)
        # print("RESULT", retval)
        # print("USER NS:")
        # for k,v in self.df_hist_manager.shell.user_ns.items():
        #     print(' ', k, ':', v)

        # FIXME need to replace variables temporarily and add back
        # or just eliminate this by eliminating globals across cells
        res = {}
        for arg_name in self.cell_ovars[uuid]:
            if arg_name in self.df_hist_manager.shell.user_ns:
                res[arg_name] = self.df_hist_manager.shell.user_ns[arg_name]


        # print("RESULTS:", res)
        ovars = len(self.cell_ovars[uuid])
        if ovars > 1:
            res_cls = namedtuple('Result', self.cell_ovars[uuid])
            return res_cls(**res)
        elif ovars:
            return next(iter(res.values()))
        return retval

class CyclicalCallError(Exception):
    """This error results when the call being made is Cyclical"""
    def __init__(self, cell_id):
        super().__init__(self)
        self.cell_id = cell_id

    def __str__(self):
        return "Out[{}] results in a Cyclical call".format(self.cell_id)

class DuplicateNameError(Exception):
    def __init__(self, var_name, cell_id):
        super().__init__(self)
        self.var_name = var_name
        self.cell_id = cell_id

    def __str__(self):
        return "name '{}' has already been defined in Cell '{}'".format(self.var_name,self.cell_id)

class DataflowState:
    def __init__(self, history):
        self.history = history
        self.links = defaultdict(list)
        self.all_links = defaultdict(set) # most recent is last
        self.rev_links = defaultdict(set)
        self.cur_cell_id = None

    def set_cur_cell_id(self, cell_id):
        self.cur_cell_id = cell_id

    def has_link(self, k):
        return self.has_external_link(k, self.cur_cell_id)
        # return k in self.links

    def get_parent(self, k):
        if not self.has_link(k):
            raise DataflowCellException(f"No cell defines '{k}'")
        # return self.links[k][-1]
        return self.get_external_link(k, self.cur_cell_id)

    get_cell = get_parent

    def get_link(self, k):
        # We should not get here unless the reference is not
        # found during tokenization. This can happen is the function
        # references the globals directly
        # (e.g. pandas query with @var references)
        # If this happens, we need to add it to the beginning of the cell
        # to make sure the reference is explicitly linked to the correct
        # cell_id
        cell_id = self.get_parent(k)
        # rev_links = self.rev_links[cell_id]

        # FIXME want to update the code/something in self.cur_cell_id
        # so that it dumps in a reference at the top of the cell as
        # k = k$cell_id
        # could have preference for setting as k = k$^cell_id
        #
        # self.history.add_deps(self.cur_cell_id, cell_id, k)
        return self.history.get_item(cell_id)[k]

    def add_links(self, output_tags):
        """Used for adding links of pre-existing links currently only used for cold starts"""

        # FIXME really need to store this information in the notebook metadata
        # in order to keep track of this...
        new_tags = set()
        for (cell_id, tag_list) in output_tags.items():
            for tag in tag_list:
                # print("OUTER ADD_LINKS:", cell_id, tag)
                self.add_link(tag, cell_id, make_current=False)
                new_tags.add(tag)
        for tag in new_tags:
            if len(self.all_links[tag]) == 1 and not self.has_current_link(tag):
                # can make current because unambiguous
                cell_id = next(iter(self.all_links[tag]))
                # print('ADDING TAG (ADD_LINKS):', cell_id, tag)
                self.links[tag].append(cell_id)

    def add_link(self, tag, cell_id, make_current=True):
        # print("OUTER ADD_LINK:", cell_id, tag)
        if isinstance(tag, str):
            self.all_links[tag].add(cell_id)
            self.rev_links[cell_id].add(tag)
            if make_current:
                # print('ADDING TAG (ADD_LINK):', cell_id, tag)
                self.links[tag].append(cell_id)

    def reset_cell(self, cell_id):
        # print(f"{cell_id} LINKS: {self.links} REV LINKS: {self.rev_links} ALL_LINKS: {self.all_links}")
        if cell_id in self.rev_links:
            for name in self.rev_links[cell_id]:
                if cell_id in self.links[name]:
                    self.links[name].remove(cell_id)
                self.all_links[name].discard(cell_id)
            del self.rev_links[cell_id]

    def has_current_link(self, k):
        # print("HAS CURRENT LINK:", k, self.links[k])
        return k in self.links and len(self.links[k]) > 0

    def get_current_link(self, k):
        if not self.has_current_link(k):
            raise DataflowCellException(f"No cell defines '{k}'")
        return self.links[k][-1]

    def has_external_link(self, k, cur_id):
        return self.has_current_link(k) and self.get_current_link(k) != cur_id
        # return (k in self.links) and (self.links[k][-1] != cur_id or len(self.links[k]) > 1)

    def get_external_link(self, k, cur_id):
        if not self.has_external_link(k, cur_id):
            raise DataflowCellException(f"No external link to '{k}'")
        for cell_id in reversed(self.links[k]):
            if cell_id != cur_id:
                return cell_id

    def complete(self, text, input_tags={}):
        results = []
        id_start = text
        cell_start = None
        if '$' in text:
            id_start, cell_start = text.split('$',maxsplit=1)
        import sys
        # print(f"COMPLETER INTERNAL: '{id_start}' '{cell_start}'", file=sys.__stdout__)
        for link, cell_ids in self.all_links.items():
            if link.startswith(id_start):
                if cell_start:
                    results.extend(link + '$' + input_tag
                                   for input_tag, cell_id in input_tags.items()
                                   if input_tag.startswith(cell_start) and cell_id in cell_ids)
                    results.extend(link + '$' + cell_id
                                   for cell_id in cell_ids
                                   if cell_id.startswith(cell_start))
                else:
                    if cell_start is None:
                        results.append(link)
                    results.extend(link + '$' + input_tag for input_tag, cell_id in input_tags.items() if cell_id in cell_ids)
                    results.extend(link + '$' + cell_id for cell_id in cell_ids)
        return results

    def clear(self):
        self.links.clear()
        self.all_links.clear()
        self.rev_links.clear()

class DataflowNamespace(dict):
    def clear(self):
        super().clear()
        self.__df_state__.clear()