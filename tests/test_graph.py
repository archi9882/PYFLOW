"""Search and neighborhood queries."""

import json
import textwrap

import pytest

from pyflow import analyze, api, overview, search, subgraph

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
