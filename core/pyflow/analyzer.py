"""Static analyzer: turn Python source into a graph of calls and data flow.

The analyzer makes two passes over the ``ast`` tree:

1. Declaration pass: build a scope for the module, every function and every
   class, and record which names each scope binds. Python decides at compile
   time whether a name is local, so this must happen before any read can be
   resolved.
2. Visit pass: walk the statements in order and emit nodes and edges.

Graph vocabulary
----------------
Node kinds: module, function, method, class, parameter, variable, external.

Edge kinds:
    call    caller function -> callee function (the call graph)
    assign  a value flows from one variable into another
    arg     a value is passed as an argument (into a parameter or an external call)
    return  a variable is returned by a function (variable -> function)
    result  a function's return value is used (function -> variable / parameter)

Everything the analyzer cannot follow is reported in ``unsupported`` rather
than silently ignored.
"""

from __future__ import annotations

import ast
from dataclasses import asdict, dataclass, field
from typing import Iterator

MODULE = "<module>"
MODULE_ID = "fn:" + MODULE

# Calls that change program structure at run time; static analysis cannot follow them.
DYNAMIC_CALLS = frozenset(
    {"getattr", "setattr", "delattr", "exec", "eval", "compile", "globals", "locals", "vars", "__import__"}
)

# Decorators that do not change how arguments map onto parameters.
HARMLESS_DECORATORS = frozenset(
    {"staticmethod", "classmethod", "property", "setter", "getter", "deleter", "dataclass",
     "abstractmethod", "override", "cache", "lru_cache", "cached_property", "wraps"}
)

# Scope-creating nodes; the declaration walk never enters their bodies.
_NEW_SCOPE = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda,
              ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)

# ast.TryStar only exists on Python 3.11+.
_TRY_NODES = (ast.Try,) + ((ast.TryStar,) if hasattr(ast, "TryStar") else ())


@dataclass
class Node:
    id: str
    name: str
    kind: str
    scope: str
    lines: list[int] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


@dataclass
class Edge:
    source: str
    target: str
    kind: str
    lines: list[int] = field(default_factory=list)


@dataclass
class Unsupported:
    kind: str
    scope: str
    detail: str
    lines: list[int] = field(default_factory=list)


@dataclass
class FuncInfo:
    """How call arguments map onto a callee's parameter nodes."""

    positional: list[str] = field(default_factory=list)  # parameter node ids in order
    by_name: dict[str, str] = field(default_factory=dict)  # parameter name -> node id
    vararg: str | None = None  # node id of *args
    kwarg: str | None = None  # node id of **kwargs

    def at(self, index: int) -> str | None:
        return self.positional[index] if index < len(self.positional) else self.vararg

    def named(self, name: str) -> str | None:
        return self.by_name.get(name, self.kwarg)


@dataclass(eq=False)
class Scope:
    qualname: str
    kind: str  # "module" | "function" | "class"
    node_id: str
    parent: Scope | None = None
    locals: set[str] = field(default_factory=set)
    imports: set[str] = field(default_factory=set)
    defs: dict[str, str] = field(default_factory=dict)  # nested def/class name -> node id
    declared_global: set[str] = field(default_factory=set)
    declared_nonlocal: set[str] = field(default_factory=set)
    self_name: str | None = None  # first parameter of a method ("self" / "cls")
    owner_class: Scope | None = None  # class scope that owns this method


def _walk_local(node: ast.AST) -> Iterator[ast.AST]:
    """Yield node and its descendants without entering nested scopes.

    Scope-creating nodes are still yielded so the caller can declare them.
    """
    stack = [node]
    while stack:
        cur = stack.pop()
        yield cur
        if isinstance(cur, _NEW_SCOPE):
            continue
        stack.extend(ast.iter_child_nodes(cur))


def _bound_names(target: ast.AST) -> set[str]:
    """Names bound by an assignment target such as ``a, (b, *c)``."""
    return {n.id for n in ast.walk(target) if isinstance(n, ast.Name)}


def _root_name(expr: ast.AST) -> str | None:
    """Base variable of ``a.b[c].d`` -> ``a``."""
    while isinstance(expr, (ast.Attribute, ast.Subscript)):
        expr = expr.value
    return expr.id if isinstance(expr, ast.Name) else None


def _call_name(func: ast.AST) -> str:
    """Readable dotted name for a call target, e.g. ``np.mean`` or ``df.groupby().sum``."""
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return f"{_call_name(func.value)}.{func.attr}"
    if isinstance(func, ast.Call):
        return _call_name(func.func) + "()"
    if isinstance(func, ast.Subscript):
        return _call_name(func.value) + "[]"
    return "<expr>"


def _decorator_name(dec: ast.AST) -> str:
    """Last segment of a decorator name: ``@functools.lru_cache(8)`` -> ``lru_cache``."""
    if isinstance(dec, ast.Call):
        dec = dec.func
    return _call_name(dec).rsplit(".", 1)[-1]


class _Analyzer:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: dict[tuple[str, str, str], Edge] = {}
        self.unsupported: dict[tuple[str, str, str], Unsupported] = {}
        self.scopes: dict[int, Scope] = {}  # id(ast node) -> scope
        self.class_scopes: dict[str, Scope] = {}  # class node id -> scope
        self.funcinfo: dict[str, FuncInfo] = {}  # callable node id -> argument mapping
        self.instance_of: dict[str, str] = {}  # variable id -> class id (cart = Cart(...))
        self.module = Scope(MODULE, "module", MODULE_ID)

    # ----- graph building helpers -------------------------------------------------

    def _add_node(self, nid: str, name: str, kind: str, scope: str, line: int | None = None) -> Node:
        node = self.nodes.get(nid)
        if node is None:
            node = self.nodes[nid] = Node(nid, name, kind, scope)
        if line is not None and line not in node.lines:
            node.lines.append(line)
        return node

    def _var(self, scope: Scope, name: str, line: int | None = None) -> str:
        """Node id of a variable, created on first use. ``line`` marks a binding site."""
        nid = f"var:{scope.qualname}:{name}"
        self._add_node(nid, name, "variable", scope.qualname, line)
        return nid

    def _edge(self, source: str, target: str, kind: str, line: int) -> None:
        if source == target:  # x = x + 1 adds nothing to the picture
            return
        edge = self.edges.setdefault((source, target, kind), Edge(source, target, kind))
        if line not in edge.lines:
            edge.lines.append(line)

    def _flow(self, sources: set[str], target: str | None, kind: str, line: int) -> None:
        """Connect value sources to a target. A function source means its return value."""
        if target is None:
            return
        for src in sorted(sources):
            self._edge(src, target, "result" if src.startswith("fn:") else kind, line)

    def _unsupported(self, kind: str, line: int, scope: Scope, detail: str, node_id: str | None = None) -> None:
        item = self.unsupported.setdefault((kind, scope.qualname, detail), Unsupported(kind, scope.qualname, detail))
        if line not in item.lines:
            item.lines.append(line)
        flagged = self.nodes.get(node_id or scope.node_id)
        if flagged is not None and kind not in flagged.flags:
            flagged.flags.append(kind)

    def _caller(self, scope: Scope) -> str:
        """Node that represents 'who is calling' in this scope."""
        if scope.kind == "module":
            self._add_node(MODULE_ID, MODULE, "module", "")
        return scope.node_id

    def _external(self, name: str) -> str:
        nid = "ext:" + name
        self._add_node(nid, name, "external", "")
        return nid

    # ----- pass 1: declarations ---------------------------------------------------

    def _declare_body(self, body: list[ast.stmt], scope: Scope) -> None:
        for stmt in body:
            for node in _walk_local(stmt):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self._declare_function(node, scope)
                elif isinstance(node, ast.ClassDef):
                    self._declare_class(node, scope)
                elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                    scope.locals.add(node.id)
                elif isinstance(node, (ast.Import, ast.ImportFrom)):
                    for alias in node.names:
                        if alias.name != "*":
                            scope.imports.add((alias.asname or alias.name).split(".")[0])
                elif isinstance(node, ast.ExceptHandler) and node.name:
                    scope.locals.add(node.name)
                elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
                    scope.locals.add(node.name)
                elif isinstance(node, ast.MatchMapping) and node.rest:
                    scope.locals.add(node.rest)
                elif isinstance(node, ast.Global):
                    scope.declared_global.update(node.names)
                elif isinstance(node, ast.Nonlocal):
                    scope.declared_nonlocal.update(node.names)
        scope.locals -= scope.declared_global | scope.declared_nonlocal

    def _qualname(self, parent: Scope, name: str) -> str:
        return name if parent.kind == "module" else f"{parent.qualname}.{name}"

    def _declare_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, parent: Scope) -> None:
        qual = self._qualname(parent, node.name)
        nid = "fn:" + qual
        is_method = parent.kind == "class"
        self._add_node(nid, node.name, "method" if is_method else "function", parent.qualname, node.lineno)
        parent.defs[node.name] = nid

        scope = Scope(qual, "function", nid, parent, owner_class=parent if is_method else None)
        self.scopes[id(node)] = scope

        args = node.args
        positional = [*args.posonlyargs, *args.args]
        decorators = {_decorator_name(d) for d in node.decorator_list}
        if is_method and positional and "staticmethod" not in decorators:
            scope.self_name = positional.pop(0).arg
            scope.locals.add(scope.self_name)

        info = FuncInfo()
        for arg in [*positional, *args.kwonlyargs]:
            pid = f"var:{qual}:{arg.arg}"
            self._add_node(pid, arg.arg, "parameter", qual, arg.lineno)
            scope.locals.add(arg.arg)
            info.by_name[arg.arg] = pid
            if arg in positional:
                info.positional.append(pid)
        for star, prefix in ((args.vararg, "*"), (args.kwarg, "**")):
            if star is None:
                continue
            pid = f"var:{qual}:{star.arg}"
            self._add_node(pid, star.arg, "parameter", qual, star.lineno)
            scope.locals.add(star.arg)
            if prefix == "*":
                info.vararg = pid
            else:
                info.kwarg = pid
            self._unsupported("star_args", node.lineno, scope, f"{prefix}{star.arg} parameter", pid)
        self.funcinfo[nid] = info

        for name in sorted(decorators - HARMLESS_DECORATORS):
            self._unsupported("decorator", node.lineno, scope, f"@{name}", nid)

        self._declare_body(node.body, scope)

    def _declare_class(self, node: ast.ClassDef, parent: Scope) -> None:
        qual = self._qualname(parent, node.name)
        nid = "fn:" + qual
        self._add_node(nid, node.name, "class", parent.qualname, node.lineno)
        parent.defs[node.name] = nid

        scope = Scope(qual, "class", nid, parent)
        self.scopes[id(node)] = scope
        self.class_scopes[nid] = scope
        self._declare_body(node.body, scope)

        # Calling the class runs __init__; without one, assume dataclass-style
        # fields declared as annotated class attributes, in order.
        init = scope.defs.get("__init__")
        if init is not None:
            self.funcinfo[nid] = self.funcinfo[init]
        else:
            info = FuncInfo()
            for stmt in node.body:
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                    fid = self._var(scope, stmt.target.id, stmt.lineno)
                    info.positional.append(fid)
                    info.by_name[stmt.target.id] = fid
            self.funcinfo[nid] = info

    # ----- name resolution --------------------------------------------------------

    def _lookup(self, name: str, scope: Scope) -> str | None:
        """Node id for a name read in ``scope``; None for builtins, imports and self."""
        if name == scope.self_name:
            return None
        start, first = scope, True
        if name in scope.declared_global:
            start, first = self.module, False
        elif name in scope.declared_nonlocal:
            start, first = scope.parent, False
        s = start
        while s is not None:
            # Class bodies are not visible from the methods nested inside them.
            if s.kind == "class" and not first:
                s = s.parent
                continue
            if name in s.defs:
                return s.defs[name]
            if name in s.imports:
                return None
            if name in s.locals:
                return self._var(s, name)
            s, first = s.parent, False
        return None

    def _store(self, name: str, scope: Scope, line: int) -> str | None:
        """Node id for a name being bound in ``scope``."""
        if name == scope.self_name:
            return None
        if name in scope.declared_global or name in scope.declared_nonlocal:
            keyword = "global" if name in scope.declared_global else "nonlocal"
            self._unsupported(keyword, line, scope, f"{keyword} {name}")
            target = self._lookup(name, scope)
            if target and target.startswith("var:"):
                self._add_node(target, name, "variable", self.nodes[target].scope, line)
                return target
            return None
        nid = f"var:{scope.qualname}:{name}"
        if nid in self.nodes and self.nodes[nid].kind == "parameter":
            return nid  # rebinding a parameter keeps the same node
        return self._var(scope, name, line)

    def _resolve_callee(self, func: ast.expr, scope: Scope, bound: frozenset[str]) -> str | None:
        """Function, method or class defined in this file that ``func`` refers to."""
        if isinstance(func, ast.Name):
            if func.id in bound:
                return None
            nid = self._lookup(func.id, scope)
            return nid if nid and nid.startswith("fn:") else None
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            base = func.value.id
            if base == scope.self_name and scope.owner_class is not None:
                return scope.owner_class.defs.get(func.attr)
            if base in bound:
                return None
            ref = self._lookup(base, scope)
            # Cart.method(...) or cart.method(...) where cart = Cart(...) / cart: Cart
            cls = self.instance_of.get(ref, ref)
            if cls in self.class_scopes:
                return self.class_scopes[cls].defs.get(func.attr)
        return None

    def _class_ref(self, expr: ast.expr | None, scope: Scope) -> str | None:
        """Class defined in this file that an annotation like ``Product`` names."""
        if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
            name = expr.value  # forward reference: "Product"
        elif isinstance(expr, ast.Name):
            name = expr.id
        else:
            return None
        ref = self._lookup(name, scope)
        return ref if ref in self.class_scopes else None

    # ----- pass 2: statements -----------------------------------------------------

    def _visit_body(self, body: list[ast.stmt], scope: Scope) -> None:
        for stmt in body:
            self._visit_stmt(stmt, scope)

    def _visit_stmt(self, st: ast.stmt, scope: Scope) -> None:
        line = st.lineno
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            inner = self.scopes[id(st)]
            for dec in st.decorator_list:
                self._sources(dec, scope)
            self._bind_defaults(st, scope, inner)
            self._visit_body(st.body, inner)
        elif isinstance(st, ast.ClassDef):
            for expr in [*st.decorator_list, *st.bases, *(k.value for k in st.keywords)]:
                self._sources(expr, scope)
            self._visit_body(st.body, self.scopes[id(st)])
        elif isinstance(st, ast.Assign):
            for target in st.targets:
                self._assign(target, st.value, scope, line)
        elif isinstance(st, ast.AnnAssign):
            if st.value is not None:
                self._assign(st.target, st.value, scope, line)
            elif isinstance(st.target, ast.Name):
                self._store(st.target.id, scope, line)
        elif isinstance(st, ast.AugAssign):
            self._assign(st.target, st.value, scope, line)
        elif isinstance(st, ast.Return):
            sources = self._sources(st.value, scope)
            if scope.kind == "function":
                self._flow(sources, scope.node_id, "return", line)
        elif isinstance(st, (ast.For, ast.AsyncFor)):
            self._assign(st.target, st.iter, scope, line)
            self._visit_body(st.body, scope)
            self._visit_body(st.orelse, scope)
        elif isinstance(st, (ast.With, ast.AsyncWith)):
            for item in st.items:
                if item.optional_vars is not None:
                    self._assign(item.optional_vars, item.context_expr, scope, line)
                else:
                    self._sources(item.context_expr, scope)
            self._visit_body(st.body, scope)
        elif isinstance(st, (ast.If, ast.While)):
            # Conditions are evaluated (calls inside them count) but control
            # dependence is not drawn as data flow.
            self._sources(st.test, scope)
            self._visit_body(st.body, scope)
            self._visit_body(st.orelse, scope)
        elif isinstance(st, _TRY_NODES):
            self._visit_body(st.body, scope)
            for handler in st.handlers:
                self._sources(handler.type, scope)
                if handler.name:
                    self._store(handler.name, scope, handler.lineno)
                self._visit_body(handler.body, scope)
            self._visit_body(st.orelse, scope)
            self._visit_body(st.finalbody, scope)
        elif isinstance(st, ast.Match):
            self._unsupported("match", line, scope, "match/case patterns")
            self._sources(st.subject, scope)
            for case in st.cases:
                self._sources(case.guard, scope)
                self._visit_body(case.body, scope)
        elif isinstance(st, ast.ImportFrom):
            if any(alias.name == "*" for alias in st.names):
                self._unsupported("star_import", line, scope, f"from {st.module} import *")
        elif isinstance(st, (ast.Import, ast.Global, ast.Nonlocal)):
            pass  # handled during declaration / binding
        else:
            # Expr, Raise, Assert, Delete, ...: evaluate for the calls they contain.
            for child in ast.iter_child_nodes(st):
                if isinstance(child, ast.expr):
                    self._sources(child, scope)

    def _bind_defaults(self, fn: ast.FunctionDef | ast.AsyncFunctionDef, outer: Scope, inner: Scope) -> None:
        """Default values are evaluated in the enclosing scope and flow into the parameter.

        Also remembers parameters annotated with a class from this file, so
        ``product.method()`` can resolve to ``Product.method``.
        """
        args = fn.args
        positional = [*args.posonlyargs, *args.args]
        for arg in [*positional, *args.kwonlyargs]:
            pid = f"var:{inner.qualname}:{arg.arg}"
            cls = self._class_ref(arg.annotation, outer)
            if cls and pid in self.nodes:
                self.instance_of[pid] = cls
        pairs = list(zip(positional[len(positional) - len(args.defaults):], args.defaults))
        pairs += [(a, d) for a, d in zip(args.kwonlyargs, args.kw_defaults) if d is not None]
        for arg, default in pairs:
            pid = f"var:{inner.qualname}:{arg.arg}"
            if pid in self.nodes:
                self._flow(self._sources(default, outer), pid, "assign", default.lineno)

    def _assign(self, target: ast.expr, value: ast.expr, scope: Scope, line: int) -> None:
        # a, b = x, y  ->  pair elements one to one
        if (isinstance(target, (ast.Tuple, ast.List)) and isinstance(value, (ast.Tuple, ast.List))
                and len(target.elts) == len(value.elts)
                and not any(isinstance(e, ast.Starred) for e in [*target.elts, *value.elts])):
            for t, v in zip(target.elts, value.elts):
                self._assign(t, v, scope, line)
            return
        self._bind(target, self._sources(value, scope), scope, line)

    def _bind(self, target: ast.expr, sources: set[str], scope: Scope, line: int) -> None:
        """Connect ``sources`` to every name bound by ``target``."""
        if isinstance(target, ast.Name):
            tid = self._store(target.id, scope, line)
            self._flow(sources, tid, "assign", line)
            if tid and len(sources) == 1 and next(iter(sources)) in self.class_scopes:
                self.instance_of[tid] = next(iter(sources))  # x = SomeClass(...)
        elif isinstance(target, (ast.Tuple, ast.List)):
            # a, b = f(): without knowing the shape, every element may get every source.
            for elt in target.elts:
                self._bind(elt, sources, scope, line)
        elif isinstance(target, ast.Starred):
            self._bind(target.value, sources, scope, line)
        elif isinstance(target, (ast.Attribute, ast.Subscript)):
            base = _root_name(target)
            if base is not None and base == scope.self_name:
                self._unsupported("attribute", line, scope, f"{base}.{getattr(target, 'attr', '[...]')}")
                return
            # obj.attr = v / d[k] = v: treat as mutating the base variable.
            extra = self._sources(target.slice, scope) if isinstance(target, ast.Subscript) else set()
            base_id = self._lookup(base, scope) if base else None
            if base_id and base_id.startswith("var:"):
                self._flow(sources | extra, base_id, "assign", line)

    # ----- expressions ------------------------------------------------------------

    def _sources(self, expr: ast.AST | None, scope: Scope, bound: frozenset[str] = frozenset()) -> set[str]:
        """Graph nodes whose values flow into ``expr``. Records calls as a side effect.

        ``bound`` holds names bound by an enclosing lambda or comprehension,
        which shadow outer variables.
        """
        out: set[str] = set()
        if expr is None:
            return out
        if isinstance(expr, ast.Name):
            if isinstance(expr.ctx, ast.Load) and expr.id not in bound:
                nid = self._lookup(expr.id, scope)
                if nid and nid.startswith("var:"):
                    out.add(nid)
            return out
        if isinstance(expr, ast.Call):
            return self._call(expr, scope, bound)
        if isinstance(expr, ast.NamedExpr):
            sources = self._sources(expr.value, scope, bound)
            self._bind(expr.target, sources, scope, expr.lineno)
            nid = self._lookup(expr.target.id, scope)
            return {nid} if nid else sources
        if isinstance(expr, ast.Lambda):
            a = expr.args
            names = {x.arg for x in [*a.posonlyargs, *a.args, *a.kwonlyargs, a.vararg, a.kwarg] if x}
            for default in [*a.defaults, *a.kw_defaults]:
                out |= self._sources(default, scope, bound)
            return out | self._sources(expr.body, scope, bound | names)
        if isinstance(expr, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            inner = bound
            for gen in expr.generators:
                out |= self._sources(gen.iter, scope, inner)
                inner = inner | _bound_names(gen.target)
                for cond in gen.ifs:
                    out |= self._sources(cond, scope, inner)
            elts = [expr.key, expr.value] if isinstance(expr, ast.DictComp) else [expr.elt]
            for elt in elts:
                out |= self._sources(elt, scope, inner)
            return out
        if isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Name) \
                and expr.value.id == scope.self_name and expr.value.id not in bound:
            self._unsupported("attribute", expr.lineno, scope, f"{expr.value.id}.{expr.attr}")
            return out
        for child in ast.iter_child_nodes(expr):
            out |= self._sources(child, scope, bound)
        return out

    def _call(self, call: ast.Call, scope: Scope, bound: frozenset[str]) -> set[str]:
        line = call.lineno
        func = call.func
        caller = self._caller(scope)
        if (isinstance(func, ast.Name) and func.id in DYNAMIC_CALLS
                and func.id not in bound and self._lookup(func.id, scope) is None):
            self._unsupported("dynamic", line, scope, f"{func.id}()")

        callee = self._resolve_callee(func, scope, bound)
        if callee is not None:
            # Defined in this file: map each argument onto the matching parameter.
            self._edge(caller, callee, "call", line)
            info = self.funcinfo.get(callee, FuncInfo())
            for index, arg in enumerate(call.args):
                if isinstance(arg, ast.Starred):
                    self._unsupported("star_args", line, scope, f"*{_call_name(arg.value)} passed to {func_label(callee)}")
                    self._sources(arg.value, scope, bound)
                    continue
                self._flow(self._sources(arg, scope, bound), info.at(index), "arg", line)
            for kw in call.keywords:
                sources = self._sources(kw.value, scope, bound)
                if kw.arg is None:
                    self._unsupported("star_args", line, scope, f"**{_call_name(kw.value)} passed to {func_label(callee)}")
                    continue
                self._flow(sources, info.named(kw.arg), "arg", line)
            return {callee}

        # Library, builtin or method on an object: the arguments (and the
        # receiver, for obj.method()) flow into the call and through to its result.
        ext = self._external(_call_name(func))
        self._edge(caller, ext, "call", line)
        sources = self._sources(func, scope, bound) if not isinstance(func, ast.Name) else set()
        for arg in call.args:
            sources |= self._sources(arg.value if isinstance(arg, ast.Starred) else arg, scope, bound)
        for kw in call.keywords:
            sources |= self._sources(kw.value, scope, bound)
        self._flow(sources, ext, "arg", line)
        # The external node is a sink: it never feeds data onward, otherwise every
        # print() / len() would connect unrelated variables to each other.
        return sources

    # ----- entry point ------------------------------------------------------------

    def run(self, tree: ast.Module) -> None:
        self.scopes[id(tree)] = self.module
        self._declare_body(tree.body, self.module)
        self._visit_body(tree.body, self.module)


def func_label(node_id: str) -> str:
    """``fn:Cart.add`` -> ``Cart.add``."""
    return node_id.split(":", 1)[1]


def analyze(source: str, filename: str = "<input>") -> dict:
    """Analyze Python source code and return a JSON-serializable graph.

    Returns a dict with keys ``filename``, ``nodes``, ``edges``,
    ``unsupported``, ``stats`` and ``error`` (None, or ``{"message", "line"}``
    when the source cannot be parsed).
    """
    result = {"filename": filename, "nodes": [], "edges": [], "unsupported": [], "stats": {}, "error": None}
    try:
        tree = ast.parse(source, filename)
    except SyntaxError as exc:
        result["error"] = {"message": exc.msg, "line": exc.lineno}
        return result

    analyzer = _Analyzer()
    analyzer.run(tree)

    result["nodes"] = [asdict(n) for n in analyzer.nodes.values()]
    result["edges"] = [asdict(e) for e in analyzer.edges.values()]
    result["unsupported"] = [asdict(u) for u in analyzer.unsupported.values()]
    kinds = [n.kind for n in analyzer.nodes.values()]
    result["stats"] = {
        "lines": len(source.splitlines()),
        "functions": sum(k in ("function", "method", "class") for k in kinds),
        "variables": sum(k in ("variable", "parameter") for k in kinds),
        "edges": len(analyzer.edges),
        "unsupported": len(analyzer.unsupported),
    }
    return result
