"""Command line interface.

    pyflow FILE                         summary and the spots pyflow cannot follow
    pyflow FILE -q NAME                 upstream / downstream neighbourhood of a name
    pyflow FILE -q NAME --impact        what changes if NAME changes
    pyflow FILE --at LINE:COL --impact  same, for the name under a cursor position
    pyflow - --stdin ...                read the source from standard input (editors)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analyzer import analyze
from .graph import impact, locate, search, subgraph

ARROWS = {"call": "calls", "assign": "assign", "arg": "arg", "return": "return", "result": "result",
          "control": "decides"}

# Order and titles of the groups in the impact report.
GROUPS = [
    ("value", "Variables and attributes that change"),
    ("returns", "Functions whose return value changes"),
    ("effect", "Output and side effects that change"),
    ("external", "Passed into library / builtin calls"),
    ("runs", "Functions that run differently"),
    ("caller", "Callers affected"),
]


def _label(node: dict) -> str:
    """``total (variable in main)`` style label for terminal output."""
    where = f" in {node['scope']}" if node["scope"] else ""
    return f"{node['name']} ({node['kind']}{where})"


def _short(node: dict) -> str:
    """Compact name for a path step: ``Cart.add`` for methods, ``name`` otherwise."""
    if node["kind"] in ("function", "method", "class"):
        return node["id"].split(":", 1)[1] + ("()" if node["kind"] != "class" else "")
    if node["kind"] in ("attribute", "variable", "parameter") and node["scope"] not in ("", "<module>"):
        return f"{node['scope']}.{node['name']}"  # the scope tells same-named variables apart
    return node["name"]


def _print_neighborhood(graph: dict, center: str, depth: int, direction: str) -> None:
    sub = subgraph(graph, center, depth, direction, ("call", "data", "control"))
    by_id = {n["id"]: n for n in sub["nodes"]}
    print(f"Center: {_label(by_id[center])}")
    for title, sign in (("Upstream (comes from)", -1), ("Downstream (goes to)", 1)):
        rows = [n for n in sub["nodes"] if n["level"] * sign > 0]
        if not rows:
            continue
        print(f"\n{title}:")
        for node in sorted(rows, key=lambda n: (abs(n["level"]), n["id"])):
            print(f"  [{abs(node['level'])}] {_label(node)}")
    print("\nEdges:")
    for e in sub["edges"]:
        lines = ",".join(map(str, e["lines"]))
        print(f"  {by_id[e['source']]['name']} -[{ARROWS[e['kind']]}]-> {by_id[e['target']]['name']}  (line {lines})")


def format_report(result: dict) -> str:
    """Plain-text answer to "what changes if this changes?", with the reason for each item."""
    by_id = {n["id"]: n for n in result["nodes"]}
    center = by_id[result["center"]]
    s = result["summary"]
    out = [f"If {_short(center)} changes ({_label(center)}):", ""]
    if not s["total"]:
        out.append("  Nothing else in this file depends on it.")
    else:
        parts = [(s["values"], "variable"), (s["returns"], "return value"), (s["effects"], "output"),
                 (s["runs"], "function that runs differently"), (s["callers"], "caller")]
        bits = [f"{n} {word}{'' if n == 1 else 's'}" for n, word in parts if n]
        out.append(f"  {s['total']} things are affected: " + ", ".join(bits) + ".")
        if s["by_condition"]:
            out.append(f"  {s['by_condition']} of them only through a condition (if / loop / guard).")
    for key, title in GROUPS:
        rows = [n for n in result["nodes"][1:] if n["category"] == key]
        if not rows:
            continue
        out += ["", f"{title} ({len(rows)}):"]
        for n in rows:
            where = ", ".join(f"line {ln}" for ln in n["where"][:3])
            mark = "  [condition]" if n["influence"] == "condition" else ""
            out.append(f"  {_short(n):<28} {where}{mark}")
            steps = [_short(by_id[result["center"]])] + [_short(by_id.get(st["to"], {"id": st["to"], "kind": "x", "name": st["to"]}))
                                                         for st in n["path"]]
            if len(steps) > 2:
                out.append(f"      via {' -> '.join(steps)}")
    if result["truncated"]:
        out += ["", "  (more results exist beyond the depth or size limit)"]
    if result["warnings"]:
        out += ["", "pyflow cannot follow these spots, so the result may be incomplete:"]
        for w in result["warnings"]:
            out.append(f"  line {w['lines'][0]}: {w['detail']} ({w['kind']}) in {w['scope']}")
    return "\n".join(out)


def _read_source(args: argparse.Namespace) -> tuple[str, str]:
    if args.stdin:
        return sys.stdin.buffer.read().decode("utf-8", "replace"), str(args.file)
    return args.file.read_text(encoding="utf-8"), str(args.file)


def _parse_at(text: str) -> tuple[int, int]:
    """``LINE:COL`` with 1-based line and column, as editors show them."""
    line, _, col = text.partition(":")
    return int(line), max(int(col or 1) - 1, 0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pyflow", description="See what a change to a name in a Python file affects.")
    parser.add_argument("file", type=Path, help="Python file to analyze (any name with --stdin)")
    parser.add_argument("-q", "--query", help="variable or function name to look up")
    parser.add_argument("--at", metavar="LINE:COL", help="look up the name at this position (1-based, like an editor)")
    parser.add_argument("--impact", action="store_true", help="report what changes if the name changes")
    parser.add_argument("-d", "--depth", type=int, default=None, help="steps to follow (default: 2, or unlimited with --impact)")
    parser.add_argument("--direction", choices=["both", "upstream", "downstream"], default="both")
    parser.add_argument("--no-control", action="store_true", help="with --impact: ignore if / loop conditions")
    parser.add_argument("--stdin", action="store_true", help="read the source from standard input")
    parser.add_argument("--json", action="store_true", help="print JSON (the whole graph, or the impact result)")
    args = parser.parse_args(argv)

    source, name = _read_source(args)
    graph = analyze(source, name)
    if graph["error"]:
        if args.json:
            print(json.dumps({"error": "syntax", "detail": graph["error"]}))
        else:
            print(f"Syntax error on line {graph['error']['line']}: {graph['error']['message']}", file=sys.stderr)
        return 2
    if args.json and not (args.impact or args.query or args.at):
        print(json.dumps(graph, indent=2))
        return 0
    if not (args.query or args.at):
        s = graph["stats"]
        print(f"{args.file}: {s['functions']} functions/classes, {s['variables']} variables, {s['edges']} edges")
        for u in graph["unsupported"]:
            print(f"  unsupported {u['kind']}: {u['detail']} in {u['scope']} (line {u['lines'][0]})")
        return 0

    # Resolve the name the user means.
    if args.at:
        line, col = _parse_at(args.at)
        matches = locate(graph, line, col)
        if not matches:
            message = f"No variable or function name at {args.at}."
            print(json.dumps({"error": "nothing_here", "detail": message}) if args.json else message, file=sys.stderr if not args.json else sys.stdout)
            return 1
    else:
        matches = search(graph, args.query)
        if not matches:
            print(f"No name matches '{args.query}'.", file=sys.stderr)
            return 1
        if len(matches) > 1 and matches[0]["score"] == matches[1]["score"] and not args.json:
            print("Several matches; showing the first. Candidates:")
            for m in matches[:10]:
                print(f"  {_label(m)}")
            print()
    chosen = matches[0]

    if args.impact:
        result = impact(graph, chosen["id"], args.depth, not args.no_control)
        if args.json:
            print(json.dumps(dict(result, name=name, candidates=[m["id"] for m in matches])))
        else:
            print(format_report(result))
        return 0
    _print_neighborhood(graph, chosen["id"], args.depth if args.depth is not None else 2, args.direction)
    return 0
