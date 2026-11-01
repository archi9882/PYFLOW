// pyflow VS Code extension: shows the pyflow graph in a panel beside the editor.
// The panel loads the same web page as the site, built into media/ by
// `python scripts/build_site.py vscode/media` (run from pyflow/).
// Stage 3: the .py file you are viewing is sent to the panel, and re-sent when saved.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

// Only one panel at a time; running the command again brings it back to front.
let panel = null;
// The document currently shown in the panel, so saves of other files are ignored.
let shown = null;

// Turns media/index.html into something the webview accepts: a <base> so relative
// paths resolve to media/, and a Content Security Policy that still lets Pyodide run.
function pageHtml(webview, mediaUri, mediaDir) {
  const html = fs.readFileSync(path.join(mediaDir, "index.html"), "utf8");
  const src = webview.cspSource;
  const csp = [
    "default-src 'none'",
    // Pyodide compiles WebAssembly and evaluates generated JS.
    `script-src ${src} 'unsafe-eval' 'wasm-unsafe-eval'`,
    // index.html has a few inline style attributes; Cytoscape also sets styles.
    `style-src ${src} 'unsafe-inline'`,
    `font-src ${src}`,
    `img-src ${src} data: blob:`,
    // fetch() of the analyzer .py files, examples and the Pyodide wasm/stdlib.
    `connect-src ${src}`,
  ].join("; ");
  const head = `<base href="${webview.asWebviewUri(mediaUri)}/">\n` +
    `  <meta http-equiv="Content-Security-Policy" content="${csp}">`;
  return html.replace("<head>", `<head>\n  ${head}`);
}

// Python files on disk or unsaved; skips virtual documents such as git diff views.
function isPython(doc) {
  return doc && doc.languageId === "python" && (doc.uri.scheme === "file" || doc.uri.scheme === "untitled");
}

function sendDocument(doc) {
  if (!panel || !isPython(doc)) return;
  shown = doc.uri.toString();
  const name = path.basename(doc.fileName);
  panel.title = `pyflow · ${name}`;
  panel.webview.postMessage({ type: "file", name, path: shown, text: doc.getText() });
}

function activate(context) {
  const mediaDir = path.join(context.extensionPath, "media");
  const mediaUri = vscode.Uri.file(mediaDir);

  context.subscriptions.push(
    vscode.commands.registerCommand("pyflow.open", () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        return;
      }
      if (!fs.existsSync(path.join(mediaDir, "index.html"))) {
        vscode.window.showErrorMessage(
          "pyflow: media/ is missing. Run `python scripts/build_site.py vscode/media` in pyflow/ first.");
        return;
      }
      panel = vscode.window.createWebviewPanel(
        "pyflow",
        "pyflow",
        // Beside keeps the .py file visible on the left.
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaUri] }
      );
      panel.webview.html = pageHtml(panel.webview, mediaUri, mediaDir);
      // The page says "ready" once it listens; only then is the current file sent.
      // "refresh" re-sends the file on show from its open document, unsaved edits included.
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg && msg.type === "ready") sendDocument(vscode.window.activeTextEditor?.document);
        if (msg && msg.type === "refresh") {
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === shown);
          sendDocument(doc || vscode.window.activeTextEditor?.document);
        }
      }, null, context.subscriptions);
      panel.onDidDispose(() => { panel = null; shown = null; }, null, context.subscriptions);
    }),

    // Switching editors: focusing the panel itself gives no editor, so keep the last file.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) sendDocument(editor.document);
    }),

    // Saving the file on show re-analyzes it; saves of other files are ignored.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === shown) sendDocument(doc);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
