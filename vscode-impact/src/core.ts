// Pure logic of the extension: no `vscode` import, so it can be tested with plain Node.
// The extension (extension.ts) only turns these results into editor decorations, a tree and a webview.

export interface Ref { node: string; line: number; col: number; end: number; role: string }
export interface Step { from: string; to: string; kind: string; lines: number[] }
export interface ImpactNode {
  id: string; name: string; kind: string; scope: string; lines: number[]; flags: string[];
  level: number;
  influence: "source" | "data" | "condition" | "caller";
  category: "source" | "value" | "returns" | "runs" | "effect" | "external" | "caller";
  where: number[]; path: Step[];
}
export interface Edge { source: string; target: string; kind: string; lines: number[] }
export interface Warning { kind: string; scope: string; detail: string; lines: number[] }
export interface Summary {
  total: number; shown: number; values: number; returns: number; runs: number;
  effects: number; external: number; callers: number; by_condition: number;
}
export interface Impact {
  center: string; nodes: ImpactNode[]; edges: Edge[]; summary: Summary; lines: number[];
  source_refs: Ref[]; affected_refs: Ref[]; warnings: Warning[]; truncated: boolean;
}

export type RunOutcome =
  | { ok: true; impact: Impact }
  | { ok: false; kind: "syntax" | "nothing_here" | "python_version" | "crash" | "no_python" | "timeout"; message: string; line?: number };

// ---------------------------------------------------------------- running the analyzer

// Starts the bundled analyzer without installing anything and without trusting the user's
// environment: `-I` ignores PYTHON* variables and the current directory.
const BOOT = [
  "import sys, json",
  "if sys.version_info < (3, 10):",
  "    print(json.dumps({'error': 'python_version', 'detail': sys.version.split()[0]}))",
  "    raise SystemExit(3)",
  "sys.path.insert(0, sys.argv[1])",
  "del sys.argv[1]",
  "from pyflow.cli import main",
  "raise SystemExit(main())",
].join("\n");

export interface CliOptions { line: number; character: number; fileName: string; includeConditions: boolean }

// `line` and `character` are 0-based, as VS Code reports them; the CLI counts from 1.
export function buildSpawn(pythonPath: string, analyzerDir: string, o: CliOptions): { command: string; args: string[] } {
  const cli = ["--stdin", "--json", "--impact", "--at", `${o.line + 1}:${o.character + 1}`];
  if (!o.includeConditions) cli.push("--no-control");
  cli.push(o.fileName);
  return { command: pythonPath, args: ["-I", "-c", BOOT, analyzerDir, ...cli] };
}

export function parseOutput(stdout: string, stderr: string, exitCode: number | null): RunOutcome {
  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch {
    const text = (stderr || stdout).trim();
    return { ok: false, kind: "crash", message: text.split("\n").slice(-3).join("\n") || `exit code ${exitCode}` };
  }
  if (data && data.error === "syntax") {
    return { ok: false, kind: "syntax", message: String(data.detail?.message ?? "syntax error"), line: data.detail?.line };
  }
  if (data && data.error === "nothing_here") return { ok: false, kind: "nothing_here", message: String(data.detail) };
  if (data && data.error === "python_version") return { ok: false, kind: "python_version", message: String(data.detail) };
  if (data && Array.isArray(data.nodes) && typeof data.center === "string") return { ok: true, impact: data as Impact };
  return { ok: false, kind: "crash", message: "unexpected output from the analyzer" };
}

// ---------------------------------------------------------------- editor marks

export interface Mark { line: number; start: number; end: number } // 0-based, as VS Code wants

export interface DecorationPlan {
  source: Mark[]; affected: Mark[]; condition: Mark[]; effect: Mark[];
  lines: number[]; // 0-based lines where the change arrives
}

// Which tokens to colour, and how. A token listed for several nodes keeps its strongest class.
export function decorationPlan(impact: Impact): DecorationPlan {
  const info = new Map(impact.nodes.map((n) => [n.id, n]));
  const rank: Record<string, number> = { source: 4, effect: 3, condition: 2, affected: 1 };
  const best = new Map<string, { cls: keyof DecorationPlan; mark: Mark }>();
  const consider = (r: Ref, cls: "source" | "effect" | "condition" | "affected") => {
    const key = `${r.line}:${r.col}:${r.end}`;
    const mark = { line: r.line - 1, start: r.col, end: r.end };
    const prev = best.get(key);
    if (!prev || rank[cls] > rank[prev.cls as string]) best.set(key, { cls, mark });
  };
  impact.source_refs.forEach((r) => consider(r, "source"));
  for (const r of impact.affected_refs) {
    const n = info.get(r.node);
    consider(r, n?.category === "effect" ? "effect" : n?.influence === "condition" ? "condition" : "affected");
  }
  const plan: DecorationPlan = { source: [], affected: [], condition: [], effect: [], lines: impact.lines.map((l) => l - 1) };
  for (const { cls, mark } of best.values()) (plan[cls] as Mark[]).push(mark);
  return plan;
}

// ---------------------------------------------------------------- wording

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    affected: "{n} affected", none: "Nothing else in this file depends on it.",
    values: "{n} variables", "values.one": "1 variable", returns: "{n} return values", "returns.one": "1 return value",
    effects: "{n} outputs", "effects.one": "1 output", runs: "{n} run differently", "runs.one": "1 runs differently",
    callers: "{n} callers", "callers.one": "1 caller", cond: "{n} only via a condition",
    "grp.value": "Variables and attributes", "grp.returns": "Return values", "grp.effect": "Output and side effects",
    "grp.external": "Passed to library calls", "grp.runs": "Runs differently", "grp.caller": "Callers",
    via: "via {path}", ifChanges: "If {name} changes", youAsked: "This is the name you asked about.",
    condition: "only through a condition", incomplete: "May be incomplete: pyflow cannot follow {what}",
    noName: "Put the cursor on a variable or function name first.",
    notPython: "pyflow works on Python files.",
    syntax: "This file has a syntax error on line {line}: {message}. Fix it, then try again.",
    pyVersion: "pyflow needs Python 3.10 or newer, but {path} is {version}.",
    noPython: "Could not start Python ({path}). Install Python 3.10+ or choose one in the settings.",
    crash: "pyflow could not analyze this file: {message}",
    openSettings: "Open settings", staleHint: "The file changed, so the marks were cleared. Run the command again.",
    running: "pyflow: analyzing...", more: "Showing the nearest {shown} of {total} in the graph.",
    noResult: "Run \"What changes if this changes?\" on a name first.",
    statusTip: "Click to show the impact graph",
  },
  zh: {
    affected: "{n} 處受影響", none: "此檔案中沒有其他東西依賴它。",
    values: "{n} 個變數", "values.one": "1 個變數", returns: "{n} 個回傳值", "returns.one": "1 個回傳值",
    effects: "{n} 個輸出", "effects.one": "1 個輸出", runs: "{n} 個執行方式改變", "runs.one": "1 個執行方式改變",
    callers: "{n} 個呼叫者", "callers.one": "1 個呼叫者", cond: "{n} 個僅經由條件",
    "grp.value": "變數與屬性", "grp.returns": "回傳值", "grp.effect": "輸出與副作用",
    "grp.external": "傳入函式庫呼叫", "grp.runs": "執行方式改變", "grp.caller": "呼叫者",
    via: "經由 {path}", ifChanges: "如果 {name} 改變", youAsked: "這是你詢問的名稱。",
    condition: "僅經由條件", incomplete: "結果可能不完整：pyflow 無法追蹤 {what}",
    noName: "請先把游標放在變數或函式名稱上。",
    notPython: "pyflow 只能用於 Python 檔。",
    syntax: "此檔案第 {line} 行有語法錯誤：{message}。請修正後再試一次。",
    pyVersion: "pyflow 需要 Python 3.10 以上，但 {path} 是 {version}。",
    noPython: "無法啟動 Python（{path}）。請安裝 Python 3.10 以上，或在設定中選擇。",
    crash: "pyflow 無法分析此檔案：{message}",
    openSettings: "開啟設定", staleHint: "檔案已變更，標記已清除。請再執行一次指令。",
    running: "pyflow：分析中...", more: "圖上只畫最近的 {shown} 個（共 {total} 個）。",
    noResult: "請先對某個名稱執行「如果它改變，會影響哪裡？」。",
    statusTip: "點擊顯示影響圖",
  },
};

export function langOf(vscodeLanguage: string): "en" | "zh" {
  return vscodeLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function tr(lang: "en" | "zh", key: string, vars: Record<string, string | number> = {}): string {
  const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function count(lang: "en" | "zh", key: string, n: number): string {
  return tr(lang, n === 1 && (STRINGS[lang][`${key}.one`] || STRINGS.en[`${key}.one`]) ? `${key}.one` : key, { n });
}

export function summaryText(impact: Impact, lang: "en" | "zh" = "en"): string {
  const s = impact.summary;
  if (!s.total) return tr(lang, "none");
  const parts = [count(lang, "values", s.values), count(lang, "returns", s.returns), count(lang, "effects", s.effects),
                 count(lang, "runs", s.runs), count(lang, "callers", s.callers)];
  const counts = [s.values, s.returns, s.effects, s.runs, s.callers];
  const shown = parts.filter((_, i) => counts[i] > 0);
  return `${tr(lang, "affected", { n: s.total })}: ${shown.join(", ")}`;
}

// A readable name for a node: `Cart.add()`, `Cart.items`, `total`.
export function displayName(n: ImpactNode): string {
  if (n.kind === "function" || n.kind === "method") return `${n.id.slice(3)}()`;
  if (n.kind === "class") return n.id.slice(3);
  if (n.kind === "external") return n.name;
  return n.scope && n.scope !== "<module>" ? `${n.scope}.${n.name}` : n.name;
}

export function pathText(impact: Impact, node: ImpactNode): string {
  const byId = new Map(impact.nodes.map((n) => [n.id, n]));
  const label = (id: string) => { const n = byId.get(id); return n ? displayName(n) : id.split(":").pop() ?? id; };
  return [impact.center, ...node.path.map((s) => s.to)].map(label).join(" → ");
}

// ---------------------------------------------------------------- the tree

export interface TreeItem { label: string; description: string; tooltip: string; line: number | null; condition: boolean }
export interface TreeGroup { key: string; label: string; items: TreeItem[] }

const GROUP_ORDER = ["value", "returns", "effect", "external", "runs", "caller"];

export function treeModel(impact: Impact, lang: "en" | "zh" = "en"): TreeGroup[] {
  const groups: TreeGroup[] = [];
  for (const key of GROUP_ORDER) {
    const rows = impact.nodes.slice(1).filter((n) => n.category === key);
    if (!rows.length) continue;
    groups.push({
      key, label: `${tr(lang, `grp.${key}`)} (${rows.length})`,
      items: rows.map((n) => {
        const where = n.where.length ? `L${n.where.slice(0, 3).join(", L")}` : "";
        const cond = n.influence === "condition";
        const path = n.path.length > 1 ? tr(lang, "via", { path: pathText(impact, n) }) : "";
        return {
          label: displayName(n),
          description: [where, cond ? tr(lang, "condition") : ""].filter(Boolean).join(" · "),
          tooltip: [path, cond ? tr(lang, "condition") : ""].filter(Boolean).join("\n"),
          line: (n.where[0] ?? n.lines[0] ?? null),
          condition: cond,
        };
      }),
    });
  }
  return groups;
}

// ---------------------------------------------------------------- hover

// Text for a hover at a position (1-based line, 0-based UTF-16 column), or null if nothing is marked there.
export function explain(impact: Impact, line: number, col: number, lang: "en" | "zh" = "en"): string | null {
  const covers = (r: Ref) => r.line === line && r.col <= col && col <= r.end;
  const byId = new Map(impact.nodes.map((n) => [n.id, n]));
  if (impact.source_refs.some(covers)) {
    return `**${tr(lang, "ifChanges", { name: displayName(byId.get(impact.center)!) })}**\n\n${summaryText(impact, lang)}`;
  }
  const hit = impact.affected_refs.find(covers);
  const node = hit && byId.get(hit.node);
  if (!node) return null;
  const lines = [`**${displayName(node)}**`, pathText(impact, node)];
  if (node.influence === "condition") lines.push(`_${tr(lang, "condition")}_`);
  return lines.join("\n\n");
}

// ---------------------------------------------------------------- graph data for the webview

// Few enough nodes to read: the nearest ones. Big results draw one parent edge per node (a tree).
export function graphPayload(impact: Impact, maxNodes: number): { nodes: ImpactNode[]; edges: Edge[]; truncated: boolean; total: number } {
  const nodes = impact.nodes.slice(0, maxNodes + 1);
  const keep = new Set(nodes.map((n) => n.id));
  let edges = impact.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  if (nodes.length > 40) {
    const parents = new Set(nodes.slice(1).flatMap((n) => {
      const s = n.path[n.path.length - 1];
      return s ? [`${s.from}|${s.to}|${s.kind}`] : [];
    }));
    edges = edges.filter((e) => parents.has(`${e.source}|${e.target}|${e.kind}`));
  }
  return { nodes, edges, truncated: impact.nodes.length - 1 > maxNodes || impact.truncated, total: impact.summary.total };
}
