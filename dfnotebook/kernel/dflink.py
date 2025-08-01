from collections import OrderedDict
class LinkedResult(OrderedDict):
    __dfhist__ = None
    def __init__(self, __uuid, __libs, __none_flag, k_v_tuples):
        keys = [tup[0] for tup in k_v_tuples]
        diff = set(keys) - set(list(__libs))
        if len(diff) <= 1 and not __none_flag:
            for kwarg in diff:
                idx = keys.index(kwarg)
                if k_v_tuples[idx][1] is None:
                    keys.remove(kwarg)
                    del k_v_tuples[idx]
                elif isinstance(k_v_tuples[idx][1], LinkedResult):
                    keys.remove(kwarg)
                    k_v_tuples.extend(k_v_tuples[idx][1].items())
                    del k_v_tuples[idx]
        super().__init__(k_v_tuples)
        self.__libs__ = __libs
        self.__uuid__ = __uuid

    def get_uuid(self):
        return self.__uuid__

    def __getitem__(self, item):
        if isinstance(item, int):
            item = item+len(self.__libs__)
            if len(self.keys()) > item and item >= 0:
                item = list(self.keys())[item]
        return super().__getitem__(item)

    def __tuple__(self):
        vals = []
        for key, val in self.items():
            if key not in self.__libs__:
                vals.append(val)
        # if len(vals) > 1:
        #     return DFTuple(self, vals)
        # elif len(vals) == 1:
        #     return vals[0]
        if len(vals) > 0:
            return DFTuple(self, vals)
        return None

    def __sethist__(self, hist):
        self.__dfhist__ = hist


class DFTuple(tuple):
    def __new__(self, __linked, *args, **kwargs):
        self.__ref__ = __linked
        return super().__new__(self, *args, **kwargs)

    def __getitem__(self, item):
        return self.__ref__.__getitem__(item)

def build_linked_result(__uuid, __libs, __none_flag, k_v_tuples):
    return LinkedResult(__uuid, __libs, __none_flag, k_v_tuples)
