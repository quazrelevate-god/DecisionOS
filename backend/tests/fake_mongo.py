"""A tiny in-memory stand-in for the async Mongo API, for unit tests that must not
touch a real database (2026-10-05: the Company Brain index reads the live document
and the company's AI consent, so the RAG unit tests need somewhere to read them).

Supports what those paths use: find_one / find (+ async iteration, to_list, sort,
limit) / insert_one / insert_many / update_one / update_many (with upsert, $set,
$inc, $unset) / delete_many / count_documents. Filters: equality, dotted paths,
$in, $nin, $ne, $exists, $and, $or.
"""
import copy


def _get(doc, path):
    cur = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None, False
        cur = cur[part]
    return cur, True


def _match_value(val, present, cond):
    if isinstance(cond, dict) and any(k.startswith("$") for k in cond):
        for op, arg in cond.items():
            if op == "$in" and not (val in arg or (isinstance(val, list) and any(v in arg for v in val))):
                return False
            if op == "$nin" and (val in arg or (isinstance(val, list) and any(v in arg for v in val))):
                return False
            if op == "$ne" and (val == arg or (isinstance(val, list) and arg in val)):
                return False
            if op == "$exists" and bool(present) != bool(arg):
                return False
            if op == "$gt" and not (present and val is not None and val > arg):
                return False
        return True
    if isinstance(val, list) and not isinstance(cond, list):
        return cond in val
    return val == cond


def matches(doc, flt):
    for k, cond in (flt or {}).items():
        if k == "$and":
            if not all(matches(doc, f) for f in cond):
                return False
        elif k == "$or":
            if not any(matches(doc, f) for f in cond):
                return False
        else:
            val, present = _get(doc, k)
            if not _match_value(val, present, cond):
                return False
    return True


def _project(doc, projection):
    d = copy.deepcopy(doc)
    d.pop("_id", None)
    if not projection:
        return d
    keep = {k for k, v in projection.items() if v and k != "_id"}
    drop = {k for k, v in projection.items() if not v and k != "_id"}
    if keep:
        return {k: v for k, v in d.items() if k in keep}
    return {k: v for k, v in d.items() if k not in drop}


class _Res:
    def __init__(self, n=0, m=0):
        self.deleted_count = n
        self.modified_count = n
        self.matched_count = m or n
        self.inserted_id = None


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self.rows = self.rows[:n] if n else self.rows
        return self

    async def to_list(self, n=None):
        return self.rows[:n] if n else list(self.rows)

    def __aiter__(self):
        self._it = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _apply(doc, update):
    for op, fields in update.items():
        for k, v in fields.items():
            parts = k.split(".")
            cur = doc
            for p in parts[:-1]:
                cur = cur.setdefault(p, {})
            if op == "$set":
                cur[parts[-1]] = copy.deepcopy(v)
            elif op == "$inc":
                cur[parts[-1]] = (cur.get(parts[-1]) or 0) + v
            elif op == "$unset":
                cur.pop(parts[-1], None)


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def find_one(self, flt=None, projection=None):
        for d in self.docs:
            if matches(d, flt):
                return _project(d, projection)
        return None

    def find(self, flt=None, projection=None):
        return _Cursor([_project(d, projection) for d in self.docs if matches(d, flt)])

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return _Res(1)

    async def insert_many(self, docs):
        for d in docs:
            self.docs.append(copy.deepcopy(d))
        return _Res(len(docs))

    async def update_one(self, flt, update, upsert=False):
        for d in self.docs:
            if matches(d, flt):
                _apply(d, update)
                return _Res(1, 1)
        if upsert:
            new = {k: v for k, v in flt.items() if not k.startswith("$")}
            _apply(new, update)
            self.docs.append(new)
        return _Res(0)

    async def update_many(self, flt, update):
        n = 0
        for d in self.docs:
            if matches(d, flt):
                _apply(d, update)
                n += 1
        return _Res(n)

    async def delete_many(self, flt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not matches(d, flt)]
        return _Res(before - len(self.docs))

    async def count_documents(self, flt=None):
        return sum(1 for d in self.docs if matches(d, flt))


class FakeDB:
    def __init__(self):
        self._cols = {}

    def __getitem__(self, name):
        return self._cols.setdefault(name, FakeCollection())

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


def consenting_tenant(tenant_id="t1"):
    """A tenant row whose company has agreed to AI processing."""
    from services.ai_consent import build_grant_payload
    return {"id": tenant_id, "ai_consent": build_grant_payload(actor_user_id="u", actor_email="o@t.test")}
