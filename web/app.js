// pyflow web front end.
// Loads the Python analyzer into Pyodide, then wires up drag-and-drop,
// the search box, the Cytoscape graph and the source panel.
// All analysis runs in the browser; nothing is uploaded.
"use strict";

const PYODIDE_INDEX = new URL("vendor/pyodide/", location.href).href;
const PY_FILES = ["__init__.py", "analyzer.py", "graph.py", "api.py", "cli.py"];
const MAX_BYTES = 2_000_000;   // larger files work but the graph becomes unreadable
const MIN_ZOOM = 0.6;          // never fit so far out that labels are unreadable
const BIG_GRAPH = 120;         // nodes; above this, suggest narrowing the view
const LABEL_EDGES = 24;        // show edge labels only when the view is this small
const FOLD_OVERVIEW = 60;      // overview nodes; above this, methods fold into their class
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- i18n

const STRINGS = {
  en: {
    "tagline": "See where values come from and where they go",
    "drop.title": "Drop a .py file here",
    "drop.hint": "or click to choose. The file never leaves your browser.",
    "drop.overlay": "Drop to analyze",
    "example.label": "Example",
    "example.pick": "Load an example...",
    "search.label": "Variable or function",
    "search.placeholder": "e.g. total, load, Cart.add",
    "search.overview": "Show whole-file call graph",
    "search.none": "No matching name",
    "search.line": "Names on line {line}",
    "ctl.depth": "Depth",
    "ctl.direction": "Direction",
    "ctl.show": "Show",
    "dir.both": "Both",
    "dir.upstream": "Upstream only",
    "dir.downstream": "Downstream only",
    "fam.call": "Calls",
    "fam.data": "Data flow",
    "fam.ext": "External calls",
    "legend.title": "Legend",
    "legend.up": "Upstream: where it comes from",
    "legend.center": "Selected",
    "legend.down": "Downstream: where it goes",
    "legend.fn": "Function / method / class",
    "legend.var": "Variable / parameter",
    "legend.attr": "Attribute (self.x, dataclass field)",
    "legend.ext": "External call (library, builtin)",
    "legend.grp": "Class box: its methods and attributes",
    "legend.flag": "Has constructs pyflow cannot follow",
    "legend.call": "Call",
    "legend.data": "Data flow",
    "graph.hint": "Hover a node to trace its path. Click to re-center. Click a source line to jump to it.",
    "notice.big": "{n} nodes. Lower the depth or hide external calls for a clearer view.",
    "notice.folded": "Large file: methods are folded into their class. Click a class to see its methods.",
    "label.methods": "{n} methods",
    "label.method": "1 method",
    "details.title": "Details",
    "details.none": "Select a node.",
    "unsup.title": "Not analyzed",
    "unsup.hint": "pyflow reads code without running it. These spots may hide extra flow:",
    "unsup.empty": "Nothing to report.",
    "code.title": "Source",
    "empty.loading": "Loading the Python runtime...",
    "empty.ready": "Drop a .py file or pick an example to start.",
    "empty.nodes": "Nothing connected to this node with the current filters.",
    "empty.nofunc": "No functions in this file. Search for a variable instead.",
    "status.loading": "Loading Python...",
    "status.ready": "Ready",
    "status.failed": "Could not start the Python runtime. Reload the page to try again.",
    "status.analyzing": "Analyzing...",
    "file.info": "{name}: {lines} lines, {functions} functions/classes, {variables} variables",
    "file.syntax": "Syntax error on line {line}: {message}",
    "file.notpy": "Please drop a Python (.py) file.",
    "file.big": "File is larger than 2 MB; skipped.",
    "d.name": "Name", "d.kind": "Kind", "d.scope": "Scope", "d.lines": "Lines",
    "d.in": "Comes from", "d.out": "Goes to", "d.flags": "Warnings",
    "kind.module": "module", "kind.function": "function", "kind.method": "method", "kind.class": "class",
    "kind.parameter": "parameter", "kind.variable": "variable", "kind.attribute": "attribute", "kind.external": "external",
    "edge.call": "calls", "edge.assign": "", "edge.arg": "arg", "edge.return": "return", "edge.result": "result",
    "u.attribute": "Object attribute", "u.star_args": "*args / **kwargs", "u.decorator": "Decorator",
    "u.dynamic": "Dynamic call", "u.global": "global rebinding", "u.nonlocal": "nonlocal rebinding",
    "u.match": "match/case", "u.star_import": "import *",
  },
  "zh-TW": {
    "tagline": "一眼看出值從哪裡來、往哪裡去",
    "drop.title": "把 .py 檔拖曳到這裡",
    "drop.hint": "或點擊選擇檔案。檔案只在瀏覽器內處理，不會上傳。",
    "drop.overlay": "放開以分析",
    "example.label": "範例",
    "example.pick": "載入範例...",
    "search.label": "變數或函式",
    "search.placeholder": "例如 total、load、Cart.add",
    "search.overview": "顯示整個檔案的呼叫圖",
    "search.none": "沒有符合的名稱",
    "search.line": "第 {line} 行的名稱",
    "ctl.depth": "深度",
    "ctl.direction": "方向",
    "ctl.show": "顯示",
    "dir.both": "上下游",
    "dir.upstream": "只看上游",
    "dir.downstream": "只看下游",
    "fam.call": "呼叫",
    "fam.data": "資料流",
    "fam.ext": "外部呼叫",
    "legend.title": "圖例",
    "legend.up": "上游：值從哪裡來",
    "legend.center": "目前選取",
    "legend.down": "下游：值往哪裡去",
    "legend.fn": "函式／方法／類別",
    "legend.var": "變數／參數",
    "legend.attr": "屬性（self.x、dataclass 欄位）",
    "legend.ext": "外部呼叫（函式庫、內建函式）",
    "legend.grp": "類別框：其方法與屬性",
    "legend.flag": "含 pyflow 無法追蹤的寫法",
    "legend.call": "呼叫",
    "legend.data": "資料流",
    "graph.hint": "滑過節點可追蹤路徑；點擊改以它為中心；點原始碼某行可跳到對應節點。",
    "notice.big": "共 {n} 個節點。降低深度或隱藏外部呼叫，圖會更清楚。",
    "notice.folded": "檔案較大：方法已收合進所屬類別。點擊類別可查看其方法。",
    "label.methods": "{n} 個方法",
    "label.method": "1 個方法",
    "details.title": "詳細資訊",
    "details.none": "請選取節點。",
    "unsup.title": "未分析",
    "unsup.hint": "pyflow 只讀程式碼、不執行。以下位置可能藏有圖上沒畫出的傳遞：",
    "unsup.empty": "沒有需要注意的地方。",
    "code.title": "原始碼",
    "empty.loading": "正在載入 Python 執行環境...",
    "empty.ready": "拖曳 .py 檔或選擇範例開始。",
    "empty.nodes": "目前的篩選條件下，沒有與此節點相連的項目。",
    "empty.nofunc": "此檔案沒有函式，請直接搜尋變數。",
    "status.loading": "載入 Python 中...",
    "status.ready": "就緒",
    "status.failed": "無法啟動 Python 執行環境，請重新整理頁面再試一次。",
    "status.analyzing": "分析中...",
    "file.info": "{name}：{lines} 行，{functions} 個函式／類別，{variables} 個變數",
    "file.syntax": "第 {line} 行語法錯誤：{message}",
    "file.notpy": "請拖曳 Python（.py）檔。",
    "file.big": "檔案超過 2 MB，已略過。",
    "d.name": "名稱", "d.kind": "種類", "d.scope": "作用域", "d.lines": "行號",
    "d.in": "來自", "d.out": "流向", "d.flags": "警告",
    "kind.module": "模組", "kind.function": "函式", "kind.method": "方法", "kind.class": "類別",
    "kind.parameter": "參數", "kind.variable": "變數", "kind.attribute": "屬性", "kind.external": "外部",
    "edge.call": "呼叫", "edge.assign": "", "edge.arg": "引數", "edge.return": "回傳", "edge.result": "結果",
    "u.attribute": "物件屬性", "u.star_args": "*args / **kwargs", "u.decorator": "裝飾器",
    "u.dynamic": "動態呼叫", "u.global": "global 重新綁定", "u.nonlocal": "nonlocal 重新綁定",
    "u.match": "match/case", "u.star_import": "import *",
  },
};

function pickLanguage() {
  try {
    const saved = localStorage.getItem("pyflow.lang");
    if (saved && STRINGS[saved]) return saved;
  } catch (_) { /* storage may be blocked; fall back to the browser language */ }
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

let lang = pickLanguage();

// Translate a key and fill {placeholders}.
function t(key, vars = {}) {
  const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  $("#lang-toggle").textContent = lang === "en" ? "中文" : "English";
}

// ---------------------------------------------------------------- state

const $ = (sel) => document.querySelector(sel);

const state = {
  api: null,           // pyflow.api module inside Pyodide
  graph: null,         // full analysis result for the current file
  nodesById: new Map(),
  linesWithNodes: new Set(),
  sourceLines: [],
  center: null,        // node in the middle of the view (null = whole-file overview)
  selected: null,      // node shown in the details panel
  candidates: [],
  active: -1,          // keyboard-highlighted candidate
  pendingFile: null,   // file dropped before Python finished loading
  view: null,          // last subgraph drawn
};

let cy = null;
let laidOutDirection = null; // flow direction of the last layout, to re-layout when it changes

function setStatus(key) { $("#status").textContent = t(key); }

function showEmpty(key) {
  const box = $("#graph-empty");
  if (key) {
    const p = box.querySelector("p");
    p.textContent = t(key);
    p.dataset.i18n = key;
  }
  box.hidden = !key;
}

// ---------------------------------------------------------------- Python

async function startPython() {
  setStatus("status.loading");
  try {
    const fontsReady = document.fonts ? document.fonts.load('600 12px "IBM Plex Mono"').catch(() => {}) : null;
    const py = await loadPyodide({ indexURL: PYODIDE_INDEX });
    // Copy the analyzer package into Pyodide's virtual file system.
    py.FS.mkdirTree("/home/pyodide/pyflow");
    for (const name of PY_FILES) {
      const res = await fetch(`py/pyflow/${name}`);
      if (!res.ok) throw new Error(`failed to fetch ${name}`);
      py.FS.writeFile(`/home/pyodide/pyflow/${name}`, await res.text());
    }
    py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
    state.api = py.pyimport("pyflow.api");
    await fontsReady; // the graph is drawn on canvas, so the font must be ready first
    setStatus("status.ready");
    showEmpty("empty.ready");
    if (state.pendingFile) {
      const { name, text } = state.pendingFile;
      state.pendingFile = null;
      loadSource(text, name);
    } else {
      await loadDefaultExample();
    }
  } catch (err) {
    console.error(err);
    setStatus("status.failed");
    showEmpty("status.failed");
  }
}

// ---------------------------------------------------------------- loading files

function loadSource(text, name) {
  if (!state.api) { // Python still loading: remember and run later
    state.pendingFile = { text, name };
    return;
  }
  setStatus("status.analyzing");
  state.graph = JSON.parse(state.api.load(text, name));
  state.nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
  state.sourceLines = text.split("\n");
  state.linesWithNodes = new Set([
    ...state.graph.nodes.flatMap((n) => n.kind === "external" ? [] : n.lines),
    ...state.graph.edges.flatMap((e) => e.lines),
  ]);
  state.center = null;
  state.selected = null;
  setStatus("status.ready");

  renderCode(text);
  renderUnsupported();
  renderDetails(null);
  $("#search").value = "";
  closeCandidates();

  const info = $("#file-info");
  if (state.graph.error) {
    info.textContent = t("file.syntax", state.graph.error);
    info.classList.add("error");
    drawGraph({ nodes: [], edges: [], center: null });
    highlightLines([state.graph.error.line]);
    return;
  }
  info.classList.remove("error");
  info.textContent = t("file.info", { name, ...state.graph.stats });
  showOverview();
}

function readFile(file) {
  if (!file) return;
  if (!/\.pyw?$/i.test(file.name)) { $("#file-info").textContent = t("file.notpy"); return; }
  if (file.size > MAX_BYTES) { $("#file-info").textContent = t("file.big"); return; }
  file.text().then((text) => {
    $("#example-select").value = "";
    loadSource(text, file.name);
  });
}

async function loadExampleList() {
  const select = $("#example-select");
  try {
    const list = await (await fetch("examples/index.json")).json();
    select.innerHTML = "";
    const placeholder = new Option(t("example.pick"), "");
    placeholder.dataset.i18n = "example.pick";
    select.add(placeholder);
    list.forEach((name) => select.add(new Option(name, name)));
  } catch (_) {
    select.closest(".row").hidden = true; // examples are optional
  }
}

async function loadExample(name) {
  if (!name) return;
  const text = await (await fetch(`examples/${name}`)).text();
  $("#example-select").value = name;
  loadSource(text, name);
}

async function loadDefaultExample() {
  const options = [...$("#example-select").options];
  const preferred = options.find((o) => o.value === "class_based.py") || options.find((o) => o.value);
  if (preferred) await loadExample(preferred.value);
}

// ---------------------------------------------------------------- search

function updateCandidates() {
  if (!state.api || !state.graph) return;
  const query = $("#search").value;
  state.candidates = query.trim() ? JSON.parse(state.api.find(query, 30)) : [];
  state.active = state.candidates.length ? 0 : -1;
  renderCandidates(query.trim() !== "");
}

function renderCandidates(show, caption) {
  const list = $("#candidates");
  list.innerHTML = "";
  if (!show) { closeCandidates(); return; }
  if (caption) {
    const li = document.createElement("li");
    li.className = "caption";
    li.textContent = caption;
    list.append(li);
  }
  if (!state.candidates.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("search.none");
    list.append(li);
  }
  state.candidates.forEach((c, i) => {
    const li = document.createElement("li");
    li.id = `cand-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === state.active));
    const name = document.createElement("span");
    name.className = "cand-name";
    name.textContent = c.name;
    const meta = document.createElement("span");
    meta.className = "cand-meta";
    // Scope is shown so same-named variables in different functions are distinguishable.
    meta.textContent = [t(`kind.${c.kind}`), scopeLabel(c.scope)].filter(Boolean).join(" · ");
    li.append(name, meta);
    li.addEventListener("mousedown", (ev) => { ev.preventDefault(); chooseCandidate(i); });
    list.append(li);
  });
  list.hidden = false;
  $("#search").setAttribute("aria-expanded", "true");
  if (state.active >= 0) $("#search").setAttribute("aria-activedescendant", `cand-${state.active}`);
}

function closeCandidates() {
  $("#candidates").hidden = true;
  $("#search").setAttribute("aria-expanded", "false");
  $("#search").removeAttribute("aria-activedescendant");
}

function moveActive(delta) {
  if (!state.candidates.length) return;
  state.active = (state.active + delta + state.candidates.length) % state.candidates.length;
  const caption = $("#candidates .caption")?.textContent;
  renderCandidates(true, caption);
  document.getElementById(`cand-${state.active}`)?.scrollIntoView({ block: "nearest" });
}

function chooseCandidate(i) {
  const c = state.candidates[i];
  if (!c) return;
  $("#search").value = qualified(c);
  closeCandidates();
  focusNode(c.id);
}

function scopeLabel(scope) { return scope === "<module>" ? "module" : scope; }

// Qualify nested names (main.data) but keep top-level ones short.
function qualified(n) { return n.scope && n.scope !== "<module>" ? `${n.scope}.${n.name}` : n.name; }

// ---------------------------------------------------------------- views

function families() {
  const fams = [];
  if ($("#fam-call").checked) fams.push("call");
  if ($("#fam-data").checked) fams.push("data");
  return fams.join(",");
}

function focusNode(id) {
  state.center = id;
  refresh();
  selectNode(id);
}

function showOverview() {
  state.center = null;
  refresh();
}

// Redraw the current view with the current controls.
function refresh() {
  if (!state.api || !state.graph || state.graph.error) return;
  let sub = state.center
    ? JSON.parse(state.api.neighborhood(state.center, Number($("#depth").value), $("#direction").value, families()))
    : JSON.parse(state.api.whole_file());
  if (!state.center && sub.nodes.length > FOLD_OVERVIEW) sub = foldMethods(sub);
  drawGraph(sub);
  markViewLines(sub);
}

// Overview of a large file: replace each class's methods by the class itself,
// re-pointing their call edges, so the file's structure fits on screen.
function foldMethods(sub) {
  const owner = new Map();
  const counts = new Map();
  for (const n of sub.nodes) {
    const cls = `fn:${n.scope}`;
    if (n.kind === "method" && state.nodesById.get(cls)?.kind === "class") {
      owner.set(n.id, cls);
      counts.set(cls, (counts.get(cls) || 0) + 1);
    }
  }
  const edges = new Map();
  for (const e of sub.edges) {
    const source = owner.get(e.source) || e.source;
    const target = owner.get(e.target) || e.target;
    if (source !== target) edges.set(`${source}|${target}`, { ...e, source, target });
  }
  return {
    ...sub,
    folded: true,
    nodes: sub.nodes.filter((n) => !owner.has(n.id)).map((n) => (counts.has(n.id) ? { ...n, folded: counts.get(n.id) } : n)),
    edges: [...edges.values()],
  };
}

// Hide external-call nodes when that filter is off (the center always stays).
function applyFilters(sub) {
  if ($("#fam-ext").checked) return sub;
  const drop = new Set(sub.nodes.filter((n) => n.kind === "external" && n.id !== sub.center).map((n) => n.id));
  return {
    ...sub,
    nodes: sub.nodes.filter((n) => !drop.has(n.id)),
    edges: sub.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  };
}

// ---------------------------------------------------------------- graph drawing

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function graphStyle() {
  const c = {
    text: cssVar("--text"), muted: cssVar("--muted"), up: cssVar("--up"), down: cssVar("--down"),
    center: cssVar("--center"), fn: cssVar("--node-fn"), v: cssVar("--node-var"), attr: cssVar("--node-attr"),
    ext: cssVar("--node-ext"), group: cssVar("--group"), border: cssVar("--border"),
    call: cssVar("--edge-call"), data: cssVar("--edge-data"), flag: cssVar("--flag"), bg: cssVar("--surface"),
  };
  const mono = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  return [
    { selector: "node", style: {
      "label": "data(label)", "text-wrap": "wrap", "text-valign": "center", "text-halign": "center",
      "font-size": 12, "font-family": mono, "color": c.text, "line-height": 1.3,
      "width": "label", "height": "label", "padding": "9px", "shape": "round-rectangle",
      "background-color": c.v, "border-width": 1.5, "border-color": c.muted,
      "transition-property": "opacity, border-color, border-width", "transition-duration": "150ms",
    } },
    { selector: "node[kind = 'function'], node[kind = 'method'], node[kind = 'class'], node[kind = 'module']",
      style: { "background-color": c.fn, "font-weight": 600 } },
    { selector: "node[kind = 'class']", style: { "shape": "cut-rectangle" } },
    { selector: "node[kind = 'variable'], node[kind = 'parameter']", style: { "shape": "ellipse", "padding": "11px" } },
    { selector: "node[kind = 'attribute']", style: { "background-color": c.attr, "shape": "round-rectangle" } },
    { selector: "node[kind = 'external']", style: { "background-color": c.ext, "border-style": "dashed", "color": c.muted } },
    { selector: "node[kind = 'group']", style: {
      "background-color": c.group, "background-opacity": 0.9, "border-style": "dashed", "border-color": c.border,
      "border-width": 1.5, "shape": "round-rectangle", "padding": "14px",
      "text-valign": "top", "text-halign": "center", "text-margin-y": -4, "font-weight": 600, "color": c.muted,
    } },
    { selector: "node[side = 'up']", style: { "border-color": c.up, "border-width": 2.5 } },
    { selector: "node[side = 'down']", style: { "border-color": c.down, "border-width": 2.5 } },
    { selector: "node[?flagged]", style: { "border-color": c.flag, "border-style": "dashed", "border-width": 2.5 } },
    { selector: "node[?isCenter]", style: { "border-color": c.center, "border-width": 4, "border-style": "solid" } },
    { selector: "node:selected", style: { "overlay-color": c.center, "overlay-opacity": 0.12, "overlay-padding": 5 } },
    { selector: "edge", style: {
      "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.9, "width": 1.5,
      "line-color": c.data, "target-arrow-color": c.data, "line-style": "dashed", "line-dash-pattern": [6, 4],
      "label": "", "font-size": 10, "font-family": mono, "color": c.muted,
      "text-background-color": c.bg, "text-background-opacity": 1, "text-background-padding": "2px",
      "transition-property": "opacity, width", "transition-duration": "150ms",
    } },
    { selector: "edge[kind = 'call']", style: {
      "line-color": c.call, "target-arrow-color": c.call, "line-style": "solid", "width": 2,
    } },
    { selector: "edge.show-label, edge.path", style: { "label": "data(label)" } },
    { selector: ".faded", style: { "opacity": 0.18 } },
    { selector: "edge.path", style: { "width": 3.5, "z-index": 10 } },
    { selector: "node.path", style: { "border-width": 3.5 } },
  ];
}

function nodeLabel(n, grouped) {
  if (n.folded) return `${n.name}\n${n.folded === 1 ? t("label.method") : t("label.methods", { n: n.folded })}`;
  switch (n.kind) {
    case "function": return `${n.name}()`;
    case "method": return grouped ? `${n.name}()` : `${n.scope}.${n.name}()`;
    case "attribute": return grouped ? `.${n.name}` : `${n.scope}.${n.name}`;
    case "variable":
    case "parameter": return `${n.name}\n${scopeLabel(n.scope)}`;
    default: return n.name;
  }
}

// Class box for a node: methods, attributes and the class itself go inside it.
function groupOf(n) {
  if (n.kind === "class") return n.id.slice(3);
  if ((n.kind === "method" || n.kind === "attribute") && state.nodesById.get(`fn:${n.scope}`)?.kind === "class") return n.scope;
  return null;
}

function buildElements(sub) {
  // Only draw a class box when at least two of its members are visible.
  const members = new Map();
  sub.nodes.forEach((n) => {
    const g = groupOf(n);
    if (g) members.set(g, (members.get(g) || 0) + 1);
  });
  const groups = [...members].filter(([, count]) => count >= 2).map(([g]) => g);
  const groupSet = new Set(groups);
  return [
    ...groups.map((g) => ({ data: { id: `grp:${g}`, label: g, kind: "group" } })),
    ...sub.nodes.map((n) => {
      const g = groupOf(n);
      const parent = g && groupSet.has(g) ? `grp:${g}` : undefined;
      return { data: {
        id: n.id, parent, label: nodeLabel(n, Boolean(parent)), fullLabel: nodeLabel(n, false),
        kind: n.kind, level: n.level,
        side: n.level < 0 ? "up" : n.level > 0 ? "down" : "mid",
        isCenter: n.id === sub.center, flagged: n.flags.length > 0,
      } };
    }),
    ...sub.edges.map((e) => ({ data: {
      id: `${e.source}|${e.target}|${e.kind}`, source: e.source, target: e.target,
      kind: e.kind, label: t(`edge.${e.kind}`), lines: e.lines,
    } })),
  ];
}

function initGraph() {
  cy = cytoscape({
    container: $("#graph"), style: graphStyle(),
    minZoom: 0.08, maxZoom: 3, boxSelectionEnabled: false, autoungrabify: false,
  });
  cy.on("tap", "node", (ev) => {
    const n = ev.target;
    if (n.data("kind") === "group") return;
    hideTooltip();
    if (n.id() === state.center) selectNode(n.id());
    else {
      $("#search").value = qualified(state.nodesById.get(n.id()) || { name: n.id() });
      focusNode(n.id());
    }
  });
  cy.on("tap", "edge", (ev) => {
    const lines = ev.target.data("lines") || [];
    highlightLines(lines);
  });
  cy.on("mouseover", "node", (ev) => {
    if (ev.target.data("kind") === "group") return;
    showTooltip(ev.target);
    tracePath(ev.target);
  });
  cy.on("mouseout", "node", () => { hideTooltip(); clearTrace(); });
  cy.on("pan zoom", hideTooltip);
}

function drawGraph(rawSub) {
  const sub = applyFilters(rawSub);
  state.view = rawSub;
  if (!cy) initGraph();
  hideTooltip();

  // Keep nodes that stay in view where they are, and start new ones at the
  // new center's old position, so re-centering animates instead of jumping.
  const previous = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
  const origin = previous.get(sub.center);
  cy.batch(() => {
    cy.elements().remove();
    cy.add(buildElements(sub));
    cy.nodes().forEach((n) => {
      const p = previous.get(n.id()) || origin;
      if (p && !n.isParent()) n.position(p);
    });
    cy.edges().toggleClass("show-label", sub.edges.length <= LABEL_EDGES);
  });

  const count = sub.nodes.length;
  $("#graph-notice").hidden = !sub.folded && count <= BIG_GRAPH;
  $("#graph-notice").textContent = sub.folded ? t("notice.folded") : t("notice.big", { n: count });

  if (!count) {
    showEmpty(state.graph && !state.graph.error && !state.center ? "empty.nofunc" : null);
    return;
  }
  showEmpty(count === 1 && state.center ? "empty.nodes" : null);

  // Layered left-to-right layout: upstream on the left, downstream on the right.
  // The overview has many unconnected parts, so it is packed instead of animated.
  const overview = !sub.center;
  const animate = !overview && !REDUCED_MOTION && previous.size > 0 && count <= BIG_GRAPH;
  const layout = cy.layout({
    name: "dagre", rankDir: (laidOutDirection = flowDirection()), nodeSep: 22, rankSep: 64, edgeSep: 10,
    fit: false, padding: 36,
    // Feeding class members together helps dagre keep each class box contiguous.
    sort: (a, b) => (a.data("parent") || a.id()).localeCompare(b.data("parent") || b.id()),
    animate, animationDuration: 320,
  });
  layout.one("layoutstop", () => {
    dissolveCrowdedGroups();
    if (overview) packComponents();
    fitView(sub.center, animate);
  });
  layout.run();
  if (sub.center) cy.getElementById(sub.center).select();
}

// Left to right on wide screens (as agreed); top to bottom on narrow ones,
// where a horizontal flow would not fit.
function flowDirection() { return cy.width() < 600 ? "TB" : "LR"; }

// A class box is only drawn if no outside node landed inside it; otherwise the
// box would claim a node that is not part of the class. Dissolved boxes fall
// back to qualified labels such as Cart.add().
function dissolveCrowdedGroups() {
  const leaves = cy.nodes().filter((n) => !n.isParent());
  cy.nodes("[kind = 'group']").forEach((group) => {
    const box = group.boundingBox();
    const members = group.children();
    const intruder = leaves.some((n) => {
      if (members.contains(n)) return false;
      const b = n.boundingBox();
      return b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1;
    });
    if (intruder) {
      members.forEach((m) => m.data("label", m.data("fullLabel")));
      members.move({ parent: null });
      group.remove();
    }
  });
}

// Fit the graph, but never so far out that labels become unreadable:
// then zoom to the floor and show the center (or the top-left of the overview).
function fitView(centerId, animated) {
  const apply = () => {
    cy.fit(undefined, 36);
    if (cy.zoom() >= MIN_ZOOM) return;
    cy.zoom(MIN_ZOOM);
    if (centerId) {
      cy.center(cy.getElementById(centerId));
    } else {
      const bb = cy.elements().boundingBox();
      cy.pan({ x: 36 - bb.x1 * MIN_ZOOM, y: 56 - bb.y1 * MIN_ZOOM });
    }
  };
  if (!animated) return apply();
  // Animate to the fitted viewport when re-centering.
  const before = { zoom: cy.zoom(), pan: { ...cy.pan() } };
  apply();
  const after = { zoom: cy.zoom(), pan: { ...cy.pan() } };
  cy.viewport(before);
  cy.animate({ zoom: after.zoom, pan: after.pan }, { duration: 260, easing: "ease-in-out-cubic" });
}

// Arrange unconnected parts of the graph in rows (largest first) that roughly
// match the screen's shape, instead of dagre's single tall column.
function packComponents() {
  const parts = cy.elements().components()
    .map((c) => ({ c, bb: c.boundingBox() }))
    .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h);
  if (parts.length < 2) return;
  const gap = 36;
  const area = parts.reduce((sum, p) => sum + (p.bb.w + gap) * (p.bb.h + gap), 0);
  const rowWidth = Math.max(parts[0].bb.w, Math.sqrt(area * (cy.width() / Math.max(cy.height(), 1))));
  let x = 0, y = 0, rowHeight = 0;
  for (const { c, bb } of parts) {
    if (x > 0 && x + bb.w > rowWidth) { x = 0; y += rowHeight + gap; rowHeight = 0; }
    // Move only leaf nodes; class boxes follow their children.
    c.nodes().filter((n) => !n.isParent()).shift({ x: x - bb.x1, y: y - bb.y1 });
    x += bb.w + gap;
    rowHeight = Math.max(rowHeight, bb.h);
  }
}

// Highlight the path between the hovered node and the center.
function tracePath(node) {
  let path = null;
  if (state.center && node.id() !== state.center) {
    const center = cy.getElementById(state.center);
    const upstream = (node.data("level") ?? 0) < 0;
    const result = cy.elements().dijkstra({ root: upstream ? node : center, directed: true });
    path = result.pathTo(upstream ? center : node);
  } else {
    path = node.closedNeighborhood(); // overview or center itself: show direct links
  }
  if (!path || path.length <= 1) path = node.closedNeighborhood();
  cy.batch(() => {
    cy.elements().addClass("faded");
    path.removeClass("faded").addClass("path");
    path.nodes().ancestors().removeClass("faded");
  });
}

function clearTrace() {
  cy.batch(() => cy.elements().removeClass("faded path"));
}

function showTooltip(node) {
  const n = state.nodesById.get(node.id());
  if (!n) return;
  const tip = $("#tooltip");
  tip.innerHTML = "";
  const name = document.createElement("div");
  name.className = "tip-name";
  name.textContent = n.kind === "attribute" ? `${n.scope}.${n.name}` : n.name;
  const meta = document.createElement("div");
  meta.className = "tip-meta";
  meta.textContent = [t(`kind.${n.kind}`), n.scope ? scopeLabel(n.scope) : ""].filter(Boolean).join(" · ");
  tip.append(name, meta);
  const line = n.lines[0];
  if (line && state.sourceLines[line - 1] !== undefined) {
    const code = document.createElement("div");
    code.className = "tip-code";
    code.textContent = `${line}: ${state.sourceLines[line - 1].trim()}`;
    tip.append(code);
  }
  tip.hidden = false;
  // Place under the node (above it near the bottom edge), so the traced path stays visible.
  const box = node.renderedBoundingBox();
  const area = $(".graph-area").getBoundingClientRect();
  const x = Math.min(Math.max(8, (box.x1 + box.x2) / 2 - tip.offsetWidth / 2), area.width - tip.offsetWidth - 8);
  let y = box.y2 + 10;
  if (y + tip.offsetHeight > area.height - 8) y = Math.max(8, box.y1 - tip.offsetHeight - 10);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTooltip() { $("#tooltip").hidden = true; }

// ---------------------------------------------------------------- side panels

function selectNode(id) {
  state.selected = id;
  renderDetails(state.nodesById.get(id) || null);
}

function renderDetails(node) {
  const box = $("#details");
  box.innerHTML = "";
  if (!node) {
    box.textContent = t("details.none");
    box.classList.add("muted");
    highlightLines([]);
    return;
  }
  box.classList.remove("muted");
  const edges = state.graph.edges;
  const label = (id) => {
    const n = state.nodesById.get(id);
    return n ? (n.kind === "attribute" ? `${n.scope}.${n.name}` : n.name) : id;
  };
  const names = (ids) => [...new Set(ids)].map(label).join(", ") || "-";
  const rows = [
    ["d.name", node.name],
    ["d.kind", t(`kind.${node.kind}`)],
    ["d.scope", node.scope ? scopeLabel(node.scope) : "-"],
    ["d.in", names(edges.filter((e) => e.target === node.id).map((e) => e.source))],
    ["d.out", names(edges.filter((e) => e.source === node.id).map((e) => e.target))],
  ];
  if (node.flags.length) rows.push(["d.flags", node.flags.map((f) => t(`u.${f}`)).join(", ")]);
  const dl = document.createElement("dl");
  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = t(key);
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  // Line numbers: where the name is defined or assigned. Clicking scrolls the source.
  const lines = node.lines.length ? node.lines
    : [...new Set(edges.filter((e) => e.source === node.id || e.target === node.id).flatMap((e) => e.lines))].sort((a, b) => a - b);
  const dt = document.createElement("dt");
  dt.textContent = t("d.lines");
  const dd = document.createElement("dd");
  lines.forEach((ln) => {
    const a = document.createElement("span");
    a.className = "line-link";
    a.textContent = ln;
    a.addEventListener("click", () => highlightLines(lines, ln));
    dd.append(a);
  });
  if (!lines.length) dd.textContent = "-";
  dl.append(dt, dd);
  box.append(dl);
  highlightLines(lines);
}

function renderUnsupported() {
  const list = $("#unsupported");
  list.innerHTML = "";
  const items = state.graph.unsupported || [];
  $("#unsup-count").textContent = items.length;
  $("#unsup-count").classList.toggle("warn", items.length > 0);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = t("unsup.empty");
    list.append(li);
    return;
  }
  items.forEach((u) => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = u.detail;
    li.append(`${t(`u.${u.kind}`)}: `, code, ` · ${scopeLabel(u.scope)} · L${u.lines.join(", L")}`);
    li.addEventListener("click", () => highlightLines(u.lines));
    list.append(li);
  });
}

// Source panel with syntax colours from Python's own tokenizer.
function renderCode(text) {
  const ol = $("#code");
  ol.innerHTML = "";
  const spansByLine = new Map();
  try {
    for (const [line, start, end, cls] of JSON.parse(state.api.highlight(text))) {
      if (!spansByLine.has(line)) spansByLine.set(line, []);
      spansByLine.get(line).push([start, end, cls]);
    }
  } catch (_) { /* uncoloured source is still useful */ }

  const frag = document.createDocumentFragment();
  state.sourceLines.forEach((line, i) => {
    const ln = i + 1;
    const li = document.createElement("li");
    let pos = 0;
    for (const [start, end, cls] of (spansByLine.get(ln) || []).sort((a, b) => a[0] - b[0])) {
      if (start < pos) continue;
      if (start > pos) li.append(line.slice(pos, start));
      const span = document.createElement("span");
      span.className = `t-${cls}`;
      span.textContent = line.slice(start, end);
      li.append(span);
      pos = end;
    }
    li.append(line.slice(pos) || (pos === 0 ? " " : ""));
    if (state.linesWithNodes.has(ln)) {
      li.classList.add("linkable");
      li.dataset.line = ln;
    }
    frag.append(li);
  });
  ol.append(frag);
}

// Outline the source lines involved in the current view.
function markViewLines(sub) {
  const lines = new Set(sub.edges.flatMap((e) => e.lines));
  const items = $("#code").children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle("in-view", lines.has(i + 1));
}

// Highlight source lines and scroll the first (or a chosen) one into view.
function highlightLines(lines, scrollTo) {
  const items = $("#code").children;
  for (const li of $("#code").querySelectorAll(".hl")) li.classList.remove("hl");
  lines.forEach((ln) => items[ln - 1]?.classList.add("hl"));
  const target = items[(scrollTo ?? lines[0]) - 1];
  if (target) {
    const box = $("#code");
    box.scrollTo({ top: target.offsetTop - box.clientHeight / 3, behavior: REDUCED_MOTION ? "auto" : "smooth" });
  }
}

// Clicking a source line jumps to the names defined or used there.
function pickLine(ln) {
  const order = ["variable", "attribute", "parameter", "function", "method", "class", "module"];
  let hits = state.graph.nodes.filter((n) => n.kind !== "external" && n.lines.includes(ln));
  if (!hits.length) {
    const ids = new Set();
    state.graph.edges.filter((e) => e.lines.includes(ln)).forEach((e) => { ids.add(e.source); ids.add(e.target); });
    hits = [...ids].map((id) => state.nodesById.get(id)).filter((n) => n && n.kind !== "external" && n.kind !== "module");
  }
  hits.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  if (!hits.length) return;
  if (hits.length === 1) {
    $("#search").value = qualified(hits[0]);
    focusNode(hits[0].id);
    return;
  }
  // Several names on the line: let the user choose in the candidate list.
  const search = $("#search");
  search.value = "";
  state.candidates = hits;
  state.active = 0;
  search.focus();
  renderCandidates(true, t("search.line", { line: ln }));
}

// ---------------------------------------------------------------- events

function bindEvents() {
  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("#drop-overlay").hidden = false; });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop-overlay").hidden = true; } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
    readFile(e.dataTransfer.files[0]);
  });
  $("#file-input").addEventListener("change", (e) => readFile(e.target.files[0]));
  $("#drop-zone").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file-input").click(); }
  });
  $("#example-select").addEventListener("change", (e) => loadExample(e.target.value));

  // Search box with keyboard navigation of the candidate list.
  const search = $("#search");
  search.addEventListener("input", updateCandidates);
  search.addEventListener("focus", () => { if (search.value.trim()) updateCandidates(); });
  search.addEventListener("blur", closeCandidates);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { e.preventDefault(); chooseCandidate(Math.max(state.active, 0)); }
    else if (e.key === "Escape") { closeCandidates(); search.blur(); }
  });
  // "/" jumps to the search box from anywhere except text fields.
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      search.focus();
      search.select();
    }
  });
  $("#overview-btn").addEventListener("click", () => { search.value = ""; showOverview(); renderDetails(null); });

  // Source lines are clickable.
  $("#code").addEventListener("click", (e) => {
    const li = e.target.closest("li.linkable");
    if (li) pickLine(Number(li.dataset.line));
  });

  // View controls redraw the current center.
  $("#depth").addEventListener("input", (e) => { $("#depth-value").textContent = e.target.value; refresh(); });
  ["#direction", "#fam-call", "#fam-data", "#fam-ext"].forEach((sel) => $(sel).addEventListener("change", refresh));

  $("#lang-toggle").addEventListener("click", () => {
    lang = lang === "en" ? "zh-TW" : "en";
    try { localStorage.setItem("pyflow.lang", lang); } catch (_) { /* ignore */ }
    applyLanguage();
    if (state.graph) {
      // Re-render text that is built in JS rather than marked with data-i18n.
      if (!state.graph.error) $("#file-info").textContent = t("file.info", { name: state.graph.filename, ...state.graph.stats });
      renderUnsupported();
      renderDetails(state.nodesById.get(state.selected) || null);
      if (state.view) drawGraph(state.view);
    }
    setStatus(state.api ? "status.ready" : "status.loading");
  });

  // Refit the graph when the window (or phone orientation) changes size.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!cy || !cy.nodes().length) return;
      cy.resize();
      if (flowDirection() !== laidOutDirection && state.view) drawGraph(state.view); // re-layout in the new direction
      else fitView(state.center, false);
    }, 150);
  });

  // Keep graph colours in sync with the system light/dark setting.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (cy) cy.style(graphStyle());
  });
}

// ---------------------------------------------------------------- start

// cytoscape-dagre registers itself when loaded after cytoscape; register again only if it did not.
try { if (window.cytoscapeDagre) cytoscape.use(window.cytoscapeDagre); } catch (_) { /* already registered */ }
applyLanguage();
bindEvents();
showEmpty("empty.loading");
loadExampleList().then(startPython);
