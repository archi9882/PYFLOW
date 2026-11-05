// A small stand-in for the parts of the VS Code API the extension uses. It records what the
// extension does so tests can check the flow. It cannot show how real VS Code behaves.
type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (l: Listener<T>) => { this.listeners.push(l); return { dispose() { /* nothing */ } }; };
  fire(e: T) { this.listeners.forEach((l) => l(e)); }
}
export class Position { constructor(public line: number, public character: number) {} }
export class Range {
  start: Position; end: Position;
  constructor(a: number, b: number, c: number, d: number) { this.start = new Position(a, b); this.end = new Position(c, d); }
}
export class ThemeColor { constructor(public id: string) {} }
export class ThemeIcon { constructor(public id: string) {} }
export class MarkdownString { constructor(public value: string) {} }
export class Hover { constructor(public contents: MarkdownString) {} }
export class TreeItem {
  description?: string; tooltip?: string; iconPath?: unknown; command?: { command: string; arguments?: unknown[] };
  constructor(public label: string, public collapsibleState: number) {}
}
export class Uri {
  constructor(public value: string) {}
  static parse(v: string) { return new Uri(v); }
  static file(p: string) { return new Uri("file://" + p); }
  static joinPath(base: Uri, ...parts: string[]) { return new Uri([base.value, ...parts].join("/")); }
  toString() { return this.value; }
  get scheme() { return this.value.split(":")[0]; }
  get fsPath() { return this.value.replace("file://", ""); }
}

export interface FakeDoc { uri: Uri; languageId: string; fileName: string; version: number; getText(): string }
export interface FakeEditor {
  document: FakeDoc; selection: { active: Position };
  decorations: Map<string, Range[]>; revealed: Range[];
  setDecorations(type: { key: string }, ranges: Range[]): void;
  revealRange(r: Range): void;
}

export function makeEditor(text: string, line: number, character: number, name = "demo.py"): FakeEditor {
  const doc: FakeDoc = { uri: Uri.file("/work/" + name), languageId: "python", fileName: "/work/" + name, version: 1, getText: () => text };
  const decorations = new Map<string, Range[]>();
  return {
    document: doc, selection: { active: new Position(line, character) }, decorations, revealed: [],
    setDecorations(type, ranges) { decorations.set(type.key, ranges); },
    revealRange(r) { this.revealed.push(r); },
  };
}

export function createFake(language = "en") {
  const handlers = new Map<string, (...a: any[]) => unknown>();
  const log = { contexts: [] as [string, unknown][], messages: [] as [string, string][], statusMessages: [] as string[], panels: [] as any[], posted: [] as any[] };
  const config: Record<string, unknown> = { pythonPath: process.env.PYFLOW_TEST_PYTHON || "python3", includeConditions: true };
  const events = {
    visible: new EventEmitter<void>(), change: new EventEmitter<any>(), close: new EventEmitter<any>(), active: new EventEmitter<any>(), save: new EventEmitter<any>(), selection: new EventEmitter<any>(),
  };
  const state = { active: undefined as FakeEditor | undefined, visible: [] as FakeEditor[], hover: undefined as any, tree: undefined as any, treeViews: [] as any[], status: [] as any[] };
  let decoKey = 0;

  const api = {
    EventEmitter, Position, Range, ThemeColor, ThemeIcon, MarkdownString, Hover, TreeItem, Uri,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 }, OverviewRulerLane: { Right: 4 }, ViewColumn: { Beside: -2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    env: { language },
    extensions: { getExtension: () => undefined },
    commands: {
      registerCommand(name: string, fn: (...a: any[]) => unknown) { handlers.set(name, fn); return { dispose() { /* nothing */ } }; },
      async executeCommand(name: string, ...args: unknown[]) {
        if (name === "setContext") { log.contexts.push([args[0] as string, args[1]]); return; }
        return handlers.get(name)?.(...args);
      },
    },
    languages: {
      registerHoverProvider(_sel: unknown, provider: unknown) { state.hover = provider; return { dispose() { /* nothing */ } }; },
    },
    workspace: {
      getConfiguration: () => ({ get: (k: string, d?: unknown) => (k in config ? config[k] : d) }),
      onDidChangeTextDocument: events.change.event, onDidCloseTextDocument: events.close.event, onDidSaveTextDocument: events.save.event, textDocuments: [] as unknown[],
    },
    window: {
      get activeTextEditor() { return state.active; },
      get visibleTextEditors() { return state.visible; },
      onDidChangeVisibleTextEditors: events.visible.event, onDidChangeActiveTextEditor: events.active.event, onDidChangeTextEditorSelection: events.selection.event,
      createTextEditorDecorationType: (opts: unknown) => ({ key: `deco${decoKey++}`, opts, dispose() { /* nothing */ } }),
      createTreeView(id: string, o: { treeDataProvider: unknown }) {
        const view = { id, provider: o.treeDataProvider, title: "", description: "", dispose() { /* nothing */ } };
        state.tree = o.treeDataProvider; state.treeViews.push(view); return view;
      },
      createStatusBarItem() {
        const item = { text: "", tooltip: undefined as unknown, command: "", visible: false, show() { item.visible = true; }, hide() { item.visible = false; }, dispose() { /* nothing */ } };
        state.status.push(item); return item;
      },
      setStatusBarMessage: (m: string) => { log.statusMessages.push(m); },
      showInformationMessage: async (m: string) => { log.messages.push(["info", m]); },
      showWarningMessage: async (m: string) => { log.messages.push(["warn", m]); },
      showErrorMessage: async (m: string) => { log.messages.push(["error", m]); return undefined; },
      async showTextDocument(uri: Uri, o: { selection: Range }) {
        const editor = state.visible.find((e) => e.document.uri.toString() === uri.toString()) ?? state.active!;
        editor.revealRange(o.selection); return editor;
      },
      createWebviewPanel(id: string, title: string) {
        let onMessage: ((m: any) => void) | undefined;
        let onDispose: (() => void) | undefined;
        const panel = {
          id, title, disposed: false, revealed: 0,
          webview: {
            html: "", cspSource: "vscode-resource:",
            asWebviewUri: (u: Uri) => new Uri("webview:" + u.value),
            postMessage: async (m: unknown) => { log.posted.push(m); return true; },
            onDidReceiveMessage: (cb: (m: any) => void) => { onMessage = cb; },
          },
          reveal() { panel.revealed++; },
          onDidDispose(cb: () => void) { onDispose = cb; },
          dispose() { panel.disposed = true; onDispose?.(); },
          send: (m: unknown) => onMessage?.(m),
        };
        log.panels.push(panel); return panel;
      },
    },
  };
  return { api, handlers, log, config, events, state };
}
