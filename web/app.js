// pyflow web front end.
// Loads the Python analyzer into Pyodide, then wires up drag-and-drop,
// the search box, the Cytoscape graph and the source panel.
// All analysis runs in the browser; nothing is uploaded.
"use strict";

// baseURI, not location.href: inside the VS Code webview a <base> tag points at the bundled files.
const PYODIDE_INDEX = new URL("vendor/pyodide/", document.baseURI).href;
const PY_FILES = ["__init__.py", "analyzer.py", "graph.py", "api.py", "cli.py"];
const MAX_BYTES = 2_000_000;   // larger files work but the graph becomes unreadable
const MIN_ZOOM = 0.6;          // never fit so far out that labels are unreadable
const MAX_FIT_ZOOM = 1.25;     // ...nor so far in that a small graph looks enormous
const BIG_GRAPH = 120;         // nodes; above this, suggest narrowing the view
const LABEL_EDGES = 24;        // show edge labels only when the view is this small
const FOLD_OVERVIEW = 60;      // overview nodes; above this, methods fold into their class
const MAX_IMPACT = 150;        // nodes drawn for an impact result; the list and marks cover all
const DEPTH_INF = 7;           // slider position meaning "no limit"
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
    "fam.inside": "Inside functions",
    "legend.title": "Legend",
    "legend.up": "Upstream: where it comes from",
    "legend.center": "Selected",
    "legend.down": "Downstream: where it goes",
    "legend.function": "Function",
    "legend.method": "Method",
    "legend.class": "Class",
    "legend.var": "Variable / parameter",
    "legend.attr": "Attribute (self.x, dataclass field)",
    "legend.ext": "External call (library, builtin)",
    "legend.grp": "Class box: its methods and attributes",
    "legend.fnbox": "Function box: its parameters and locals",
    "legend.flag": "Has constructs pyflow cannot follow",
    "legend.call": "Call",
    "legend.data": "Data flow",
    "graph.hint": "Hover a node to trace how the change reaches it. Click a node to ask the same question about it.",
    "refresh": "Refresh", "refresh.title": "Read the file again from the editor, including unsaved changes",
    "details.foldAll": "Fold all", "details.unfoldAll": "Unfold all",
    "panel.resize": "Drag to resize; double-click to reset",
    "panel.hideLeft": "Hide left panel", "panel.showLeft": "Show left panel",
    "panel.hideRight": "Hide right panel", "panel.showRight": "Show right panel",
    "notice.big": "{n} nodes. Lower the depth or hide external calls for a clearer view.",
    "notice.folded": "Large file: methods are folded into their class. Click a class to see its methods.",
    "label.methods": "{n} methods",
    "label.method": "1 method",
    "mode.impact": "What changes", "mode.sources": "Where from", "mode.both": "Both",
    "fam.control": "Conditions",
    "legend.cond": "Only through a condition (if / loop)",
    "legend.eff": "Output / side effect",
    "code.hint": "click a variable",
    "edge.control": "decides",
    "impact.title": "If {name} changes",
    "impact.none": "Nothing else in this file depends on it.",
    "impact.n": "{n} affected",
    "impact.values": "{n} variables", "impact.returns": "{n} return values", "impact.effects": "{n} outputs",
    "impact.runs": "{n} run differently", "impact.callers": "{n} callers", "impact.external": "{n} library calls",
    "impact.values.one": "1 variable", "impact.returns.one": "1 return value", "impact.effects.one": "1 output",
    "impact.runs.one": "1 runs differently", "impact.callers.one": "1 caller", "impact.external.one": "1 library call",
    "graph.flow": "Switch between left-to-right and top-to-bottom",
    "impact.cond": "{n} only via a condition",
    "impact.via": "via {path}",
    "impact.recenter": "Ask the same about this",
    "impact.trunc": "The graph shows the nearest {shown} of {total}. The list and the source marks cover all of them.",
    "impact.depthcut": "Stopped at the depth limit; move the slider to ∞ to see everything.",
    "impact.warn": "May be incomplete: pyflow cannot follow these",
    "grp.value": "Variables and attributes", "grp.returns": "Return values", "grp.effect": "Output and side effects",
    "grp.external": "Passed to library calls", "grp.runs": "Runs differently", "grp.caller": "Callers",
    "cond.badge": "condition",
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
    "d.calledBy": "Called by", "d.args": "Arguments in", "d.returns": "Returns",
    "d.resultTo": "Result goes to", "d.calls": "Calls", "d.locals": "Local variables",
    "f.argTo": "{param} ← {src}", "f.returned": "return of {fn}()", "f.paramOf": "param {param} of {fn}",
    "f.extArg": "into {fn}()", "f.retOf": "return value of {fn}",
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
    "fam.inside": "函式內部",
    "legend.title": "圖例",
    "legend.up": "上游：值從哪裡來",
    "legend.center": "目前選取",
    "legend.down": "下游：值往哪裡去",
    "legend.function": "函式",
    "legend.method": "方法",
    "legend.class": "類別",
    "legend.var": "變數／參數",
    "legend.attr": "屬性（self.x、dataclass 欄位）",
    "legend.ext": "外部呼叫（函式庫、內建函式）",
    "legend.grp": "類別框：其方法與屬性",
    "legend.fnbox": "函式框：其參數與區域變數",
    "legend.flag": "含 pyflow 無法追蹤的寫法",
    "legend.call": "呼叫",
    "legend.data": "資料流",
    "graph.hint": "滑過節點可追蹤變化如何到達它；點擊節點可對它問同樣的問題。",
    "refresh": "重新整理", "refresh.title": "從編輯器重新讀取檔案，包含尚未存檔的修改",
    "details.foldAll": "全部摺疊", "details.unfoldAll": "全部展開",
    "panel.resize": "拖曳調整寬度；雙擊恢復預設",
    "panel.hideLeft": "收合左側面板", "panel.showLeft": "展開左側面板",
    "panel.hideRight": "收合右側面板", "panel.showRight": "展開右側面板",
    "notice.big": "共 {n} 個節點。降低深度或隱藏外部呼叫，圖會更清楚。",
    "notice.folded": "檔案較大：方法已收合進所屬類別。點擊類別可查看其方法。",
    "label.methods": "{n} 個方法",
    "label.method": "1 個方法",
    "mode.impact": "會影響哪裡", "mode.sources": "從哪裡來", "mode.both": "兩者",
    "fam.control": "條件",
    "legend.cond": "僅經由條件（if／迴圈）",
    "legend.eff": "輸出／副作用",
    "code.hint": "點擊變數",
    "edge.control": "決定",
    "impact.title": "如果 {name} 改變",
    "impact.none": "此檔案中沒有其他東西依賴它。",
    "impact.n": "{n} 處受影響",
    "impact.values": "{n} 個變數", "impact.returns": "{n} 個回傳值", "impact.effects": "{n} 個輸出",
    "impact.runs": "{n} 個函式執行方式改變", "impact.callers": "{n} 個呼叫者", "impact.external": "{n} 個函式庫呼叫",
    "graph.flow": "切換由左至右／由上而下",
    "impact.cond": "{n} 個僅經由條件",
    "impact.via": "經由 {path}",
    "impact.recenter": "對它問同樣的問題",
    "impact.trunc": "圖只畫最近的 {shown} 個（共 {total} 個）；清單與原始碼標記涵蓋全部。",
    "impact.depthcut": "已停在深度上限；把滑桿移到 ∞ 可看到全部。",
    "impact.warn": "結果可能不完整：pyflow 無法追蹤這些地方",
    "grp.value": "變數與屬性", "grp.returns": "回傳值", "grp.effect": "輸出與副作用",
    "grp.external": "傳入函式庫呼叫", "grp.runs": "執行方式改變", "grp.caller": "呼叫者",
    "cond.badge": "條件",
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
    "d.calledBy": "被呼叫", "d.args": "傳入引數", "d.returns": "回傳",
    "d.resultTo": "結果去向", "d.calls": "呼叫", "d.locals": "區域變數",
    "f.argTo": "{param} ← {src}", "f.returned": "{fn}() 的回傳", "f.paramOf": "{fn} 的參數 {param}",
    "f.extArg": "傳給 {fn}()", "f.retOf": "{fn} 的回傳值",
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

// Like t(), but uses "<key>.one" when n is 1 and the language has one.
function tn(key, n) {
  return t(n === 1 && (STRINGS[lang][`${key}.one`] || STRINGS.en[`${key}.one`]) ? `${key}.one` : key, { n });
}

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
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  $("#lang-toggle").textContent = lang === "en" ? "中文" : "English";
  updatePanelToggles();
}

// ---------------------------------------------------------------- collapsible panels

// Each side: the .layout class that hides it, its edge button, and the arrows to show.
const PANELS = {
  left: { cls: "hide-left", btn: "#toggle-left", key: "pyflow.hideLeft", hide: "‹", show: "›", label: "Left" },
  right: { cls: "hide-right", btn: "#toggle-right", key: "pyflow.hideRight", hide: "›", show: "‹", label: "Right" },
};

// Arrow points the way the panel will move; label and aria-expanded follow the language and state.
function updatePanelToggles() {
  for (const p of Object.values(PANELS)) {
    const hidden = $(".layout").classList.contains(p.cls);
    const btn = $(p.btn);
    btn.textContent = hidden ? p.show : p.hide;
    btn.title = t(`panel.${hidden ? "show" : "hide"}${p.label}`);
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-expanded", String(!hidden));
  }
}

function setPanelHidden(side, hidden) {
  const p = PANELS[side];
  $(".layout").classList.toggle(p.cls, hidden);
  try { localStorage.setItem(p.key, hidden ? "1" : "0"); } catch (_) { /* ignore */ }
  updatePanelToggles();
  refitGraph();
}

// The graph area just changed width; refit once the new layout is in place.
function refitGraph() {
  requestAnimationFrame(() => {
    if (!cy || !cy.nodes().length) return;
    cy.resize();
    fitView(state.center, false);
  });
}

// ---------------------------------------------------------------- resizable panels

// Dragged widths live in --left-w / --right-w on .layout (see style.css).
const SPLITS = {
  left: { el: "#split-left", prop: "--left-w", key: "pyflow.leftWidth", min: 200, def: 284 },
  right: { el: "#split-right", prop: "--right-w", key: "pyflow.rightWidth", min: 260, def: 380 },
};
const MIN_GRAPH = 320; // px the graph keeps however wide the panels get

function panelWidth(side) {
  const v = parseFloat($(".layout").style.getPropertyValue(SPLITS[side].prop));
  return Number.isFinite(v) ? v : SPLITS[side].def;
}

// Clamp so the panel keeps its minimum and the graph keeps MIN_GRAPH beside both panels.
function setPanelWidth(side, px, save) {
  const s = SPLITS[side];
  const layout = $(".layout");
  const other = side === "left" ? "right" : "left";
  const otherWidth = layout.classList.contains(PANELS[other].cls) ? 0 : panelWidth(other);
  const room = layout.clientWidth - MIN_GRAPH - 12 - otherWidth; // 12 = both splitters
  const w = Math.round(Math.max(s.min, Math.min(px, room)));
  layout.style.setProperty(s.prop, `${w}px`);
  $(s.el).setAttribute("aria-valuenow", String(w));
  if (save) try { localStorage.setItem(s.key, String(w)); } catch (_) { /* ignore */ }
}

function bindSplitter(side) {
  const s = SPLITS[side];
  const el = $(s.el);
  const layout = $(".layout");
  // Panel width for a pointer at x: distance from the layout's outer edge on that side.
  const widthAt = (x) => {
    const r = layout.getBoundingClientRect();
    return side === "left" ? x - r.left : r.right - x;
  };
  let frame = 0;
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    el.classList.add("dragging");
    document.body.classList.add("resizing");
  });
  el.addEventListener("pointermove", (ev) => {
    if (!el.hasPointerCapture(ev.pointerId)) return;
    setPanelWidth(side, widthAt(ev.clientX), false);
    // Resize the canvas at most once per frame while dragging; refit when released.
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (cy) cy.resize(); });
  });
  const end = () => {
    if (!el.classList.contains("dragging")) return; // pointerup and lostpointercapture both land here
    el.classList.remove("dragging");
    document.body.classList.remove("resizing");
    setPanelWidth(side, panelWidth(side), true);
    refitGraph();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("lostpointercapture", end);
  el.addEventListener("dblclick", () => {
    layout.style.removeProperty(s.prop);
    try { localStorage.removeItem(s.key); } catch (_) { /* ignore */ }
    refitGraph();
  });
  // Keyboard: arrows move the splitter (Shift for bigger steps).
  el.addEventListener("keydown", (ev) => {
    const dir = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    ev.preventDefault();
    const step = (ev.shiftKey ? 48 : 16) * dir;
    setPanelWidth(side, panelWidth(side) + (side === "left" ? step : -step), true);
    refitGraph();
  });
}

function restoreWidths() {
  for (const [side, s] of Object.entries(SPLITS)) {
    let saved = NaN;
    try { saved = parseFloat(localStorage.getItem(s.key)); } catch (_) { /* ignore */ }
    if (Number.isFinite(saved)) setPanelWidth(side, saved, false);
    bindSplitter(side);
  }
}

// Restore the last choice; storage can be blocked (private mode, webview), so default to shown.
function restorePanels() {
  for (const [side, p] of Object.entries(PANELS)) {
    let hidden = false;
    try { hidden = localStorage.getItem(p.key) === "1"; } catch (_) { /* ignore */ }
    $(".layout").classList.toggle(p.cls, hidden);
    $(p.btn).addEventListener("click", () => setPanelHidden(side, !$(".layout").classList.contains(p.cls)));
  }
  updatePanelToggles();
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
  mode: "impact",      // "impact" | "sources" | "both"
  depth: { impact: DEPTH_INF, sources: 2, both: 2 }, // slider value remembered per mode
  impact: null,        // last impact result (when mode is impact)
  syntax: new Map(),   // line -> [[start, end, class]] from Python's tokenizer
  marks: new Map(),    // line -> [[start, end, class]] for the current impact result
  refsByLine: new Map(),
  example: null,       // name of the loaded example, for shareable links
  flow: null,          // "LR" | "TB" when the user chose a direction; null = automatic
};

let cy = null;
let currentLayout = null;    // the layout whose result should be fitted; older ones are ignored
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
      const { name, text, focus } = state.pendingFile;
      state.pendingFile = null;
      loadSource(text, name);
      focusAtCursor(focus);
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
  state.impact = null;
  state.marks = new Map();
  state.refsByLine = new Map();
  for (const r of state.graph.refs || []) {
    if (!state.refsByLine.has(r.line)) state.refsByLine.set(r.line, []);
    state.refsByLine.get(r.line).push(r);
  }
  $("#impact-panel").hidden = true;
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
    // Entries are {name, hero}: hero is the name to look up first, so an example opens on an answer.
    list.map((e) => (typeof e === "string" ? { name: e, hero: null } : e)).forEach((e) => {
      const option = new Option(e.name, e.name);
      option.dataset.hero = e.hero || "";
      select.add(option);
    });
  } catch (_) {
    select.closest(".row").hidden = true; // examples are optional
  }
}

async function loadExample(name, query) {
  if (!name) return;
  const text = await (await fetch(`examples/${name}`)).text();
  const select = $("#example-select");
  select.value = name;
  state.example = name;
  loadSource(text, name);
  const hero = query ?? select.selectedOptions[0]?.dataset.hero;
  if (hero) focusQuery(hero);
}

// Inside the VS Code extension (vscode/extension.js) the editor sends the .py file being
// viewed; in a normal browser VSCODE is null and none of this runs.
const VSCODE = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

function listenToEditor() {
  if (!VSCODE) return;
  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    // 只有游標移動（檔案沒變）：直接改問游標所在的名稱
    if (msg && msg.type === "cursor") { focusAtCursor(msg.focus); return; }
    if (!msg || msg.type !== "file") return;
    if (msg.text.length > MAX_BYTES) { $("#file-info").textContent = t("file.big"); return; }
    // Re-sent after a save: keep looking at the same node if it still exists.
    const keep = msg.path === state.editorPath ? state.center : null;
    state.editorPath = msg.path;
    $("#example-select").value = "";
    loadSource(msg.text, msg.name);
    if (msg.focus) {
      // 指令帶入游標位置：Python 尚未載入時先記著，載入後再套用
      if (state.pendingFile) state.pendingFile.focus = msg.focus;
      else focusAtCursor(msg.focus);
    } else if (keep && state.nodesById.has(keep)) {
      $("#search").value = qualified(state.nodesById.get(keep));
      focusNode(keep);
    }
  });
  // Ask for the current file only once the listener is in place, so nothing is lost.
  VSCODE.postMessage({ type: "ready" });
  // Manual re-read, for when an automatic update (switch or save) did not arrive.
  const refresh = $("#refresh-btn");
  refresh.hidden = false;
  refresh.addEventListener("click", () => VSCODE.postMessage({ type: "refresh" }));
}

// 編輯器游標所在的名稱（行為 1 起算，欄為 UTF-16）：找到就問它的影響，找不到維持總覽。
function focusAtCursor(focus) {
  if (!state.graph || state.graph.error || !focus) return;
  const node = tokenAt(focus.line, focus.col);
  if (!node) return;
  $("#search").value = qualified(node);
  focusNode(node.id);
}

// Open on the link's example if there is one, else on the class example.
async function loadDefaultExample() {
  const params = new URLSearchParams(location.hash.slice(1));
  const options = [...$("#example-select").options];
  const wanted = options.find((o) => o.value && o.value === params.get("ex"));
  const preferred = wanted || options.find((o) => o.value === "class_based.py") || options.find((o) => o.value);
  if (params.get("m") && ["impact", "sources", "both"].includes(params.get("m"))) setMode(params.get("m"), false);
  if (preferred) await loadExample(preferred.value, wanted ? params.get("q") : undefined);
}

// Look a name up and show it: the first exact match, else the best match.
function focusQuery(query) {
  if (!state.api || !state.graph || state.graph.error) return;
  const hits = JSON.parse(state.api.find(query, 5));
  if (!hits.length) return;
  $("#search").value = query;
  focusNode((hits.find((h) => h.score === 0) || hits[0]).id);
}

// Keep the address bar pointing at what is on screen, so a link shares the view.
function updateHash() {
  if (!state.example || !state.center) return;
  const n = state.nodesById.get(state.center);
  if (!n) return;
  const params = new URLSearchParams({ ex: state.example, q: qualified(n), m: state.mode });
  try { history.replaceState(null, "", `#${params}`); } catch (_) { /* sandboxed frames may refuse */ }
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
  if ($("#fam-control").checked) fams.push("control");
  return fams.join(",");
}

function setMode(mode, redraw = true) {
  state.mode = mode;
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
  // "Inside functions" only shapes the other two views; impact mode answers for functions itself.
  $("#fn-inside").closest("label").hidden = mode === "impact";
  const depth = state.depth[mode];
  $("#depth").value = depth;
  $("#depth-value").textContent = depth >= DEPTH_INF ? "∞" : depth;
  if (redraw) refresh();
}

function focusNode(id) {
  state.center = id;
  refresh();
  selectNode(id);
  updateHash();
}

function showOverview() {
  state.center = null;
  refresh();
}

// Redraw the current view with the current controls.
function refresh() {
  if (!state.api || !state.graph || state.graph.error) return;
  const depth = Number($("#depth").value);
  // A function or method in the middle is drawn from the inside (params, locals, one step
  // around) unless "Inside functions" is off; depth and direction do not apply to that view.
  // In "What changes" mode the impact answer is shown instead: for a function it is the
  // callers and results that change, which the inside view does not say.
  const kind = state.center && state.nodesById.get(state.center)?.kind;
  const inside = $("#fn-inside").checked && (kind === "function" || kind === "method") && state.mode !== "impact";
  let sub;
  state.impact = null;
  if (!state.center) {
    sub = JSON.parse(state.api.whole_file());
    if (sub.nodes.length > FOLD_OVERVIEW) sub = foldMethods(sub);
  } else if (state.mode === "impact") {
    // The answer to "what changes?": everything downstream, through data and (optionally) conditions.
    sub = state.impact = JSON.parse(state.api.impact_of(state.center, depth >= DEPTH_INF ? 0 : depth,
      $("#fam-control").checked ? 1 : 0, MAX_IMPACT));
  } else if (inside) {
    sub = JSON.parse(state.api.inside(state.center, families()));
  } else {
    sub = JSON.parse(state.api.neighborhood(state.center, depth, state.mode === "sources" ? "upstream" : "both", families()));
  }
  drawGraph(sub);
  renderImpact(state.impact);
  if (state.impact) applyMarks(state.impact);
  else { applyMarks(null); markViewLines(sub); }
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

// One table drives both the graph (cytoscape shape) and the legend (SVG outline),
// so the two cannot drift apart. Shapes are the only cue; no symbol prefixes.
// pts: outline in a 20x12 box. dash: border style of the swatch.
const NODE_SHAPES = {
  function: { shape: "round-rectangle", fill: "--node-fn", i18n: "legend.function",
    pts: "2,0.5 18,0.5 19.5,2 19.5,10 18,11.5 2,11.5 0.5,10 0.5,2" },
  method: { shape: "hexagon", fill: "--node-fn", i18n: "legend.method",
    pts: "4,0.5 16,0.5 19.5,6 16,11.5 4,11.5 0.5,6" },
  class: { shape: "cut-rectangle", fill: "--node-fn", i18n: "legend.class",
    pts: "3.5,0.5 16.5,0.5 19.5,3.5 19.5,8.5 16.5,11.5 3.5,11.5 0.5,8.5 0.5,3.5" },
  variable: { shape: "ellipse", fill: "--node-var", i18n: "legend.var", ellipse: true },
  attribute: { shape: "rhomboid", fill: "--node-attr", i18n: "legend.attr",
    pts: "4,0.5 19.5,0.5 16,11.5 0.5,11.5" },
  external: { shape: "tag", fill: "--node-ext", i18n: "legend.ext", dash: "3 2",
    pts: "0.5,0.5 14,0.5 19.5,6 14,11.5 0.5,11.5" },
  // Boxes: the class box has cut corners, the function box has round corners and a dotted edge.
  classbox: { shape: "cut-rectangle", fill: "--group", i18n: "legend.grp", dash: "3 2",
    pts: "3.5,0.5 16.5,0.5 19.5,3.5 19.5,8.5 16.5,11.5 3.5,11.5 0.5,8.5 0.5,3.5" },
  fnbox: { shape: "round-rectangle", fill: "--group", i18n: "legend.fnbox", dash: "1 2",
    pts: "2,0.5 18,0.5 19.5,2 19.5,10 18,11.5 2,11.5 0.5,10 0.5,2" },
};

// Fill the legend's shape rows from NODE_SHAPES (labels are translated by applyLanguage).
function buildNodeLegend() {
  const list = $("#legend-shapes");
  list.replaceChildren();
  const NS = "http://www.w3.org/2000/svg";
  for (const spec of Object.values(NODE_SHAPES)) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 20 12");
    svg.setAttribute("class", "shape-svg");
    const el = document.createElementNS(NS, spec.ellipse ? "ellipse" : "polygon");
    if (spec.ellipse) { el.setAttribute("cx", "10"); el.setAttribute("cy", "6"); el.setAttribute("rx", "9.5"); el.setAttribute("ry", "5.5"); }
    else el.setAttribute("points", spec.pts);
    el.setAttribute("fill", `var(${spec.fill})`);
    el.setAttribute("stroke", "var(--muted)");
    el.setAttribute("stroke-width", "1.2");
    if (spec.dash) el.setAttribute("stroke-dasharray", spec.dash);
    svg.append(el);
    const label = document.createElement("span");
    label.dataset.i18n = spec.i18n;
    const li = document.createElement("li");
    li.append(svg, label);
    list.append(li);
  }
}

function graphStyle() {
  const c = {
    text: cssVar("--text"), muted: cssVar("--muted"), up: cssVar("--up"), down: cssVar("--down"),
    center: cssVar("--center"), cond: cssVar("--cond"), eff: cssVar("--eff"),
    fn: cssVar("--node-fn"), v: cssVar("--node-var"), attr: cssVar("--node-attr"),
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
    { selector: "node[kind = 'function'], node[kind = 'module']", style: { "shape": NODE_SHAPES.function.shape } },
    { selector: "node[kind = 'method']", style: { "shape": NODE_SHAPES.method.shape, "padding": "13px" } },
    { selector: "node[kind = 'class']", style: { "shape": NODE_SHAPES.class.shape, "padding": "11px" } },
    { selector: "node[kind = 'variable'], node[kind = 'parameter']", style: { "shape": NODE_SHAPES.variable.shape, "padding": "11px" } },
    { selector: "node[kind = 'attribute']", style: { "background-color": c.attr, "shape": NODE_SHAPES.attribute.shape, "padding": "13px" } },
    { selector: "node[kind = 'external']", style: {
      "background-color": c.ext, "border-style": "dashed", "color": c.muted, "shape": NODE_SHAPES.external.shape, "padding": "13px" } },
    { selector: "node[kind = 'group']", style: {
      "background-color": c.group, "background-opacity": 0.9, "border-style": "dashed", "border-color": c.border,
      "border-width": 1.5, "shape": NODE_SHAPES.classbox.shape, "padding": "14px",
      "text-valign": "top", "text-halign": "center", "text-margin-y": -4, "font-weight": 600, "color": c.muted,
    } },
    // The function box is told apart from the class box by round corners and a dotted edge.
    { selector: "node[kind = 'group'][box = 'fn']", style: { "shape": NODE_SHAPES.fnbox.shape, "border-style": "dotted", "border-width": 2 } },
    { selector: "node[side = 'up']", style: { "border-color": c.up, "border-width": 2.5 } },
    { selector: "node[side = 'down']", style: { "border-color": c.down, "border-width": 2.5 } },
    { selector: "node[influence = 'condition']", style: { "border-color": c.cond, "border-style": "dashed", "border-width": 2.5 } },
    { selector: "node[category = 'effect']", style: { "border-color": c.eff, "border-width": 3.5, "border-style": "solid", "color": c.eff, "font-weight": 600 } },
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
    { selector: "edge[kind = 'control']", style: {
      "line-color": c.cond, "target-arrow-color": c.cond, "line-style": "dotted", "width": 2,
    } },
    { selector: "edge.show-label, edge.path", style: { "label": "data(label)" } },
    { selector: ".faded", style: { "opacity": 0.18 } },
    { selector: "edge.path", style: { "width": 3.5, "z-index": 10 } },
    { selector: "node.path", style: { "border-width": 3.5 } },
  ];
}

function nodeLabel(n, grouped, crowded = true) {
  if (n.folded) return `${n.name}\n${n.folded === 1 ? t("label.method") : t("label.methods", { n: n.folded })}`;
  switch (n.kind) {
    case "function": return `${n.name}()`;
    case "method": return grouped ? `${n.name}()` : `${n.scope}.${n.name}()`;
    case "attribute": return grouped ? `.${n.name}` : `${n.scope}.${n.name}`;
    case "variable":
    case "parameter": return grouped || !crowded ? n.name : `${n.name}\n${scopeLabel(n.scope)}`; // a box already names the scope
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
  // Function box (inside view only): level 0 is the function and its own scope.
  // Its members stay out of class boxes, so a method's box is not nested in its class's.
  const fnBox = sub.scope ? `grp:fn:${sub.scope}` : null;
  const inBox = (n) => fnBox !== null && n.level === 0;
  // Only draw a class box when at least two of its members are visible.
  const members = new Map();
  sub.nodes.forEach((n) => {
    const g = inBox(n) ? null : groupOf(n);
    if (g) members.set(g, (members.get(g) || 0) + 1);
  });
  const groups = [...members].filter(([, count]) => count >= 2).map(([g]) => g);
  const groupSet = new Set(groups);
  // A variable's scope is shown only when another visible variable has the same name.
  const seen = new Map();
  sub.nodes.forEach((n) => { if (n.kind === "variable" || n.kind === "parameter") seen.set(n.name, (seen.get(n.name) || 0) + 1); });
  return [
    ...(fnBox ? [{ data: { id: fnBox, label: `${scopeLabel(sub.scope)}()`, kind: "group", box: "fn" } }] : []),
    ...groups.map((g) => ({ data: { id: `grp:${g}`, label: g, kind: "group", box: "class" } })),
    ...sub.nodes.map((n) => {
      const g = inBox(n) ? null : groupOf(n);
      const parent = inBox(n) ? fnBox : g && groupSet.has(g) ? `grp:${g}` : undefined;
      return { data: {
        id: n.id, parent, label: nodeLabel(n, Boolean(parent), seen.get(n.name) > 1), fullLabel: nodeLabel(n, false, seen.get(n.name) > 1),
        kind: n.kind, level: n.level, influence: n.influence || "", category: n.category || "",
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

// Past this many nodes, an impact graph shows only the step that brought each node in,
// which reads as a tree; the list and the source marks still carry every connection.
const TREE_ABOVE = 40;

function asTree(sub) {
  if (!sub.nodes.length || sub.nodes[0].category !== "source" || sub.nodes.length <= TREE_ABOVE) return sub;
  const shown = new Set(sub.nodes.map((n) => n.id));
  const parents = new Map();
  for (const n of sub.nodes.slice(1)) {
    const step = n.path[n.path.length - 1];
    if (step && shown.has(step.from) && shown.has(step.to)) parents.set(`${step.from}|${step.to}|${step.kind}`, step);
  }
  const edges = sub.edges.filter((e) => parents.has(`${e.source}|${e.target}|${e.kind}`));
  return { ...sub, edges };
}

function drawGraph(rawSub) {
  const sub = asTree(applyFilters(rawSub));
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
  currentLayout = layout;
  layout.one("layoutstop", () => {
    if (layout !== currentLayout) return; // a newer draw replaced this graph while it was animating
    dissolveCrowdedGroups();
    if (overview) packComponents();
    fitView(sub.center, animate, state.mode === "impact" && Boolean(state.impact));
  });
  layout.run();
  if (sub.center) cy.getElementById(sub.center).select();
}

// Left to right on wide screens (as agreed); top to bottom on narrow ones,
// where a horizontal flow would not fit.
function flowDirection() { return state.flow || (cy.width() < 600 ? "TB" : "LR"); }

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
function fitView(centerId, animated, startAtEdge = false) {
  const apply = () => {
    cy.fit(undefined, 36);
    if (cy.zoom() > MAX_FIT_ZOOM) { cy.zoom(MAX_FIT_ZOOM); cy.center(); } // a tiny graph need not fill the screen
    if (cy.zoom() >= MIN_ZOOM) return;
    cy.zoom(MIN_ZOOM);
    const centerNode = centerId ? cy.getElementById(centerId) : null;
    if (centerNode && centerNode.empty()) { cy.center(); return; } // the graph changed under a running layout
    if (centerId && startAtEdge) {
      // An impact result flows away from its center, so put the center at the near edge
      // instead of the middle, where half the screen would stay empty.
      const pos = centerNode.position();
      if (flowDirection() === "LR") cy.pan({ x: 48 - pos.x * MIN_ZOOM, y: cy.height() / 2 - pos.y * MIN_ZOOM });
      else cy.pan({ x: cy.width() / 2 - pos.x * MIN_ZOOM, y: 48 - pos.y * MIN_ZOOM });
    } else if (centerId) {
      cy.center(centerNode);
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
    updateFoldAll();
    highlightLines([]);
    return;
  }
  box.classList.remove("muted");
  const edges = state.graph.edges;
  const rows = [
    ["d.name", node.name],
    ["d.kind", t(`kind.${node.kind}`)],
    ["d.scope", node.scope ? scopeLabel(node.scope) : "-"],
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
  // What flows in and out, worded by edge kind, so "who passes what" reads directly.
  const label = (n) => n.kind === "module" ? scopeLabel(n.name) : qualified(n);
  for (const [key, items] of flowSections(node, edges, { nodesById: state.nodesById, t, label })) {
    if (!items.length) continue;
    const dd = document.createElement("dd");
    items.forEach((it) => dd.append(flowItem(it)));
    dl.append(foldLabel(key, items.length, dd), dd);
  }
  // Line numbers: where the name is defined or assigned. Clicking scrolls the source.
  const lines = node.lines.length ? node.lines
    : [...new Set(edges.filter((e) => e.source === node.id || e.target === node.id).flatMap((e) => e.lines))].sort((a, b) => a - b);
  const dd = document.createElement("dd");
  lines.forEach((ln) => {
    const a = document.createElement("span");
    a.className = "line-link";
    a.textContent = ln;
    a.addEventListener("click", () => highlightLines(lines, ln));
    dd.append(a);
  });
  if (!lines.length) dd.textContent = "-";
  dl.append(foldLabel("d.lines", lines.length, dd), dd);
  box.append(dl);
  updateFoldAll();
  highlightLines(lines);
}

// ---------------------------------------------------------------- foldable details

// Every section that can fold; "Fold all" folds these even if this node lacks some,
// so the choice still holds after selecting another node.
const FOLD_KEYS = ["d.calledBy", "d.args", "d.returns", "d.resultTo", "d.calls", "d.locals", "d.in", "d.out", "d.lines"];
const foldedSections = (() => {
  try { return new Set(JSON.parse(localStorage.getItem("pyflow.folded") || "[]")); } catch (_) { return new Set(); }
})();

function saveFolded() {
  try { localStorage.setItem("pyflow.folded", JSON.stringify([...foldedSections])); } catch (_) { /* ignore */ }
}

// Section label "▾ Calls (3)"; clicking it (or Enter / Space) folds the dd that follows.
function foldLabel(key, count, dd) {
  const dt = document.createElement("dt");
  dt.className = "fold";
  dt.dataset.key = key;
  dt.tabIndex = 0;
  dt.setAttribute("role", "button");
  const apply = () => {
    const folded = foldedSections.has(key);
    dd.hidden = folded;
    dt.setAttribute("aria-expanded", String(!folded));
    dt.textContent = `${folded ? "▸" : "▾"} ${t(key)} `;
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = `(${count})`;
    dt.append(c);
  };
  const toggle = () => {
    if (foldedSections.has(key)) foldedSections.delete(key); else foldedSections.add(key);
    saveFolded();
    apply();
    updateFoldAll();
  };
  dt.addEventListener("click", toggle);
  dt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
  });
  apply();
  return dt;
}

// The button says "Unfold all" only when every section on screen is folded.
function updateFoldAll() {
  const keys = [...document.querySelectorAll("#details dt.fold")].map((dt) => dt.dataset.key);
  const btn = $("#details-fold");
  btn.hidden = !keys.length;
  btn.textContent = t(keys.length && keys.every((k) => foldedSections.has(k)) ? "details.unfoldAll" : "details.foldAll");
}

function toggleFoldAll() {
  const keys = [...document.querySelectorAll("#details dt.fold")].map((dt) => dt.dataset.key);
  const unfold = keys.length > 0 && keys.every((k) => foldedSections.has(k));
  if (unfold) foldedSections.clear(); else FOLD_KEYS.forEach((k) => foldedSections.add(k));
  saveFolded();
  renderDetails(state.nodesById.get(state.selected) || null);
}

// One clickable flow row: the name re-centers the graph, the numbers jump to the source.
function flowItem(it) {
  const row = document.createElement("div");
  row.className = "flow-item";
  const link = document.createElement("span");
  link.className = "flow-link";
  link.textContent = it.text;
  link.addEventListener("click", () => {
    $("#search").value = qualified(state.nodesById.get(it.id) || { name: it.id });
    focusNode(it.id);
  });
  row.append(link);
  it.lines.forEach((ln) => {
    const a = document.createElement("span");
    a.className = "line-link";
    a.textContent = ln;
    a.addEventListener("click", () => highlightLines(it.lines, ln));
    row.append(" ", a);
  });
  return row;
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

// Source panel: syntax colours from Python's own tokenizer, plus marks for the current answer.
function renderCode(text) {
  const ol = $("#code");
  ol.innerHTML = "";
  state.syntax = new Map();
  try {
    for (const [line, start, end, cls] of JSON.parse(state.api.highlight(text))) {
      if (!state.syntax.has(line)) state.syntax.set(line, []);
      state.syntax.get(line).push([start, end, cls]);
    }
  } catch (_) { /* uncoloured source is still useful */ }

  const frag = document.createDocumentFragment();
  state.sourceLines.forEach((_, i) => {
    const li = document.createElement("li");
    li.dataset.line = i + 1;
    if (state.linesWithNodes.has(i + 1)) li.classList.add("linkable");
    frag.append(li);
    paintLine(li, i + 1);
  });
  ol.append(frag);
}

// Write one line as segments: each carries its syntax class and, if any, its mark class.
function paintLine(li, ln) {
  const text = state.sourceLines[ln - 1] ?? "";
  const syntax = state.syntax.get(ln) || [];
  const marks = state.marks.get(ln) || [];
  const cuts = new Set([0, text.length]);
  for (const [a, b] of [...syntax, ...marks]) { cuts.add(Math.min(a, text.length)); cuts.add(Math.min(b, text.length)); }
  const points = [...cuts].sort((a, b) => a - b);
  const cover = (spans, a, b) => spans.find(([s0, e0]) => s0 <= a && b <= e0)?.[2];
  const parts = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const syn = cover(syntax, a, b), mark = cover(marks, a, b);
    if (!syn && !mark) { parts.push(text.slice(a, b)); continue; }
    const span = document.createElement("span");
    span.className = [syn && `t-${syn}`, mark && `m-${mark}`].filter(Boolean).join(" ");
    span.textContent = text.slice(a, b);
    parts.push(span);
  }
  li.replaceChildren(...(parts.length ? parts : [" "]));
}

// Mark the source for an impact result: where the change starts (blue) and where it lands.
function applyMarks(result) {
  const before = new Set(state.marks.keys());
  const marks = new Map();
  const add = (r, cls) => {
    if (!marks.has(r.line)) marks.set(r.line, []);
    marks.get(r.line).push([r.col, r.end, cls]);
  };
  const lines = new Set();
  if (result) {
    const info = new Map(result.nodes.map((n) => [n.id, n]));
    (result.source_refs || []).forEach((r) => add(r, "src"));
    (result.affected_refs || []).forEach((r) => {
      const n = info.get(r.node);
      add(r, n?.category === "effect" ? "eff" : n?.influence === "condition" ? "cnd" : "aff");
    });
    result.lines.forEach((ln) => lines.add(ln));
  }
  // A token can be listed twice (several affected nodes); keep the strongest mark per range.
  const strength = { src: 4, eff: 3, cnd: 2, aff: 1 };
  for (const [ln, list] of marks) {
    const best = new Map();
    for (const m of list) {
      const key = `${m[0]}:${m[1]}`;
      if (!best.has(key) || strength[m[2]] > strength[best.get(key)[2]]) best.set(key, m);
    }
    marks.set(ln, [...best.values()]);
  }
  state.marks = marks;
  const items = $("#code").children;
  for (const ln of new Set([...before, ...marks.keys()])) if (items[ln - 1]) paintLine(items[ln - 1], ln);
  for (let i = 0; i < items.length; i++) items[i].classList.toggle("in-view", lines.has(i + 1));
}

// ---------------------------------------------------------------- the answer panel

const GROUP_ORDER = ["value", "returns", "effect", "external", "runs", "caller"];

function pathText(result, node) {
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const n = byId.get(id) || state.nodesById.get(id);
    if (!n) return id;
    if (n.kind === "function" || n.kind === "method" || n.kind === "class") return `${n.id.slice(3)}${n.kind === "class" ? "" : "()"}`;
    return n.kind === "variable" || n.kind === "parameter" || n.kind === "attribute"
      ? (n.scope && n.scope !== "<module>" ? `${n.scope}.${n.name}` : n.name) : n.name;
  };
  const ids = [result.center, ...node.path.map((s) => s.to)];
  return ids.map(label).join(" → ");
}

function renderImpact(result) {
  const panel = $("#impact-panel");
  panel.hidden = !result;
  if (!result) return;
  const center = result.nodes[0];
  const s = result.summary;
  const name = center.kind === "function" || center.kind === "method" ? `${qualified(center)}()` : qualified(center);
  const title = $("#impact-title");
  const [before, after] = t("impact.title", { name: "\u0000" }).split("\u0000");
  const code = document.createElement("code");
  code.textContent = name;
  title.replaceChildren(before, code, after);

  const chips = $("#impact-chips");
  chips.replaceChildren();
  const chip = (cls, text) => {
    const el = document.createElement("span");
    el.className = `chip ${cls}`;
    el.textContent = text;
    chips.append(el);
  };
  if (!s.total) {
    chip("", t("impact.none"));
  } else {
    chip("", t("impact.n", { n: s.total }));
    if (s.values) chip("", tn("impact.values", s.values));
    if (s.returns) chip("", tn("impact.returns", s.returns));
    if (s.effects) chip("eff", tn("impact.effects", s.effects));
    if (s.runs) chip("", tn("impact.runs", s.runs));
    if (s.callers) chip("", tn("impact.callers", s.callers));
    if (s.by_condition) chip("cond", t("impact.cond", { n: s.by_condition }));
  }

  const note = $("#impact-note");
  const notes = [];
  if (result.truncated && s.shown < s.total) notes.push(t("impact.trunc", { shown: s.shown, total: s.total }));
  else if (result.truncated) notes.push(t("impact.depthcut"));
  note.textContent = notes.join(" ");
  note.hidden = !notes.length;

  const groups = $("#impact-groups");
  groups.replaceChildren();
  for (const key of GROUP_ORDER) {
    const rows = result.nodes.slice(1).filter((n) => n.category === key);
    if (!rows.length) continue;
    const details = document.createElement("details");
    details.className = "group";
    details.open = key !== "external";
    const summary = document.createElement("summary");
    summary.append(`${t(`grp.${key}`)} `);
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = `(${rows.length})`;
    summary.append(count);
    const list = document.createElement("ul");
    list.className = "items";
    rows.forEach((n) => list.append(impactItem(result, n)));
    details.append(summary, list);
    groups.append(details);
  }

  const warn = $("#impact-warn");
  warn.replaceChildren();
  warn.hidden = !result.warnings.length;
  if (result.warnings.length) {
    const head = document.createElement("b");
    head.textContent = t("impact.warn");
    warn.append(head);
    result.warnings.forEach((w) => {
      const b = document.createElement("button");
      b.type = "button";
      const c = document.createElement("code");
      c.textContent = w.detail;
      b.append(`${t(`u.${w.kind}`)}: `, c, ` · L${w.lines[0]}`);
      b.addEventListener("click", () => highlightLines(w.lines));
      warn.append(b);
    });
  }
}

function impactItem(result, n) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "item";
  btn.dataset.id = n.id;
  const top = document.createElement("div");
  top.className = "top";
  const nm = document.createElement("span");
  nm.className = "nm";
  // Name first; where it lives goes underneath, so long qualified names do not break mid-word.
  const isFn = n.kind === "function" || n.kind === "method";
  nm.textContent = isFn ? `${n.name}()` : n.name;
  top.append(nm);
  const owner = n.kind === "external" ? "" : n.kind === "method" || n.kind === "attribute" || n.kind === "variable" || n.kind === "parameter"
    ? scopeLabel(n.scope) : "";
  if (n.influence === "condition") {
    const badge = document.createElement("span");
    badge.className = "badge-cond";
    badge.textContent = t("cond.badge");
    top.append(badge);
  }
  const sc = document.createElement("span");
  sc.className = "sc";
  sc.textContent = n.where.length ? `L${n.where.slice(0, 3).join(", L")}` : "";
  top.append(sc);
  const where = document.createElement("div");
  where.className = "where";
  where.textContent = owner;
  const why = document.createElement("div");
  why.className = "why";
  why.textContent = n.path.length > 1 ? t("impact.via", { path: pathText(result, n) }) : "";
  const go = document.createElement("span");
  go.className = "go";
  go.textContent = `${t("impact.recenter")} →`;
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    $("#search").value = qualified(n);
    focusNode(n.id);
  });
  btn.append(top, ...(owner ? [where] : []), why, go);
  btn.addEventListener("click", () => {
    document.querySelectorAll(".item.on").forEach((el) => el.classList.remove("on"));
    btn.classList.add("on");
    const node = cy?.getElementById(n.id);
    if (node?.nonempty()) { cy.elements().unselect(); node.select(); tracePath(node); }
    highlightLines(n.where);
    selectNodeQuiet(n.id);
  });
  btn.addEventListener("mouseenter", () => { const node = cy?.getElementById(n.id); if (node?.nonempty()) tracePath(node); });
  btn.addEventListener("mouseleave", () => { if (cy) clearTrace(); });
  li.append(btn);
  return li;
}

// Show a node in the details panel without moving the source highlight again.
function selectNodeQuiet(id) {
  state.selected = id;
  const keep = [...$("#code").querySelectorAll(".hl")].map((li) => Number(li.dataset.line));
  renderDetails(state.nodesById.get(id) || null);
  highlightLines(keep);
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

// UTF-16 column of the caret inside a source line, or null if the user selected text instead.
function caretColumn(li) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !li.contains(sel.anchorNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(li);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}

// The node whose name token covers a position (the same rule as pyflow.locate).
function tokenAt(line, col) {
  const hits = (state.refsByLine.get(line) || []).filter((r) => r.col <= col && col <= r.end);
  hits.sort((a, b) => (a.col <= col && col < a.end ? 0 : 1) - (b.col <= col && col < b.end ? 0 : 1));
  const node = hits.length ? state.nodesById.get(hits[0].node) : null;
  return node && node.kind !== "module" ? node : null;
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
  restorePanels();
  restoreWidths();
  $("#details-fold").addEventListener("click", toggleFoldAll);
  listenToEditor();

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

  // Click a variable or function name in the source to ask what changes if it changes;
  // a click elsewhere on a line offers the names on that line.
  $("#code").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const ln = Number(li.dataset.line);
    const col = caretColumn(li);
    const hit = col === null ? null : tokenAt(ln, col);
    if (hit) {
      $("#search").value = qualified(hit);
      focusNode(hit.id);
    } else if (li.classList.contains("linkable")) {
      pickLine(ln);
    }
  });

  // Mode switch: what changes / where from / both. Each mode remembers its own depth.
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    setMode(b.dataset.mode);
    updateHash();
  }));

  // View controls redraw the current center.
  $("#depth").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    state.depth[state.mode] = v;
    $("#depth-value").textContent = v >= DEPTH_INF ? "∞" : v;
    refresh();
  });
  ["#fam-call", "#fam-data", "#fam-control", "#fam-ext", "#fn-inside"].forEach((sel) => $(sel).addEventListener("change", refresh));

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
      renderImpact(state.impact);
    }
    setStatus(state.api ? "status.ready" : "status.loading");
  });

  // Flow direction: automatic by width, or chosen with the button.
  $("#flow-toggle").addEventListener("click", () => {
    state.flow = flowDirection() === "LR" ? "TB" : "LR";
    if (cy && state.view) drawGraph(state.view);
  });

  // Refit the graph when the window (or phone orientation) changes size.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!cy || !cy.nodes().length) return;
      cy.resize();
      if (flowDirection() !== laidOutDirection && state.view) drawGraph(state.view); // re-layout in the new direction
      else fitView(state.center, false, state.mode === "impact" && Boolean(state.impact));
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
buildNodeLegend();
applyLanguage();
bindEvents();
setMode(state.mode, false);
showEmpty("empty.loading");
loadExampleList().then(startPython);
