// pyflow details panel: how values and calls enter and leave one node.
// Pure functions without DOM access, so tests/test_flow.py can run them under Node.
// In the browser this file is loaded before app.js and defines a global flowSections.
"use strict";

const CALLABLE_KINDS = new Set(["module", "function", "method", "class", "external"]);

// Details rows as [labelKey, items]; each item is {id, text, lines} pointing at the other end.
// ctx supplies what lives in app.js:
//   nodesById  Map of node id -> node
//   t          t(key, vars) translation
//   label      label(node) -> display name, e.g. "run_pipeline.rows"
function flowSections(node, edges, ctx) {
  const { nodesById: byId, t, label } = ctx;
  const name = (id) => { const n = byId.get(id); return n ? label(n) : id; };
  // One item per (other node, wording); parallel edges merge their line numbers.
  const items = (list, text, other) => {
    const merged = new Map();
    for (const e of list) {
      const id = other(e), wording = text(e), key = `${id}|${wording}`;
      if (!merged.has(key)) merged.set(key, { id, text: wording, lines: [] });
      merged.get(key).lines.push(...e.lines);
    }
    return [...merged.values()].map((it) => ({ ...it, lines: [...new Set(it.lines)].sort((a, b) => a - b) }));
  };
  const into = edges.filter((e) => e.target === node.id);
  const out = edges.filter((e) => e.source === node.id);

  if (CALLABLE_KINDS.has(node.kind)) {
    // A function's locals live in the scope named after it (fn:Cart.add -> Cart.add).
    // Arguments land on its parameters (or dataclass fields), not on the function node.
    const inner = node.id.slice(node.id.indexOf(":") + 1);
    const isInput = (id) => {
      const n = byId.get(id);
      return n && n.scope === inner && (n.kind === "parameter" || n.kind === "attribute");
    };
    // A result edge means "the call's value goes there": into a parameter or an
    // external call it is an argument (f(g()), print(g())); into one of the file's
    // own functions it is that function's return value (return g()).
    const external = node.kind === "external";
    const passed = (e) => e.kind === "arg" || e.kind === "result";
    const args = edges.filter((e) => passed(e) && (isInput(e.target) || (external && e.target === node.id)));
    const value = (e) => e.kind === "result" ? t("f.returned", { fn: name(e.source) }) : name(e.source);
    const argText = (e) => e.target === node.id ? value(e)
      : t("f.argTo", { param: byId.get(e.target).name, src: value(e) });
    const returns = into.filter((e) => e.kind === "return" || (e.kind === "result" && !external));
    const resText = (e) => {
      const n = byId.get(e.target);
      if (n && n.kind === "external") return t("f.extArg", { fn: n.name });
      if (n && CALLABLE_KINDS.has(n.kind)) return t("f.retOf", { fn: name(e.target) });
      // Attributes are left as names: `self.x = f()` is an assignment, not an argument.
      if (n && n.kind === "parameter") return t("f.paramOf", { param: n.name, fn: n.scope });
      return name(e.target);
    };
    return [
      ["d.calledBy", items(into.filter((e) => e.kind === "call"), (e) => name(e.source), (e) => e.source)],
      ["d.args", items(args, argText, (e) => e.source)],
      ["d.returns", items(returns, value, (e) => e.source)],
      ["d.resultTo", items(out.filter((e) => e.kind === "result"), resText, (e) => e.target)],
      ["d.calls", items(out.filter((e) => e.kind === "call"), (e) => name(e.target), (e) => e.target)],
      ["d.locals", external ? [] : locals(byId, inner)],
    ];
  }

  // Variables, parameters and attributes: say how each value arrives and leaves.
  const fromText = (e) => e.kind === "result" ? t("f.returned", { fn: name(e.source) }) : name(e.source);
  const toText = (e) => {
    const n = byId.get(e.target);
    if (e.kind === "arg" && n && (n.kind === "parameter" || n.kind === "attribute")) return t("f.paramOf", { param: n.name, fn: n.scope });
    if (e.kind === "arg" && n && n.kind === "external") return t("f.extArg", { fn: n.name });
    if (e.kind === "return") return t("f.retOf", { fn: name(e.target) });
    return name(e.target);
  };
  return [
    ["d.in", items(into, fromText, (e) => e.source)],
    ["d.out", items(out, toText, (e) => e.target)],
  ];
}

// Parameters and variables defined in a scope, in source order. Taken from the nodes, not
// the edges, so a value that flows nowhere (`y = 100`) is still listed.
function locals(byId, scope) {
  return [...byId.values()]
    .filter((n) => n.scope === scope && (n.kind === "parameter" || n.kind === "variable"))
    .sort((a, b) => (a.lines[0] ?? 0) - (b.lines[0] ?? 0))
    .map((n) => ({ id: n.id, text: n.name, lines: n.lines }));
}

// Node (tests) only; browsers have no `module` and keep the global above.
if (typeof module !== "undefined") module.exports = { flowSections };
