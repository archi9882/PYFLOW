// VS Code wiring: runs the analyzer for the name under the cursor and shows the answer as
// marks in the editor, a tree in the Explorer, hovers, a status bar item and a graph.
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import {
  decorationPlan, displayName, explain, graphPayload, Impact, langOf, summaryText, tr, treeModel, TreeGroup, TreeItem,
} from "./core";
import { graphHtml } from "./html";
import { probePython, runAnalyzer } from "./runner";

interface Result { uri: string; version: number; impact: Impact }

type TreeNode =
  | { kind: "summary"; text: string }
  | { kind: "group"; group: TreeGroup }
  | { kind: "item"; item: TreeItem };

// The Explorer view: a summary line, then the affected places by kind. Clicking one opens its line.
class ImpactTree implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private summary = "";
  private groups: TreeGroup[] = [];
  private uri: vscode.Uri | null = null;

  set(uri: vscode.Uri | null, summary: string, groups: TreeGroup[]): void {
    this.uri = uri;
    this.summary = summary;
    this.groups = groups;
    this.emitter.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "summary") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("flame");
      return item;
    }
    if (node.kind === "group") {
      return new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
    }
    const item = new vscode.TreeItem(node.item.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.item.description;
    item.tooltip = node.item.tooltip || undefined;
    item.iconPath = new vscode.ThemeIcon(node.item.condition ? "git-compare" : "arrow-right");
    if (this.uri && node.item.line) {
      item.command = { command: "pyflow.reveal", title: "Show in editor", arguments: [this.uri, node.item.line] };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this.summary ? [{ kind: "summary", text: this.summary }, ...this.groups.map((group) => ({ kind: "group" as const, group }))] : [];
    return node.kind === "group" ? node.group.items.map((item) => ({ kind: "item" as const, item })) : [];
  }
}

class Controller {
  private result: Result | null = null;
  private run = 0; // newest request wins when the command is triggered twice quickly
  private panel: vscode.WebviewPanel | undefined;
  private readonly lang = langOf(vscode.env.language);
  private readonly tree = new ImpactTree();
  private readonly treeView: vscode.TreeView<TreeNode>;
  private readonly status: vscode.StatusBarItem;
  private readonly types: Record<"source" | "affected" | "condition" | "effect" | "line", vscode.TextEditorDecorationType>;

  constructor(private readonly context: vscode.ExtensionContext) {
    const mark = (color: string, extra: vscode.DecorationRenderOptions = {}) =>
      vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor(color), borderRadius: "3px", ...extra });
    this.types = {
      source: mark("pyflow.sourceBackground", { fontWeight: "bold" }),
      affected: mark("pyflow.affectedBackground"),
      condition: mark("pyflow.conditionBackground", { border: "1px dotted", borderColor: new vscode.ThemeColor("pyflow.conditionBackground") }),
      effect: mark("pyflow.effectBackground", { fontWeight: "bold" }),
      line: vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor("pyflow.lineBackground"),
        overviewRulerColor: new vscode.ThemeColor("pyflow.affectedBackground"),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
      }),
    };
    this.treeView = vscode.window.createTreeView("pyflow.impact", { treeDataProvider: this.tree });
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = "pyflow.showGraph";

    const subs = context.subscriptions;
    subs.push(
      this.treeView, this.status, ...Object.values(this.types),
      vscode.commands.registerCommand("pyflow.showImpact", () => this.showImpact()),
      vscode.commands.registerCommand("pyflow.showGraph", () => this.showGraph()),
      vscode.commands.registerCommand("pyflow.clear", () => this.clear()),
      vscode.commands.registerCommand("pyflow.reveal", (uri: vscode.Uri, line: number) => this.reveal(uri, line)),
      vscode.languages.registerHoverProvider({ language: "python" }, { provideHover: (doc, pos) => this.hover(doc, pos) }),
      // Marks follow the document to every editor that shows it; an edit makes their positions stale.
      vscode.window.onDidChangeVisibleTextEditors(() => this.paintAll()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.result && e.document.uri.toString() === this.result.uri && e.contentChanges.length > 0) {
          this.clear();
          vscode.window.setStatusBarMessage(tr(this.lang, "staleHint"), 4000);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) => { if (this.result?.uri === d.uri.toString()) this.clear(); }),
    );
  }

  private t(key: string, vars: Record<string, string | number> = {}): string { return tr(this.lang, key, vars); }

  // ----- the command

  async showImpact(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (editor.document.languageId !== "python") {
      void vscode.window.showInformationMessage(this.t("notPython"));
      return;
    }
    const doc = editor.document;
    const position = editor.selection.active;
    const config = vscode.workspace.getConfiguration("pyflow");
    const python = await this.resolvePython(doc.uri);
    const mine = ++this.run;

    this.status.text = `$(sync~spin) ${this.t("running")}`;
    this.status.tooltip = undefined;
    this.status.show();
    const outcome = await runAnalyzer(python, path.join(this.context.extensionPath, "python"), doc.getText(), {
      line: position.line, character: position.character,
      fileName: path.basename(doc.fileName) || "untitled.py",
      includeConditions: config.get<boolean>("includeConditions", true),
    });
    if (mine !== this.run) return; // a newer request replaced this one

    if (!outcome.ok) {
      this.clear();
      switch (outcome.kind) {
        case "nothing_here": void vscode.window.showInformationMessage(this.t("noName")); break;
        case "syntax": void vscode.window.showWarningMessage(this.t("syntax", { line: outcome.line ?? "?", message: outcome.message })); break;
        case "python_version": void this.offerSettings(this.t("pyVersion", { path: python, version: outcome.message })); break;
        case "no_python": void this.offerSettings(this.t("noPython", { path: python })); break;
        default: void vscode.window.showErrorMessage(this.t("crash", { message: outcome.message }));
      }
      return;
    }
    this.result = { uri: doc.uri.toString(), version: doc.version, impact: outcome.impact };
    this.show();
  }

  private async offerSettings(message: string): Promise<void> {
    const open = this.t("openSettings");
    const pick = await vscode.window.showErrorMessage(message, open);
    if (pick === open) void vscode.commands.executeCommand("workbench.action.openSettings", "pyflow.pythonPath");
  }

  // The configured interpreter, else the one selected in the Python extension, else the one on PATH.
  private async resolvePython(resource: vscode.Uri): Promise<string> {
    const configured = vscode.workspace.getConfiguration("pyflow").get<string>("pythonPath", "").trim();
    if (configured) return configured;
    try {
      const ext = vscode.extensions.getExtension("ms-python.python");
      if (ext) {
        const api = await ext.activate();
        const env = api?.environments?.getActiveEnvironmentPath?.(resource);
        if (env?.path) return env.path as string;
      }
    } catch { /* the Python extension is optional; fall through */ }
    // On Windows plain `python` may be the Store stub, so try the Python Launcher first and verify each candidate.
    if (process.platform === "win32") {
      return (await probePython("py", ["-3"])) ?? (await probePython("python")) ?? "python";
    }
    return "python3";
  }

  // ----- showing a result

  private show(): void {
    const r = this.result;
    if (!r) return;
    const impact = r.impact;
    const name = displayName(impact.nodes[0]);
    const summary = summaryText(impact, this.lang);
    this.tree.set(vscode.Uri.parse(r.uri), summary, treeModel(impact, this.lang));
    this.treeView.title = this.t("ifChanges", { name });
    this.treeView.description = summary;
    void vscode.commands.executeCommand("setContext", "pyflow.hasResult", true);
    this.status.text = `$(flame) ${this.t("affected", { n: impact.summary.total })}`;
    this.status.tooltip = `${this.t("ifChanges", { name })}\n${this.t("statusTip")}`;
    this.status.show();
    this.paintAll();
    this.sendGraph();
    if (impact.warnings.length) {
      const what = impact.warnings.slice(0, 3).map((w) => `${w.detail} (L${w.lines[0]})`).join(", ");
      vscode.window.setStatusBarMessage(this.t("incomplete", { what }), 6000);
    }
  }

  private paintAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.paint(editor);
  }

  private paint(editor: vscode.TextEditor): void {
    const r = this.result;
    const matches = r && editor.document.uri.toString() === r.uri && editor.document.version === r.version;
    const plan = matches && r ? decorationPlan(r.impact) : { source: [], affected: [], condition: [], effect: [], lines: [] };
    const range = (m: { line: number; start: number; end: number }) => new vscode.Range(m.line, m.start, m.line, m.end);
    editor.setDecorations(this.types.source, plan.source.map(range));
    editor.setDecorations(this.types.affected, plan.affected.map(range));
    editor.setDecorations(this.types.condition, plan.condition.map(range));
    editor.setDecorations(this.types.effect, plan.effect.map(range));
    editor.setDecorations(this.types.line, plan.lines.map((l) => new vscode.Range(l, 0, l, 0)));
  }

  clear(): void {
    this.run++;
    this.result = null;
    this.tree.set(null, "", []);
    void vscode.commands.executeCommand("setContext", "pyflow.hasResult", false);
    this.status.hide();
    this.paintAll();
    this.panel?.dispose();
  }

  private hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.result;
    if (!r || doc.uri.toString() !== r.uri || doc.version !== r.version) return null;
    const text = explain(r.impact, pos.line + 1, pos.character, this.lang);
    return text ? new vscode.Hover(new vscode.MarkdownString(text)) : null;
  }

  async reveal(uri: vscode.Uri, line: number): Promise<void> {
    const target = new vscode.Range(line - 1, 0, line - 1, 0);
    const editor = await vscode.window.showTextDocument(uri, { selection: target, preserveFocus: false });
    editor.revealRange(target, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // ----- graph panel

  async showGraph(): Promise<void> {
    if (!this.result) {
      void vscode.window.showInformationMessage(this.t("noResult"));
      return;
    }
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.sendGraph();
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("pyflow.graph", "pyflow", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
    });
    this.panel = panel;
    const uri = (...parts: string[]) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, ...parts)).toString();
    panel.webview.html = graphHtml({
      nonce: crypto.randomBytes(16).toString("hex"),
      cspSource: panel.webview.cspSource,
      scripts: {
        cytoscape: uri("vendor", "cytoscape.min.js"), dagre: uri("vendor", "dagre.min.js"),
        cytoscapeDagre: uri("vendor", "cytoscape-dagre.js"), graph: uri("graph.js"),
      },
      strings: this.pageStrings(),
    });
    panel.webview.onDidReceiveMessage((m: { type: string; line?: number }) => {
      if (m.type === "ready") this.sendGraph();
      if (m.type === "reveal" && m.line && this.result) void this.reveal(vscode.Uri.parse(this.result.uri), m.line);
    });
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
  }

  private pageStrings(): Record<string, string> {
    const zh = this.lang === "zh";
    return {
      flow: zh ? "切換由左至右／由上而下" : "Switch between left-to-right and top-to-bottom",
      fit: zh ? "符合視窗" : "Fit",
      aria: zh ? "影響圖" : "Impact graph",
      legendSource: zh ? "你選的名稱" : "the name you picked",
      legendData: zh ? "經由資料" : "through data",
      legendCondition: zh ? "僅經由條件" : "only through a condition",
      legendEffect: zh ? "輸出／副作用" : "output / side effect",
    };
  }

  private sendGraph(): void {
    const r = this.result;
    if (!this.panel || !r) return;
    const max = vscode.workspace.getConfiguration("pyflow").get<number>("maxGraphNodes", 150);
    const data = graphPayload(r.impact, max);
    const name = displayName(r.impact.nodes[0]);
    const strings: Record<string, string> = {
      title: `${this.t("ifChanges", { name })} · ${summaryText(r.impact, this.lang)}`,
      note: data.truncated && data.nodes.length - 1 < data.total ? this.t("more", { shown: data.nodes.length - 1, total: data.total }) : "",
      "edge.call": "", "edge.control": this.lang === "zh" ? "決定" : "decides",
    };
    void this.panel.webview.postMessage({ type: "graph", payload: { ...data, center: r.impact.center, strings } });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  new Controller(context);
}

export function deactivate(): void { /* everything is disposed through context.subscriptions */ }
