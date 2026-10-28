"""Analyzer behaviour, one small snippet per language feature."""

from pathlib import Path

import pytest

from pyflow import analyze

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


# ----- call graph ---------------------------------------------------------------

def test_call_graph_between_functions(graph):
    g = graph("""
        def a(): b()
        def b(): c()
        def c(): pass
        a()
    """)
    assert g.has("fn:a", "fn:b", "call")
    assert g.has("fn:b", "fn:c", "call")
    assert g.has("fn:<module>", "fn:a", "call")


def test_external_calls_are_sinks(graph):
    g = graph("""
        def f(x):
            y = len(x)
            print(y)
    """)
    assert g.has("fn:f", "ext:len", "call")
    assert g.has("var:f:x", "ext:len", "arg")
    assert g.has("var:f:x", "var:f:y", "assign")  # value passes through len()
    assert g.has("var:f:y", "ext:print", "arg")
    # external nodes never feed data onward
    assert not any(s.startswith("ext:") for s, _, k in g.edges if k != "call")


def test_methods_via_self_and_class(graph):
    g = graph("""
        class Cart:
            def add(self, item):
                self.check(item)
            def check(self, thing):
                pass
            @staticmethod
            def fmt(value):
                return value
        Cart.fmt(1)
    """)
    assert g.has("fn:Cart.add", "fn:Cart.check", "call")
    assert g.has("var:Cart.add:item", "var:Cart.check:thing", "arg")
    assert g.has("fn:<module>", "fn:Cart.fmt", "call")
    assert "var:Cart.add:self" not in g.nodes  # self is not a data node
    assert "var:Cart.fmt:value" in g.nodes  # staticmethod keeps its first parameter


def test_instance_method_calls_resolve(graph):
    g = graph("""
        class Cart:
            def __init__(self, owner): pass
            def total(self): return 0
        def use(p: Cart):
            p.total()
        c = Cart("me")
        c.total()
    """)
    assert g.has("fn:<module>", "fn:Cart", "call")
    assert g.has("fn:<module>", "fn:Cart.total", "call")  # c = Cart(...) -> c.total()
    assert g.has("fn:use", "fn:Cart.total", "call")  # p: Cart annotation
    assert g.has("fn:Cart", "var:<module>:c", "result")


def test_class_call_maps_to_init_or_fields(graph):
    g = graph("""
        from dataclasses import dataclass
        class A:
            def __init__(self, x): pass
        @dataclass
        class P:
            name: str
            price: float
        v = 1
        A(v)
        P(v, price=v)
    """)
    assert g.has("var:<module>:v", "var:A.__init__:x", "arg")
    assert g.has("var:<module>:v", "var:P:name", "arg")
    assert g.has("var:<module>:v", "var:P:price", "arg")


# ----- data flow ----------------------------------------------------------------

def test_assignment_parameters_and_return(graph):
    g = graph("""
        def area(w, h):
            result = w * h
            return result
        width = 3
        a = area(width, h=4)
    """)
    assert g.has("var:area:w", "var:area:result", "assign")
    assert g.has("var:area:h", "var:area:result", "assign")
    assert g.has("var:area:result", "fn:area", "return")
    assert g.has("var:<module>:width", "var:area:w", "arg")
    assert g.has("fn:area", "var:<module>:a", "result")
    assert g.nodes["var:area:w"]["kind"] == "parameter"


def test_same_name_in_different_scopes_are_different_nodes(graph):
    g = graph("""
        def f():
            x = 1
            return x
        def g():
            x = 2
            return x
    """)
    assert "var:f:x" in g.nodes and "var:g:x" in g.nodes
    assert not g.has("var:f:x", "fn:g", "return")


def test_tuple_unpacking_pairs_elements(graph):
    g = graph("""
        p, q = 1, 2
        a, b = p, q
    """)
    assert g.has("var:<module>:p", "var:<module>:a", "assign")
    assert g.has("var:<module>:q", "var:<module>:b", "assign")
    assert not g.has("var:<module>:p", "var:<module>:b", "assign")


def test_unpacking_a_call_reaches_every_target(graph):
    g = graph("""
        def pair(): return 1, 2
        a, (b, *rest) = pair()
    """)
    for name in ("a", "b", "rest"):
        assert g.has("fn:pair", f"var:<module>:{name}", "result")


def test_for_loop_and_comprehension(graph):
    g = graph("""
        items = [1, 2]
        for i, item in enumerate(items):
            doubled = item * 2
        squares = [n * n for n in items if n]
    """)
    assert g.has("var:<module>:items", "var:<module>:i", "assign")
    assert g.has("var:<module>:items", "var:<module>:item", "assign")
    assert g.has("var:<module>:item", "var:<module>:doubled", "assign")
    assert g.has("var:<module>:items", "var:<module>:squares", "assign")
    assert "var:<module>:n" not in g.nodes  # comprehension variable stays private


def test_augmented_with_subscript_and_walrus(graph):
    g = graph("""
        total = 0
        step = 2
        total += step
        d = {}
        key = "k"
        d[key] = step
        with open("f") as fh:
            text = fh.read()
        if (size := len(text)) > 3:
            pass
    """)
    assert g.has("var:<module>:step", "var:<module>:total", "assign")
    assert g.has("var:<module>:step", "var:<module>:d", "assign")
    assert g.has("var:<module>:key", "var:<module>:d", "assign")
    assert g.has("var:<module>:fh", "var:<module>:text", "assign")
    assert g.has("var:<module>:text", "var:<module>:size", "assign")


def test_lambda_parameters_shadow_outer_names(graph):
    g = graph("""
        x = 1
        y = 2
        f = lambda x: x + y
    """)
    assert g.into("var:<module>:f") == {"var:<module>:y"}


def test_global_and_closure_reads_link_to_outer_variable(graph):
    g = graph("""
        LIMIT = 10
        def outer():
            base = 1
            def inner():
                return base + LIMIT
            return inner()
    """)
    assert g.has("var:outer:base", "fn:outer.inner", "return")
    assert g.has("var:<module>:LIMIT", "fn:outer.inner", "return")
    assert g.has("fn:outer", "fn:outer.inner", "call")


def test_nested_call_result_flows_into_outer_call(graph):
    g = graph("""
        def inner(v): return v
        def outer(w): return w
        r = outer(inner(1))
    """)
    assert g.has("fn:inner", "var:outer:w", "result")
    assert g.has("fn:outer", "var:<module>:r", "result")


def test_default_value_flows_into_parameter(graph):
    g = graph("""
        DEFAULT = 5
        def f(n=DEFAULT): return n
    """)
    assert g.has("var:<module>:DEFAULT", "var:f:n", "assign")


# ----- unsupported constructs are reported, not hidden ----------------------------

def test_unsupported_constructs_are_reported(graph):
    g = graph("""
        def deco(fn): return fn
        class K:
            def __init__(self, v):
                self.v = v
        @deco
        def f(*args, **kwargs):
            global COUNT
            COUNT = 1
            return getattr(args, "x")
        f(*[1], **{})
    """)
    assert [u["detail"] for u in g.unsupported("attribute")] == ["self.v"]
    assert {u["detail"] for u in g.unsupported("star_args")} >= {"*args parameter", "**kwargs parameter"}
    assert [u["detail"] for u in g.unsupported("decorator")] == ["@deco"]
    assert [u["detail"] for u in g.unsupported("dynamic")] == ["getattr()"]
    assert [u["detail"] for u in g.unsupported("global")] == ["global COUNT"]
    assert "decorator" in g.nodes["fn:f"]["flags"]


def test_harmless_decorators_are_not_reported(graph):
    g = graph("""
        import functools
        class A:
            @property
            def p(self): return 1
            @classmethod
            def make(cls): return cls
        @functools.lru_cache(maxsize=8)
        def f(): pass
    """)
    assert g.unsupported("decorator") == []


def test_match_statement_is_reported(graph):
    g = graph("""
        def f(cmd):
            match cmd:
                case [x]:
                    return x
    """)
    assert len(g.unsupported("match")) == 1


# ----- robustness ---------------------------------------------------------------

def test_syntax_error_is_returned_not_raised():
    result = analyze("def broken(:\n    pass\n")
    assert result["error"]["line"] == 1
    assert result["nodes"] == []


def test_empty_file():
    result = analyze("")
    assert result["error"] is None
    assert result["nodes"] == []


@pytest.mark.parametrize("path", sorted(EXAMPLES.glob("*.py")), ids=lambda p: p.name)
def test_examples_analyze_cleanly(path):
    result = analyze(path.read_text(encoding="utf-8"), path.name)
    assert result["error"] is None
    assert result["stats"]["edges"] > 0
    ids = {n["id"] for n in result["nodes"]}
    for e in result["edges"]:
        assert e["source"] in ids and e["target"] in ids


def test_analyzes_its_own_source():
    # A large real-world file: must not crash and must find its own functions.
    src = (Path(__file__).resolve().parents[1] / "core" / "pyflow" / "analyzer.py").read_text(encoding="utf-8")
    result = analyze(src)
    ids = {n["id"] for n in result["nodes"]}
    assert "fn:analyze" in ids and "fn:_Analyzer._call" in ids
