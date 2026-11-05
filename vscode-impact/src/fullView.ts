// The full view: the whole pyflow web page in a panel beside the editor. It is the same page the
// site serves, so it behaves exactly like the web version (search, class boxes, details, ...).
// The page is built into site/ by `npm run prepare-assets`; the .py file being edited is sent to it.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { fullPageHtml } from "./html";

export class FullView {
  private panel: vscode.WebviewPanel | undefined;
  private pendingFocus: { line: number; col: number } | undefined; // 面板剛開、頁面尚未 ready 時暫存的游標位置
  private shown: string | undefined; // the document the page currently shows, so saves of other files are ignored
  private sentVersion = -1; // 網頁目前拿到的文件版本；內容有變時游標行號可能對不上，要重送整個檔案
  private followTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand("pyflow.openFull", () => this.open()),
      // Switching editors: focusing the panel itself gives no editor, so the last file stays.
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) this.send(editor.document); }),
      vscode.workspace.onDidSaveTextDocument((doc) => { if (doc.uri.toString() === this.shown) this.send(doc); }),
      // 游標移動時網頁跟著改問該名稱；稍等一下，避免連續移動時一直重畫
      vscode.window.onDidChangeTextEditorSelection((e) => this.follow(e.textEditor)),
      { dispose: () => clearTimeout(this.followTimer) },
    );
  }

  // 游標所在的位置：開啟、再次執行指令、游標移動時都會帶給網頁
  private cursorFocus(): { line: number; col: number } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "python") return undefined;
    const pos = editor.selection.active; // line 為 0 起算；character 本來就是 UTF-16
    return { line: pos.line + 1, col: pos.character };
  }

  private follow(editor: vscode.TextEditor): void {
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => {
      const doc = editor.document;
      // 只跟隨網頁目前顯示的那個檔案（點進面板本身或其他檔案時不動作）
      if (!this.panel || doc.uri.toString() !== this.shown || editor !== vscode.window.activeTextEditor) return;
      const focus = this.cursorFocus();
      if (!focus) return;
      if (doc.version === this.sentVersion) void this.panel.webview.postMessage({ type: "cursor", focus });
      else this.send(doc, focus); // 有未存檔的修改：連同新內容一起送
    }, 250);
  }

  private open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.send(vscode.window.activeTextEditor?.document, this.cursorFocus());
      return;
    }
    this.pendingFocus = this.cursorFocus();
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
      if (msg?.type === "ready") {
        this.send(vscode.window.activeTextEditor?.document, this.pendingFocus);
        this.pendingFocus = undefined;
      }
      if (msg?.type === "refresh") {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.shown);
        this.send(doc ?? vscode.window.activeTextEditor?.document);
      }
    }, null, this.context.subscriptions);
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.shown = undefined; } }, null, this.context.subscriptions);
  }

  // Python files on disk or unsaved; virtual documents such as git diff views are skipped.
  private send(doc: vscode.TextDocument | undefined, focus?: { line: number; col: number }): void {
    if (!this.panel || !doc || doc.languageId !== "python" || !["file", "untitled"].includes(doc.uri.scheme)) return;
    this.shown = doc.uri.toString();
    this.sentVersion = doc.version;
    const name = path.basename(doc.fileName);
    this.panel.title = `pyflow · ${name}`;
    void this.panel.webview.postMessage({ type: "file", name, path: this.shown, text: doc.getText(), focus });
  }
}
