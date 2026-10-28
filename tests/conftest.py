"""Shared helpers: analyze a snippet and ask about its edges by readable names."""

import textwrap

import pytest

from pyflow import analyze


class Graph:
    """Thin wrapper so tests can say ``g.has("var:f:x", "fn:f", "return")``."""

    def __init__(self, source: str):
        self.data = analyze(textwrap.dedent(source))
        assert self.data["error"] is None, self.data["error"]
        self.nodes = {n["id"]: n for n in self.data["nodes"]}
        self.edges = {(e["source"], e["target"], e["kind"]) for e in self.data["edges"]}

    def has(self, source: str, target: str, kind: str) -> bool:
        return (source, target, kind) in self.edges

    def into(self, target: str) -> set[str]:
        """Sources of every edge pointing at target."""
        return {s for s, t, _ in self.edges if t == target}

    def unsupported(self, kind: str) -> list[dict]:
        return [u for u in self.data["unsupported"] if u["kind"] == kind]


@pytest.fixture
def graph():
    return Graph
