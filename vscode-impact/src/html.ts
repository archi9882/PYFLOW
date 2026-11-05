// HTML for the full view webview. Pure string building, so it is testable without VS Code.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

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
