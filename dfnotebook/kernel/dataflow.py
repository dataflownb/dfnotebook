from collections import defaultdict, namedtuple, deque
from collections.abc import KeysView, ItemsView, ValuesView, MutableMapping
from .dflink import LinkedResult
import itertools

class DataflowCellException(Exception):
    def __init__(self, cid):
        self.cid = cid

    def __str__(self):
        return "Cell(s) '{}' raised an exception".format(self.cid)

class DataflowCacheError(DataflowCellException):
    def __str__(self):
        return "Cell '{}' has not yet been computed".format(self.cid)

class DataflowInvalidRefError(DataflowCellException):
    '''Called when an Invalid OutCell is called'''
    def __str__(self):
        return "Invalid Reference to Cell '{}'".format(self.cid)

class InvalidCellModification(KeyError):
    '''This error results when another cell tries to modify an Out reference'''
    pass

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

class DataflowGraph(object):
    def __init__(self):
        self.clear()

    def clear(self):
        self.parents = defaultdict(set) # child -> set(parent)
        self.children = defaultdict(set) # parent -> set(child)

    def remove_node(self, node):
        self.remove_all_parents(node)
        self.remove_all_children(node)

    def add_edge(self, parent, child=None):
        self.parents[child].add(parent) 
        self.children[parent].add(child) 

    def remove_edge(self, parent, child=None):
        self.parents[child].discard(parent)
        self.children[parent].discard(child)

    def remove_all_children(self, parent):
        for child in self.children[parent]:
            self.parents[child].discard(parent)
        del self.children[parent]

    def remove_all_parents(self, child):
        for parent in self.parents[child]:
            self.children[parent].discard(child)
        del self.parents[child]

    def has_cycle(self):
        in_degree = {cid: len(pids) for cid, pids in self.parents.items() if len(pids) > 0} 
        frontier = deque([pid for pid in self.children if pid not in in_degree])

        count = -len(frontier)
        while frontier:
            pid = frontier.popleft()
            count += 1
            for cid in self.children[pid]:
                in_degree[cid] -= 1
                if in_degree[cid] == 0:
                    frontier.append(cid)

        return count != len(in_degree)

    def downstream(self, k):
        visited = set()
        res = set()
        frontier = deque(self.children[k])
        while frontier:
            pid = frontier.popleft()
            visited.add(pid)
            res.add(pid)
            for cid in self.children[pid]:
                if cid not in visited:
                    frontier.append(cid)
        return res
    descendants = downstream

    def upstream(self, k):
        visited = set()
        res = set()
        frontier = deque(self.parents[k])
        while frontier:
            cid = frontier.popleft()
            visited.add(cid)
            res.add(cid)
            for pid in self.parents[cid]:
                if pid not in visited:
                    frontier.append(pid)
        return res
    ancestors = upstream

    def edge_list(self):
        return [ [parent, child]
            for parent, children in self.children.items()
            for child in children
        ]

class DataflowCell:
    def __init__(self, cell_id, **kwargs):
        self.cell_id = cell_id
        self.code = None
        self.persistent_code = None
        self.input_refs = {}
        self.output_tags = set()
        self.name = None
        self.executed_code = None
        self.result = None
        self.is_stale = True
        self.count = -1
        self.is_running = False
        self.did_run = False
        self.update(**kwargs)

    def update(self, **kwargs):
        was_changed = False
        self.code = kwargs.get('code', None)
        self.name = kwargs.get('name', None)
        self.executed_code = kwargs.get('executed_code', None)
        self.input_refs = kwargs.get('input_refs', {})
        self.output_tags = set(kwargs.get('output_tags', []))
        self.auto_update = kwargs.get('auto_update', False)
        self.force_cached = kwargs.get('force_cached', False)

        # only update if passed in and different...
        new_persistent_code = kwargs.get('persistent_code', None)
        if new_persistent_code is not None and new_persistent_code != self.persistent_code:
            self.persistent_code = new_persistent_code
            self.is_stale = True
            self.result = None
            self.output_ids = set()
            was_changed = True
        return was_changed

    def to_dict(self):
        return {
            'cell_id': self.cell_id,
            'name': self.name, # could be none...
            'code': self.code,
            'persistent_code': self.persistent_code, # could be none if error?
            'executed_code': self.executed_code, # could be none if error?
            'input_refs': {cell_id: list(refs) for cell_id, refs in self.input_refs.items()},
            'output_tags': list(self.output_tags),
        }

    def reset_did_run(self):
        self.did_run = False

    def set_running(self):
        self.is_running = True

    # FIXME unify with add_link?
    # question is whether we should set output_tags if there is an error
    # does add_link only run if the cell is successful? think so...
    def set_output_tags_from_result(self):
        if not isinstance(self.result, LinkedResult):
            self.output_tags = set()
        else:
            self.output_tags = {res_tag for res_tag in self.result if res_tag is not None}

    def set_result(self, result):
        self.result = result
        self.set_output_tags_from_result()
        self.is_stale = False
        self.is_running = False
        self.did_run = True

    def set_failed(self):
        self.result = None
        self.is_stale = True
        self.is_running = False
        self.did_run = True

    def should_use_cached(self):
        return self.force_cached or not self.is_stale

class DataflowController(object):
    def __init__(self, shell, **kwargs):
        self.shell = shell
        self.flags = dict(kwargs)
        self.clear()

    def clear(self):
        self.graph = DataflowGraph()
        self.links = DataflowLinks()
        self.cells = {}
        self.deleted_cells = []
        
    @property
    def exec_cell_id(self):
        return self.shell.uuid

    @exec_cell_id.setter
    def exec_cell_id(self, cell_id):
        self.shell.uuid = cell_id

    @property
    def output_tags(self):
        output_tags = defaultdict(set)
        for cell_id, cell in self.cells.items():
            for tag in cell.output_tags:
                output_tags[tag].add(cell_id)
        return dict(output_tags)

    @property
    def cell_names(self):
        return {cell_id: cell.name for cell_id, cell in self.cells.items() if cell.name is not None}
    input_tags = cell_names

    @property
    def cell_names_inv(self):
        return {cell.name: cell_id for cell_id, cell in self.cells.items() if cell.name is not None}

    @property
    def df_graph_edges(self):
        return self.graph.edge_list()

    def update_flags(self, **kwargs):
        self.flags.update(kwargs)
        # self.flags['silent'] = True

    def update_cells(self, cells):
        found = set()

        # add or update cells in the notebook
        for cid, cell in cells.items():
            found.add(cid)
            if cid not in self.cells:
                self.cells[cid] = DataflowCell(**cell)
            else:
                was_changed = self.cells[cid].update(**cell)
                if was_changed:
                    self.remove_links(cid)
                    self.set_downstream_stale(cid)

        # remove any cells that are no longer in notebook
        for cid, cell in self.cells.items():
            if cid not in found:
                self.deleted_cells.append(cid)
        for cid in self.deleted_cells:
            self.graph.remove_node(cid)
            self.links.remove_links(cid)
            del self.cells[cid]

    def cells_to_dict(self):
        return {cid: cell.to_dict() for cid, cell in self.cells.items()}

    def execute_cell(self, cid, **flags):
        if cid not in self.cells:
            raise DataflowInvalidRefError(cid)
        cell = self.cells[cid]

        if cell.should_use_cached():
            return cell.result

        if self.graph.has_cycle():
            raise CyclicalCallError(cid)
        
        local_flags = dict(self.flags)
        local_flags.update(flags)
        cur_cell_id = self.exec_cell_id
        retval = self.shell.run_cell_as_execute_request(cell.persistent_code, cid, **local_flags)
        self.exec_cell_id = cur_cell_id

        if not retval.success:
            raise DataflowCellException(cid)
        return retval.result

    def set_running(self, cid):
        self.cells[cid].set_running()

    def reset_did_run(self):
        for cell in self.cells.values():
            cell.reset_did_run()

    def downstream_update(self, pid):
        errs = []
        visited = set()
        for cid in self.graph.downstream(pid):
            if cid in visited:
                continue
            visited.add(cid)
            cell = self.cells[cid]

            if cell.is_running:
                continue

            wait_to_run = False
            for pcid in self.graph.upstream(cid):
                if self.cells[pcid].is_running:
                    wait_to_run = True
            if wait_to_run:
                continue
            if cell.did_run:
                continue

            if cell.auto_update:
                try:
                    retval = self.execute_cell(cid)
                except DataflowCellException as e:
                    errs.append(e.cid)
        if len(errs) > 0:
            raise DataflowCellExecption(errs)
        
    def set_downstream_stale(self, pid):
        for cid in self.graph.downstream(pid):
            self.cells[cid].is_stale = True

    def add_link(self, tag, cell_id, make_current=True):
        self.links.add_link(tag, cell_id, make_current)

    def add_links(self, output_tags):
        self.links.add_links(output_tags)

    def remove_links(self, cell_id):
        self.links.remove_links(cell_id)

    def complete(self, text, input_tags={}):
        self.links.complete(text, input_tags)

    def has_external_link(self, k, cur_id):
        return self.links.has_external_link(k, cur_id)

    def get_external_link(self, k, cur_id):
        return self.links.get_external_link(k, cur_id)

    def pop_deleted_cells(self):
        deleted_cells = self.deleted_cells
        self.deleted_cells = []
        return deleted_cells
    
    def set_result(self, cid, result):
        if cid != self.exec_cell_id:
            raise InvalidCellModification("Cell", cid, "can only be modified by it's own cell")
        self.cells[cid].set_result(result)

    def set_failed(self, cid):
        self.cells[cid].set_failed()
        self.graph.remove_all_children(cid)

    def __setitem__(self, cid, value):
        if cid != self.exec_cell_id:
            raise InvalidCellModification("Out[" + key + "] can only be modified by it's own cell")
        self.cells[cid].set_result(value)

    def __getitem__(self, cid):
        # add edge between requested cell and the executing cell
        self.graph.add_edge(cid, self.exec_cell_id)

        res = self.execute_cell(cid)
        if isinstance(res, LinkedResult):
            if res.__tuple__() is None:
                return res
            return res.__tuple__()
        return res

    def get(self, cid, default=None):
        try:
            return self.__getitem__(k)
        except KeyError:
            return default

    def __len__(self):
        return len(self.cells)

    def __iter__(self):
        return iter(self.cells)

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

class DataflowLinks:
    def __init__(self):
        self.cur_links = defaultdict(list) # most recent is last
        self.links = defaultdict(set)
        self.rev_links = defaultdict(set)

    def add_link(self, tag, cell_id, make_current=True):
        self.links[tag].add(cell_id)
        self.rev_links[cell_id].add(tag)
        if make_current:
            self.cur_links[tag].append(cell_id)

    def add_links(self, output_tags):
        new_tags = set()
        for (tag, cell_ids) in output_tags.items():
            for cell_id in cell_ids:
                self.add_link(tag, cell_id, make_current=False)
                new_tags.add(tag)
        for tag in new_tags:
            if len(self.links[tag]) == 1 and not self.has_current_link(tag):
                # can make current because unambiguous
                cell_id = next(iter(self.links[tag]))
                self.cur_links[tag].append(cell_id)

    def remove_links(self, cell_id):
        if cell_id in self.rev_links:
            for name in self.rev_links[cell_id]:
                if cell_id in self.cur_links[name]:
                    self.cur_links[name].remove(cell_id)
                self.links[name].discard(cell_id)
            del self.rev_links[cell_id]

    def has_current_link(self, k):
        # print("HAS CURRENT LINK:", k, self.cur_links[k])
        return k in self.cur_links and len(self.cur_links[k]) > 0

    def get_current_link(self, k):
        if not self.has_current_link(k):
            raise DataflowCellException(f"No cell defines '{k}'")
        return self.cur_links[k][-1]

    def has_external_link(self, k, cur_id):
        return self.has_current_link(k) and self.get_current_link(k) != cur_id
        # return (k in self.cur_links) and (self.cur_links[k][-1] != cur_id or len(self.cur_links[k]) > 1)

    def get_external_link(self, k, cur_id):
        if not self.has_external_link(k, cur_id):
            raise DataflowCellException(f"No external link to '{k}'")
        for cell_id in reversed(self.cur_links[k]):
            if cell_id != cur_id:
                return cell_id

    def complete(self, text, input_tags={}):
        results = []
        id_start = text
        cell_start = None
        if '$' in text:
            id_start, cell_start = text.split('$',maxsplit=1)
        for link, cell_ids in self.links.items():
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
        self.cur_links.clear()
        self.links.clear()
        self.rev_links.clear()

class DataflowNamespace(dict):
    def clear(self):
        super().clear()
        self.__df_controller__.clear()