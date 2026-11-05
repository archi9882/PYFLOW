import assert from "node:assert/strict";
import test from "node:test";
import { fullPageHtml } from "../src/html";

test("the full page gets a base and a policy that lets Pyodide run", () => {
  const out = fullPageHtml("<html><head><title>x</title></head></html>", "vscode-webview://abc/site", "vscode-resource:");
  assert.match(out, /<head>\n\s*<base href="vscode-webview:\/\/abc\/site\/">/);
  assert.match(out, /script-src vscode-resource: 'unsafe-eval' 'wasm-unsafe-eval'/);
  assert.match(out, /default-src 'none'/);
  assert.ok(out.includes("<title>x</title>")); // the rest of the page is untouched
});
