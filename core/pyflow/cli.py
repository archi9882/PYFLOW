"""Command line interface: ``python -m pyflow FILE [-q NAME]``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analyzer import analyze
from .graph import search, subgraph

ARROWS = {"call": "calls", "assign": "assign", "arg": "arg", "return": "return", "result": "result"}


def _label(node: dict) -> str:
    """``total (variable in main)`` style label for terminal output."""
    where = f" in {node['scope']}" if node["scope"] else ""
    return f"{node['name']} ({node['kind']}{where})"


def _print_neighborhood(graph: dict, center: str, depth: int, direction: str) -> None:
    sub = subgraph(graph, center, depth, direction)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pyflow", description="Show how a name flows through a Python file.")
    parser.add_argument("file", type=Path, help="Python file to analyze")
    parser.add_argument("-q", "--query", help="variable or function name to look up")
    parser.add_argument("-d", "--depth", type=int, default=2, help="steps to follow (default 2)")
    parser.add_argument("--direction", choices=["both", "upstream", "downstream"], default="both")
    parser.add_argument("--json", action="store_true", help="print the full graph as JSON")
    args = parser.parse_args(argv)

    graph = analyze(args.file.read_text(encoding="utf-8"), str(args.file))
    if graph["error"]:
        print(f"Syntax error on line {graph['error']['line']}: {graph['error']['message']}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(graph, indent=2))
        return 0
    if not args.query:
        s = graph["stats"]
        print(f"{args.file}: {s['functions']} functions/classes, {s['variables']} variables, {s['edges']} edges")
        for u in graph["unsupported"]:
            print(f"  unsupported {u['kind']}: {u['detail']} in {u['scope']} (line {u['lines'][0]})")
        return 0

    matches = search(graph, args.query)
    if not matches:
        print(f"No name matches '{args.query}'.", file=sys.stderr)
        return 1
    if len(matches) > 1 and matches[0]["score"] == matches[1]["score"]:
        # Ambiguous: show the candidates, then use the first one.
        print("Several matches; showing the first. Candidates:")
        for m in matches[:10]:
            print(f"  {_label(m)}")
        print()
    _print_neighborhood(graph, matches[0]["id"], args.depth, args.direction)
    return 0
