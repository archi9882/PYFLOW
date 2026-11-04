// The full view: the whole pyflow web page in a panel beside the editor. It is the same page the
// site serves, so it behaves exactly like the web version (search, class boxes, details, ...).
// The page is built into site/ by `npm run prepare-assets`; the .py file being edited is sent to it.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { fullPageHtml } from "./html";

export class FullView {
  private panel: vscode.WebviewPanel | undefined;
  private shown: string | undefined; // the document the page currently shows, so saves of other files are ignored

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand("pyflow.openFull", () => this.open()),
      // Switching editors: focusing the panel itself gives no editor, so the last file stays.
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) this.send(editor.document); }),
      vscode.workspace.onDidSaveTextDocument((doc) => { if (doc.uri.toString() === this.shown) this.send(doc); }),
    );
  }

  private open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const siteDir = path.join(this.context.extensionPath, "site");
    const indexFile = path.join(siteDir, "index.html");
    if (!fs.existsSync(indexFile)) {
      void vscode.window.showErrorMessage("pyflow: site/ is missing. Run `npm run prepare-assets` in vscode-impact/ first.");
      return;
    }
    const siteUri = vscode.Uri.file(siteDir);
    const panel = vscode.window.createWebviewPanel("pyflow.full", "pyflow", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [siteUri],
    });
    this.panel = panel;
    panel.webview.html = fullPageHtml(fs.readFileSync(indexFile, "utf8"), panel.webview.asWebviewUri(siteUri).toString(), panel.webview.cspSource);
    // The page says "ready" once it listens; "refresh" asks again when it is shown, unsaved edits included.
    panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg?.type === "ready") this.send(vscode.window.activeTextEditor?.document);
      if (msg?.type === "refresh") {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.shown);
        this.send(doc ?? vscode.window.activeTextEditor?.document);
      }
    }, null, this.context.subscriptions);
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.shown = undefined; } }, null, this.context.subscriptions);
  }

  // Python files on disk or unsaved; virtual documents such as git diff views are skipped.
  private send(doc: vscode.TextDocument | undefined): void {
    if (!this.panel || !doc || doc.languageId !== "python" || !["file", "untitled"].includes(doc.uri.scheme)) return;
    this.shown = doc.uri.toString();
    const name = path.basename(doc.fileName);
    this.panel.title = `pyflow · ${name}`;
    void this.panel.webview.postMessage({ type: "file", name, path: this.shown, text: doc.getText() });
  }
}
