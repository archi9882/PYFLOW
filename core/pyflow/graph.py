"""Queries over the graph produced by ``analyzer.analyze``: search and neighborhoods."""

from __future__ import annotations

import heapq
from collections import defaultdict

# Edge kinds grouped into the families the UI can toggle.
FAMILIES = {
    "call": frozenset({"call"}),
    "data": frozenset({"assign", "arg", "return", "result"}),
    "control": frozenset({"control"}),
}

# A condition feeds a value like data does, so paths may continue through it:
# for walking, "control" edges belong to the data family.
_WALK_FAMILY = {kind: ("data" if fam == "control" else fam) for fam, kinds in FAMILIES.items() for kind in kinds}

# Names of external calls that usually leave a trace outside the program's variables.
_EFFECT_NAMES = frozenset({
    "print", "write", "writelines", "send", "sendall", "sendto", "put", "post", "patch", "delete", "request",
    "save", "savefig", "show", "dump", "to_csv", "to_json", "to_excel", "to_parquet", "to_sql", "to_pickle",
    "to_feather", "to_hdf", "execute", "executemany", "commit", "rollback", "exit", "_exit", "remove", "unlink",
    "rmtree", "mkdir", "makedirs", "rename", "emit", "publish", "log", "debug", "info", "warning", "warn", "error",
    "critical", "exception", "flush", "system", "popen", "run", "check_call", "check_output",
})
_EFFECT_MODULES = frozenset({"logging", "subprocess", "requests", "shutil", "urllib", "http", "socket", "sys.stdout"})


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
    family_of = _WALK_FAMILY
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


def is_effect(name: str) -> bool:
    """True if an external call with this dotted name probably writes, prints, sends or logs."""
    lowered = name.lower().rstrip("()")
    last = lowered.rsplit(".", 1)[-1]
    first = lowered.split(".", 1)[0]
    return last in _EFFECT_NAMES or first in _EFFECT_MODULES or last.startswith(("write_", "send_", "save_", "to_"))


def locate(graph: dict, line: int, col: int) -> list[dict]:
    """Nodes whose name token covers the position (1-based line, 0-based UTF-16 column).

    A cursor just after the last character of a name still counts, as in
    editors. Usually one node; more than one if tokens overlap.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    found, seen = [], set()
    for ref in graph.get("refs", []):
        if ref["line"] == line and ref["col"] <= col <= ref["end"] and ref["node"] not in seen:
            seen.add(ref["node"])
            found.append(by_id[ref["node"]])
    # A cursor inside a name beats one that merely touches its end.
    found.sort(key=lambda n: min(
        (0 if r["col"] <= col < r["end"] else 1) for r in graph["refs"] if r["line"] == line and r["node"] == n["id"]))
    return found


def impact(graph: dict, center: str, depth: int | None = None, control: bool = True,
           max_nodes: int | None = None) -> dict:
    """Everything that changes if the value (or behaviour) of ``center`` changes.

    Follows data flow forward without a depth limit unless ``depth`` is given.
    With ``control`` on it also follows conditions: in ``if x: y = 1`` a
    different ``x`` can change ``y`` even though no value moves from one to
    the other. Each affected node says how: ``influence`` is "data" when a
    pure data path exists, "condition" when every path needs a condition, and
    "caller" for functions that call a changed function. ``path`` lists the
    steps from ``center``, so the answer to "why?" is always available.

    Returns ``center``, ``nodes`` (with ``level`` = steps away, negative for
    callers), ``edges`` (those between the shown nodes), ``summary``,
    ``lines`` (source lines where the change arrives), ``source_refs`` and
    ``affected_refs`` (token positions for an editor), ``warnings`` (spots
    pyflow cannot follow that touch this result) and ``truncated``.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    if center not in by_id:
        raise KeyError(center)
    kinds = FAMILIES["data"] | (FAMILIES["control"] if control else frozenset())
    outgoing, callers_of = defaultdict(list), defaultdict(list)
    for e in graph["edges"]:
        if e["kind"] in kinds:
            outgoing[e["source"]].append(e)
        elif e["kind"] == "call":
            callers_of[e["target"]].append(e)

    # Dijkstra on (conditions crossed, steps): a pure data path always beats one through a condition.
    best: dict[str, tuple[int, int]] = {center: (0, 0)}
    pred: dict[str, dict] = {}
    heap = [(0, 0, 0, center)]
    tie = 0
    truncated = False
    while heap:
        cond, hops, _, nid = heapq.heappop(heap)
        if best.get(nid) != (cond, hops):
            continue
        for e in outgoing[nid]:
            nxt = (cond + (e["kind"] == "control"), hops + 1)
            if depth is not None and nxt[1] > depth:
                truncated = True
                continue
            if e["target"] not in best or nxt < best[e["target"]]:
                best[e["target"]] = nxt
                pred[e["target"]] = e
                tie += 1
                heapq.heappush(heap, (nxt[0], nxt[1], tie, e["target"]))

    # Changing a function changes whoever calls it (all the way up).
    caller_level: dict[str, int] = {}
    if by_id[center]["kind"] in ("function", "method", "class"):
        frontier, level = [center], 0
        while frontier and (depth is None or level < depth):
            level += 1
            nxt_frontier = []
            for nid in frontier:
                for e in callers_of[nid]:
                    src = e["source"]
                    if src != center and src not in caller_level and src not in best:
                        caller_level[src] = level
                        pred[src] = e
                        nxt_frontier.append(src)
            frontier = nxt_frontier

    affected = {nid for nid in best if nid != center} | set(caller_level)

    shown = affected | {center}
    # Where the change arrives: every edge from the center or an affected node into an affected node.
    arrive: dict[str, set[int]] = defaultdict(set)
    induced = []
    for e in graph["edges"]:
        if e["source"] in shown and e["target"] in shown and (e["kind"] in kinds or (e["kind"] == "call" and (
                e["source"] in caller_level or e["target"] in caller_level))):
            induced.append(e)
            if e["target"] in affected and e["kind"] != "call":
                arrive[e["target"]].update(e["lines"])
    for nid in caller_level:
        if nid in affected:
            arrive[nid].update(pred[nid]["lines"])

    def path_to(nid: str) -> list[dict]:
        steps = []
        while nid in pred and nid != center:
            e = pred[nid]
            steps.append({"from": e["source"], "to": e["target"], "kind": e["kind"], "lines": e["lines"]})
            nid = e["target"] if nid in caller_level else e["source"]
        return steps[::-1]

    nodes, counts = [], defaultdict(int)
    for nid in sorted(affected, key=lambda n: (caller_level.get(n, 0) or best[n][1], n)):
        node = by_id[nid]
        if nid in caller_level:
            influence, category, level = "caller", "caller", -caller_level[nid]
        else:
            cond, hops = best[nid]
            influence, level = ("condition" if cond else "data"), hops
            via = pred[nid]["kind"]
            if node["kind"] == "external":
                category = "effect" if is_effect(node["name"]) else "external"
            elif node["kind"] in ("function", "method", "class", "module"):
                # A function reached through its return value, or through the result of another call.
                category = "returns" if via in ("return", "result") else "runs"
            else:
                category = "value"
        counts[category] += 1
        nodes.append(dict(node, level=level, influence=influence, category=category,
                          where=sorted(arrive[nid]), path=path_to(nid)))
    nodes.insert(0, dict(by_id[center], level=0, influence="source", category="source", where=[], path=[]))

    # Counts, lines and positions above describe everything; only the drawn list is capped,
    # nearest first, because hundreds of nodes cannot be read as a picture.
    total_all = len(affected)
    if max_nodes is not None and total_all > max_nodes:
        truncated = True
        nodes = nodes[:max_nodes + 1]
        keep = {n["id"] for n in nodes}
        induced = [e for e in induced if e["source"] in keep and e["target"] in keep]

    refs = graph.get("refs", [])
    wanted = {n["id"]: set(n["where"]) for n in nodes[1:]}
    affected_refs = [r for r in refs if r["node"] in wanted and r["role"] in ("write", "def", "call")
                     and r["line"] in wanted[r["node"]]]
    lines = sorted(set().union(*arrive.values()) if arrive else set())

    # Constructs pyflow cannot follow, in any scope this result touches.
    scopes = {by_id[center]["scope"], center.split(":", 1)[-1]}
    for n in nodes:  # the capped list is enough: the scopes of what is drawn
        scopes.add(n["scope"])
        if n["kind"] in ("function", "method", "class"):
            scopes.add(n["id"].split(":", 1)[-1])
    warnings = [u for u in graph.get("unsupported", []) if u["scope"] in scopes]

    return {
        "center": center,
        "nodes": nodes,
        "edges": induced,
        "summary": {
            "total": total_all, "shown": len(nodes) - 1,
            "values": counts["value"], "returns": counts["returns"], "runs": counts["runs"],
            "effects": counts["effect"], "external": counts["external"], "callers": counts["caller"],
            "by_condition": sum(1 for n in nodes if n["influence"] == "condition"),
        },
        "lines": lines,
        "source_refs": [r for r in refs if r["node"] == center],
        "affected_refs": affected_refs,
        "warnings": warnings,
        "truncated": truncated,
    }


def function_inside(graph: dict, center: str, families=("call", "data")) -> dict:
    """A function drawn from the inside: its parameters, locals and their flow, plus one step around.

    Level 0 holds the function and everything defined directly in its scope
    (``scope`` in the result names it, so the page can draw a box). Arguments
    landing on its parameters reach parameters, not the function node, so the
    ordinary neighborhood cannot show them; here they do. Nodes one edge away
    are included with level -1 (comes in) or +1 (goes out) and are not expanded
    further, so callers of callers never appear. Locals with no edges at all
    (``y = 100``) are still listed. Nested functions keep their own scope and
    are left out.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    if center not in by_id:
        raise KeyError(center)
    if by_id[center]["kind"] not in ("function", "method"):
        raise ValueError(f"{center} is not a function or method")
    scope = center.split(":", 1)[1]  # fn:Cart.add -> Cart.add, the scope its locals live in
    inside = {center} | {n["id"] for n in graph["nodes"]
                         if n["scope"] == scope and n["kind"] in ("parameter", "variable")}
    allowed = _edge_kinds(families)

    levels = {nid: 0 for nid in inside}
    edges = []
    for e in graph["edges"]:
        if e["kind"] not in allowed:
            continue
        src_in, dst_in = e["source"] in inside, e["target"] in inside
        if not (src_in or dst_in):
            continue
        edges.append(e)
        # The far end of a boundary edge sits on the side its value travels from or to;
        # a node that both feeds in and receives keeps the upstream side.
        if not src_in:
            levels[e["source"]] = -1
        if not dst_in:
            levels.setdefault(e["target"], 1)

    return {
        "center": center,
        "scope": scope,
        "nodes": [dict(by_id[nid], level=lvl) for nid, lvl in levels.items()],
        "edges": edges,
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
