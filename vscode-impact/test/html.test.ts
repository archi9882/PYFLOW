import assert from "node:assert/strict";
import test from "node:test";
import { graphHtml } from "../src/html";

test("the graph page only runs scripts that carry its nonce, and escapes its strings", () => {
  const html = graphHtml({
    nonce: "abc123", cspSource: "vscode-webview://x",
    scripts: { cytoscape: "c.js", dagre: "d.js", cytoscapeDagre: "cd.js", graph: "g.js" },
    strings: { flow: 'a "quoted" <b>', fit: "Fit", aria: "Graph", legendSource: "s", legendData: "d", legendCondition: "c", legendEffect: "e" },
  });
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.doesNotMatch(html, /script-src[^"]*unsafe-inline/);
  assert.equal((html.match(/<script nonce="abc123"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&quot;quoted&quot;/);
});
