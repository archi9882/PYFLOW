// The page shown in the graph webview. Pure string building, so it is testable without VS Code.

export interface GraphPageOptions {
  nonce: string;
  cspSource: string;
  scripts: { cytoscape: string; dagre: string; cytoscapeDagre: string; graph: string };
  strings: Record<string, string>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function graphHtml(o: GraphPageOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${o.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${o.nonce}'`,
    `img-src ${o.cspSource} data:`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { height: 100%; margin: 0; padding: 0; }
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
         font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); }
  header h1 { font-size: 13px; font-weight: 600; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
           border: 0; border-radius: 3px; padding: 3px 8px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #note { padding: 4px 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  #graph { flex: 1; min-height: 0; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 6px 12px; font-size: 11.5px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-editorWidget-border, #444); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <button id="flow" type="button" title="${esc(o.strings.flow)}">↔ ↕</button>
  <button id="fit" type="button">${esc(o.strings.fit)}</button>
</header>
<div id="note" hidden></div>
<div id="graph" role="img" aria-label="${esc(o.strings.aria)}"></div>
<div class="legend">
  <span><i style="background:#2563eb"></i>${esc(o.strings.legendSource)}</span>
  <span><i style="background:#1f8f74"></i>${esc(o.strings.legendData)}</span>
  <span><i style="background:#7a4fc2"></i>${esc(o.strings.legendCondition)}</span>
  <span><i style="background:#c4552a"></i>${esc(o.strings.legendEffect)}</span>
</div>
<script nonce="${o.nonce}" src="${o.scripts.cytoscape}"></script>
<script nonce="${o.nonce}" src="${o.scripts.dagre}"></script>
<script nonce="${o.nonce}" src="${o.scripts.cytoscapeDagre}"></script>
<script nonce="${o.nonce}" src="${o.scripts.graph}"></script>
</body>
</html>`;
}

// The full web page (the same one the site serves) made loadable in a webview: a <base> so its relative
// paths resolve inside the extension's site/ folder, and a policy that still lets Pyodide run.
export function fullPageHtml(indexHtml: string, baseHref: string, cspSource: string): string {
  const csp = [
    "default-src 'none'",
    // Pyodide compiles WebAssembly and evaluates generated JS.
    `script-src ${cspSource} 'unsafe-eval' 'wasm-unsafe-eval'`,
    // The page has inline style attributes, and Cytoscape sets styles too.
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data: blob:`,
    // fetch() of the analyzer files, the examples and the Pyodide wasm/stdlib.
    `connect-src ${cspSource}`,
  ].join("; ");
  const head = `<base href="${esc(baseHref)}/">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`;
  return indexHtml.replace("<head>", `<head>\n  ${head}`);
}
