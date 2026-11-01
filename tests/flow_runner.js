// Test helper for test_flow.py: runs web/flow.js under Node.
// stdin:  {"graph": <analyze() output>, "ids": ["fn:clean", ...]}
// stdout: {"fn:clean": {"d.args": [["<text>", [lines]], ...], ...}, ...}
"use strict";

const path = require("path");
const { flowSections } = require(path.join(__dirname, "..", "web", "flow.js"));

// Wording is not under test, so t() spells out the key and its values instead.
const t = (key, vars = {}) =>
  `${key}(${Object.keys(vars).sort().map((k) => `${k}=${vars[k]}`).join(", ")})`;
// Same display names as app.js: qualified, with the module shown as "module".
const label = (n) => n.kind === "module" ? "module"
  : n.scope && n.scope !== "<module>" ? `${n.scope}.${n.name}` : n.name;

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const { graph, ids } = JSON.parse(input);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const result = {};
  for (const id of ids) {
    result[id] = {};
    for (const [key, items] of flowSections(nodesById.get(id), graph.edges, { nodesById, t, label })) {
      if (items.length) result[id][key] = items.map((it) => [it.text, it.lines]);
    }
  }
  process.stdout.write(JSON.stringify(result));
});
