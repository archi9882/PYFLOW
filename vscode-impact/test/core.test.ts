import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpawn, decorationPlan, displayName, explain, graphPayload, Impact, ImpactNode, langOf, parseOutput,
  summaryText, tr, treeModel,
} from "../src/core";

const node = (over: Partial<ImpactNode>): ImpactNode => ({
  id: "var:f:x", name: "x", kind: "variable", scope: "f", lines: [], flags: [], level: 0,
  influence: "data", category: "value", where: [], path: [], ...over,
});

// price -> line_total -> total() -> print, plus one value reached only through a condition
const sample = (): Impact => ({
  center: "var:price",
  nodes: [
    node({ id: "var:price", name: "price", scope: "<module>", influence: "source", category: "source" }),
    node({ id: "var:f:total", name: "total", scope: "f", level: 1, where: [4], path: [{ from: "var:price", to: "var:f:total", kind: "assign", lines: [4] }] }),
    node({ id: "fn:f", name: "f", kind: "function", scope: "<module>", level: 2, category: "returns", where: [6], path: [
      { from: "var:price", to: "var:f:total", kind: "assign", lines: [4] }, { from: "var:f:total", to: "fn:f", kind: "return", lines: [6] }] }),
    node({ id: "ext:print", name: "print", kind: "external", scope: "", level: 2, category: "effect", where: [5], path: [
      { from: "var:price", to: "var:f:total", kind: "assign", lines: [4] }, { from: "var:f:total", to: "ext:print", kind: "arg", lines: [5] }] }),
    node({ id: "var:f:flag", name: "flag", level: 1, influence: "condition", where: [3], path: [{ from: "var:price", to: "var:f:flag", kind: "control", lines: [3] }] }),
  ],
  edges: [],
  summary: { total: 4, shown: 4, values: 2, returns: 1, runs: 0, effects: 1, external: 0, callers: 0, by_condition: 1 },
  lines: [3, 4, 5, 6],
  source_refs: [{ node: "var:price", line: 2, col: 4, end: 9, role: "read" }, { node: "var:price", line: 1, col: 0, end: 5, role: "write" }],
  affected_refs: [
    { node: "var:f:total", line: 4, col: 4, end: 9, role: "write" },
    { node: "ext:print", line: 5, col: 4, end: 9, role: "call" },
    { node: "var:f:flag", line: 3, col: 4, end: 8, role: "write" },
    { node: "var:f:total", line: 2, col: 4, end: 9, role: "write" }, // same token as a source: the source wins
  ],
  warnings: [], truncated: false,
});

test("the analyzer is started isolated, with 1-based positions and the file name last", () => {
  const { command, args } = buildSpawn("python3", "/ext/python", { line: 9, character: 4, fileName: "a.py", includeConditions: true });
  assert.equal(command, "python3");
  assert.equal(args[0], "-I");
  assert.equal(args[1], "-c");
  assert.deepEqual(args.slice(3), ["/ext/python", "--stdin", "--json", "--impact", "--at", "10:5", "a.py"]);
  const off = buildSpawn("python", "/x", { line: 0, character: 0, fileName: "b.py", includeConditions: false });
  assert.ok(off.args.includes("--no-control"));
});

test("output of every kind becomes an outcome", () => {
  assert.equal(parseOutput(JSON.stringify(sample()), "", 0).ok, true);
  const syntax = parseOutput(JSON.stringify({ error: "syntax", detail: { message: "invalid syntax", line: 3 } }), "", 2);
  assert.deepEqual(syntax, { ok: false, kind: "syntax", message: "invalid syntax", line: 3 });
  assert.equal((parseOutput(JSON.stringify({ error: "nothing_here", detail: "No name" }), "", 1) as any).kind, "nothing_here");
  assert.equal((parseOutput(JSON.stringify({ error: "python_version", detail: "3.8.1" }), "", 3) as any).message, "3.8.1");
  const crash = parseOutput("", "Traceback\n  File x\nValueError: boom", 1);
  assert.equal(crash.ok, false);
  assert.match((crash as any).message, /boom/);
  assert.equal(parseOutput("[1, 2]", "", 0).ok, false);
});

test("marks: 0-based, strongest class per token, whole lines listed", () => {
  const plan = decorationPlan(sample());
  assert.deepEqual(plan.source.map((m) => [m.line, m.start, m.end]).sort(), [[0, 0, 5], [1, 4, 9]]);
  assert.deepEqual(plan.affected, [{ line: 3, start: 4, end: 9 }]);
  assert.deepEqual(plan.effect, [{ line: 4, start: 4, end: 9 }]);
  assert.deepEqual(plan.condition, [{ line: 2, start: 4, end: 8 }]);
  assert.deepEqual(plan.lines, [2, 3, 4, 5]);
});

test("the tree groups by kind, in a fixed order, and says why", () => {
  const groups = treeModel(sample());
  assert.deepEqual(groups.map((g) => g.key), ["value", "returns", "effect"]);
  assert.equal(groups[0].label, "Variables and attributes (2)");
  const total = groups[0].items.find((i) => i.label === "f.total")!;
  assert.equal(total.line, 4);
  const cond = groups[0].items.find((i) => i.label === "f.flag")!;
  assert.equal(cond.condition, true);
  assert.match(cond.description, /condition/);
  const fn = groups[1].items[0];
  assert.equal(fn.label, "f()");
  assert.match(fn.tooltip, /price → f\.total → f\(\)/);
});

test("summary wording: singular, plural, nothing, and Chinese", () => {
  assert.equal(summaryText(sample()), "4 affected: 2 variables, 1 return value, 1 output");
  const empty = sample();
  empty.summary.total = 0;
  assert.equal(summaryText(empty), "Nothing else in this file depends on it.");
  assert.equal(summaryText(sample(), "zh"), "4 處受影響: 2 個變數, 1 個回傳值, 1 個輸出");
  assert.equal(langOf("zh-TW"), "zh");
  assert.equal(langOf("fr"), "en");
  assert.equal(tr("zh", "no.such.key"), "no.such.key");
});

test("names read naturally", () => {
  assert.equal(displayName(node({ kind: "method", id: "fn:Cart.add", name: "add", scope: "Cart" })), "Cart.add()");
  assert.equal(displayName(node({ kind: "attribute", scope: "Cart", name: "items" })), "Cart.items");
  assert.equal(displayName(node({ scope: "<module>", name: "total" })), "total");
});

test("hover explains the source and each affected token, and stays silent elsewhere", () => {
  const impact = sample();
  assert.match(explain(impact, 2, 5)!, /If price changes/);
  assert.match(explain(impact, 4, 6)!, /price → f\.total/);
  assert.match(explain(impact, 3, 5)!, /only through a condition/);
  assert.equal(explain(impact, 9, 0), null);
  assert.equal(explain(impact, 4, 20), null);
});

test("a big result is cut to the nearest nodes and drawn as a tree", () => {
  const big = sample();
  const extra = Array.from({ length: 60 }, (_, i) => node({
    id: `var:g:v${i}`, name: `v${i}`, level: 1,
    path: [{ from: "var:price", to: `var:g:v${i}`, kind: "assign", lines: [1] }],
  }));
  big.nodes.push(...extra);
  big.edges = [
    ...extra.map((n) => ({ source: "var:price", target: n.id, kind: "assign", lines: [1] })),
    ...extra.slice(1).map((n, i) => ({ source: extra[i].id, target: n.id, kind: "assign", lines: [1] })), // cross edges
  ];
  const payload = graphPayload(big, 50);
  assert.equal(payload.nodes.length, 51);
  assert.equal(payload.truncated, true);
  assert.ok(payload.edges.every((e) => e.source === "var:price"), "only the edge that brought each node in");
  const small = graphPayload(sample(), 150);
  assert.equal(small.truncated, false);
});
