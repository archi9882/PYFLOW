"""JSON-in / JSON-out bridge used by the web page through Pyodide.

The last analyzed graph is kept in module state so the browser does not
have to send it back on every keystroke.
"""

from __future__ import annotations

import json

from .analyzer import analyze
from .graph import overview, search, subgraph

_state: dict = {"graph": None}


def load(source: str, filename: str) -> str:
    """Analyze a file, remember the graph and return it as JSON."""
    _state["graph"] = analyze(source, filename)
    return json.dumps(_state["graph"])


def find(query: str, limit: int = 20) -> str:
    """Search candidates for the search box."""
    if _state["graph"] is None:
        return "[]"
    return json.dumps(search(_state["graph"], query, limit))


def neighborhood(center: str, depth: int, direction: str, families: str) -> str:
    """Subgraph around ``center``; ``families`` is a comma list such as "call,data"."""
    fams = tuple(f for f in families.split(",") if f)
    return json.dumps(subgraph(_state["graph"], center, int(depth), direction, fams))


def whole_file() -> str:
    """Call-graph overview shown right after a file is loaded."""
    return json.dumps(overview(_state["graph"]))
