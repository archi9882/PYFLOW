"""Queries over the graph produced by ``analyzer.analyze``: search and neighborhoods."""

from __future__ import annotations

from collections import defaultdict

# Edge kinds grouped into the two families the UI can toggle.
FAMILIES = {
    "call": frozenset({"call"}),
    "data": frozenset({"assign", "arg", "return", "result"}),
}


def _is_subsequence(needle: str, haystack: str) -> bool:
    """True if all characters of needle appear in haystack in order ("cln" in "clean")."""
    it = iter(haystack)
    return all(ch in it for ch in needle)


def _match_tier(query: str, name: str, full: str) -> int | None:
    """Lower is better: exact, prefix, substring, subsequence; None if no match."""
    if query in (name, full):
        return 0
    if name.startswith(query) or full.startswith(query):
        return 1
    if query in name or query in full:
        return 2
    if _is_subsequence(query, name):
        return 3
    return None


def search(graph: dict, query: str, limit: int = 20) -> list[dict]:
    """Fuzzy-match nodes by name or ``scope.name``; best matches first.

    Each result is the node dict plus ``score`` (0 = exact ... 3 = loose).
    Same-named variables in different scopes are separate results, so the
    caller can show the scope next to each candidate.
    """
    q = query.strip().lower()
    if not q:
        return []
    ranked = []
    for node in graph["nodes"]:
        name = node["name"].lower()
        full = f"{node['scope']}.{node['name']}".lower() if node["scope"] else name
        tier = _match_tier(q, name, full)
        if tier is not None:
            # External calls (print, len, ...) rank after code defined in the file.
            ranked.append(((tier, node["kind"] == "external", len(name), node["name"], node["scope"]), node))
    ranked.sort(key=lambda item: item[0])
    return [dict(node, score=key[0]) for key, node in ranked[:limit]]


def _edge_kinds(families) -> frozenset[str]:
    kinds: set[str] = set()
    for fam in families:
        kinds |= FAMILIES[fam]
    return frozenset(kinds)


def subgraph(graph: dict, center: str, depth: int = 2, direction: str = "both",
             families=("call", "data")) -> dict:
    """Nodes within ``depth`` steps upstream and/or downstream of ``center``.

    Each returned node carries ``level``: 0 for the center, negative for
    upstream (where values / calls come from), positive for downstream.
    Only edges actually walked are returned, so the picture stays a flow
    rather than a hairball.

    A path stays in the edge family it started in: a function reached through
    data flow (its return value) is not expanded through its call edges, and
    vice versa. Otherwise looking up one variable would pull in every caller
    of every function it touches.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    if center not in by_id:
        raise KeyError(center)
    family_of = {kind: fam for fam, kinds in FAMILIES.items() for kind in kinds}
    allowed = _edge_kinds(families)
    outgoing, incoming = defaultdict(list), defaultdict(list)
    for e in graph["edges"]:
        if e["kind"] in allowed:
            outgoing[e["source"]].append(e)
            incoming[e["target"]].append(e)

    levels = {center: 0}
    walked: dict[tuple, dict] = {}

    def walk(adjacency, sign: int, far_end: str) -> None:
        # Breadth-first over (node, family) states, so each node gets the
        # level of its shortest path. The center may start either family.
        seen = {(center, fam) for fam in FAMILIES}
        frontier = list(seen)
        for step in range(1, depth + 1):
            nxt = []
            for nid, fam in frontier:
                for e in adjacency[nid]:
                    if family_of[e["kind"]] != fam:
                        continue
                    walked[(e["source"], e["target"], e["kind"])] = e
                    state = (e[far_end], fam)
                    if state not in seen:
                        seen.add(state)
                        nxt.append(state)
                        levels.setdefault(e[far_end], sign * step)
            frontier = nxt

    if direction in ("both", "upstream"):
        walk(incoming, -1, "source")
    if direction in ("both", "downstream"):
        walk(outgoing, 1, "target")

    return {
        "center": center,
        "nodes": [dict(by_id[nid], level=lvl) for nid, lvl in levels.items()],
        "edges": list(walked.values()),
    }


def overview(graph: dict) -> dict:
    """Whole-file call graph: every function, method and class plus the calls between them.

    External calls are left out so the overview shows the file's own structure.
    """
    keep = {n["id"] for n in graph["nodes"] if n["kind"] in ("module", "function", "method", "class")}
    edges = [e for e in graph["edges"] if e["kind"] == "call" and e["source"] in keep and e["target"] in keep]
    nodes = [dict(n, level=0) for n in graph["nodes"] if n["id"] in keep]
    if not any(e["source"] == "fn:<module>" or e["target"] == "fn:<module>" for e in edges):
        nodes = [n for n in nodes if n["id"] != "fn:<module>"]
    return {"center": None, "nodes": nodes, "edges": edges}
