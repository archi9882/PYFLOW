"""Search and neighborhood queries."""

import json
import textwrap

import pytest

from pyflow import analyze, api, function_inside, overview, search, subgraph

SOURCE = textwrap.dedent("""
    def load(path):
        data = open(path).read()
        return data

    def clean(data):
        cleaned = data.strip()
        return cleaned

    def main():
        data = load("x.txt")
        result = clean(data)
        print(result)

    main()
""")


@pytest.fixture
def g():
    return analyze(SOURCE)


def test_search_ranks_exact_before_partial(g):
    names = [r["name"] for r in search(g, "clean")]
    assert names[0] == "clean"
    assert "cleaned" in names


def test_search_lists_same_name_per_scope(g):
    hits = [r for r in search(g, "data") if r["name"] == "data"]
    assert {h["scope"] for h in hits} == {"load", "clean", "main"}


def test_search_by_qualified_and_subsequence(g):
    assert search(g, "main.data")[0]["id"] == "var:main:data"
    assert any(r["id"] == "fn:clean" for r in search(g, "cln"))
    assert search(g, "   ") == []


def test_subgraph_levels_and_direction(g):
    sub = subgraph(g, "var:main:data", depth=1)
    levels = {n["id"]: n["level"] for n in sub["nodes"]}
    assert levels["var:main:data"] == 0
    assert levels["fn:load"] == -1  # value comes from load()
    assert levels["var:clean:data"] == 1  # and goes into clean(data)

    down = subgraph(g, "var:main:data", depth=1, direction="downstream")
    assert all(n["level"] >= 0 for n in down["nodes"])


def test_subgraph_depth_limits_reach(g):
    near = {n["id"] for n in subgraph(g, "var:main:data", depth=1)["nodes"]}
    far = {n["id"] for n in subgraph(g, "var:main:data", depth=3)["nodes"]}
    assert "var:clean:cleaned" not in near
    assert "var:clean:cleaned" in far


def test_data_paths_do_not_wander_into_call_edges(g):
    # Reaching load() through its return value must not pull in its callers.
    ids = {n["id"] for n in subgraph(g, "var:main:data", depth=3, direction="upstream")["nodes"]}
    assert "fn:main" not in ids and "fn:<module>" not in ids


def test_subgraph_family_filter(g):
    calls_only = subgraph(g, "fn:main", depth=2, families=("call",))
    assert {e["kind"] for e in calls_only["edges"]} == {"call"}
    assert {n["id"] for n in calls_only["nodes"]} >= {"fn:load", "fn:clean", "fn:<module>"}


def test_subgraph_unknown_center(g):
    with pytest.raises(KeyError):
        subgraph(g, "var:nope:x")


def test_function_inside_shows_params_locals_and_one_step_around(g):
    sub = function_inside(g, "fn:clean")
    levels = {n["id"]: n["level"] for n in sub["nodes"]}
    assert sub["center"] == "fn:clean" and sub["scope"] == "clean"
    # Inside the box: the function, its parameter and its local.
    assert levels["fn:clean"] == 0 and levels["var:clean:data"] == 0 and levels["var:clean:cleaned"] == 0
    # One step outside: who calls it and passes what in (left), where the result goes (right).
    assert levels["fn:main"] == -1
    assert levels["var:main:data"] == -1
    assert levels["var:main:result"] == 1
    assert ("var:main:data", "var:clean:data", "arg") in {(e["source"], e["target"], e["kind"]) for e in sub["edges"]}


def test_function_inside_does_not_expand_past_one_step(g):
    ids = {n["id"] for n in function_inside(g, "fn:clean")["nodes"]}
    # load() feeds main.data, two steps away; print() reads main.result, also two steps.
    assert "fn:load" not in ids and "ext:print" not in ids


def test_function_inside_lists_locals_with_no_edges():
    g = analyze(textwrap.dedent("""
        def run(text):
            y = 100
            return text
    """))
    ids = {n["id"] for n in function_inside(g, "fn:run")["nodes"]}
    assert "var:run:y" in ids


def test_function_inside_leaves_out_nested_function_locals():
    g = analyze(textwrap.dedent("""
        def outer():
            x = 1
            def inner():
                z = 2
            return x
    """))
    ids = {n["id"] for n in function_inside(g, "fn:outer")["nodes"]}
    assert "var:outer:x" in ids and "var:outer.inner:z" not in ids


def test_function_inside_family_filter_keeps_the_box(g):
    sub = function_inside(g, "fn:clean", families=("call",))
    ids = {n["id"] for n in sub["nodes"]}
    assert {e["kind"] for e in sub["edges"]} == {"call"}
    assert "var:clean:cleaned" in ids  # locals stay listed even with data flow hidden
    assert "var:main:data" not in ids


def test_function_inside_needs_a_function(g):
    with pytest.raises(KeyError):
        function_inside(g, "fn:nope")
    with pytest.raises(ValueError):
        function_inside(g, "var:main:data")


def test_overview_is_the_file_call_graph(g):
    ov = overview(g)
    assert {n["id"] for n in ov["nodes"]} == {"fn:load", "fn:clean", "fn:main", "fn:<module>"}
    assert all(e["kind"] == "call" for e in ov["edges"])


def test_api_round_trip():
    graph = json.loads(api.load(SOURCE, "demo.py"))
    assert graph["filename"] == "demo.py"
    hits = json.loads(api.find("result"))
    assert hits[0]["id"] == "var:main:result"
    sub = json.loads(api.neighborhood(hits[0]["id"], 2, "both", "data"))
    assert sub["center"] == "var:main:result"
    assert json.loads(api.whole_file())["nodes"]


def test_api_highlight_classes():
    spans = json.loads(api.highlight('def f(x):\n    """doc\n    more"""\n    return len(x)  # note\n'))
    classes = {(line, cls) for line, _, _, cls in spans}
    assert {(1, "kw"), (1, "def"), (2, "str"), (3, "str"), (4, "builtin"), (4, "com")} <= classes
    assert json.loads(api.highlight("def broken(:\n")) != []  # partial result on syntax errors
