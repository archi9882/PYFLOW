// pyflow web front end.
// Loads the Python analyzer into Pyodide, then wires up drag-and-drop,
// the search box and the Cytoscape graph. All analysis runs in the browser.
"use strict";

const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const PY_FILES = ["__init__.py", "analyzer.py", "graph.py", "api.py", "cli.py"];
const MAX_BYTES = 2_000_000; // larger files work but the graph becomes unreadable

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
    "ctl.depth": "Depth",
    "ctl.direction": "Direction",
    "ctl.edges": "Edges",
    "dir.both": "Both",
    "dir.upstream": "Upstream only",
    "dir.downstream": "Downstream only",
    "fam.call": "Calls",
    "fam.data": "Data flow",
    "legend.title": "Legend",
    "legend.up": "Upstream: where it comes from",
    "legend.center": "Selected",
    "legend.down": "Downstream: where it goes",
    "legend.fn": "Function / method / class",
    "legend.var": "Variable / parameter",
    "legend.ext": "External call (library, builtin)",
    "legend.flag": "Has unsupported constructs",
    "legend.call": "Call",
    "legend.data": "Data flow",
    "graph.hint": "Click a node to make it the center. Scroll to zoom, drag to pan.",
    "details.title": "Details",
    "details.none": "Select a node.",
    "unsup.title": "Not analyzed",
    "unsup.hint": "pyflow reads code without running it. These spots may hide extra flow:",
    "unsup.empty": "Nothing to report.",
    "code.title": "Source",
    "empty.loading": "Loading the Python runtime (about 10 MB, first visit only)...",
    "empty.ready": "Drop a .py file or pick an example to start.",
    "empty.nodes": "Nothing connected to this node with the current filters.",
    "empty.nofunc": "No functions in this file. Search for a variable instead.",
    "status.loading": "Loading Python...",
    "status.ready": "Ready",
    "status.failed": "Could not load the Python runtime. Check your connection and reload.",
    "status.analyzing": "Analyzing...",
    "file.info": "{name}: {lines} lines, {functions} functions/classes, {variables} variables",
    "file.syntax": "Syntax error on line {line}: {message}",
    "file.notpy": "Please drop a Python (.py) file.",
    "file.big": "File is larger than 2 MB; skipped.",
    "d.name": "Name", "d.kind": "Kind", "d.scope": "Scope", "d.lines": "Lines",
    "d.in": "Comes from", "d.out": "Goes to", "d.flags": "Warnings",
    "kind.module": "module", "kind.function": "function", "kind.method": "method", "kind.class": "class",
    "kind.parameter": "parameter", "kind.variable": "variable", "kind.external": "external",
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
    "ctl.depth": "深度",
    "ctl.direction": "方向",
    "ctl.edges": "連線",
    "dir.both": "上下游",
    "dir.upstream": "只看上游",
    "dir.downstream": "只看下游",
    "fam.call": "呼叫",
    "fam.data": "資料流",
    "legend.title": "圖例",
    "legend.up": "上游：值從哪裡來",
    "legend.center": "目前選取",
    "legend.down": "下游：值往哪裡去",
    "legend.fn": "函式／方法／類別",
    "legend.var": "變數／參數",
    "legend.ext": "外部呼叫（函式庫、內建函式）",
    "legend.flag": "含未支援的寫法",
    "legend.call": "呼叫",
    "legend.data": "資料流",
    "graph.hint": "點擊節點可改以它為中心。滾輪縮放，拖曳平移。",
    "details.title": "詳細資訊",
    "details.none": "請選取節點。",
    "unsup.title": "未分析",
    "unsup.hint": "pyflow 只讀程式碼、不執行。以下位置可能藏有圖上沒畫出的傳遞：",
    "unsup.empty": "沒有需要注意的地方。",
    "code.title": "原始碼",
    "empty.loading": "正在載入 Python 執行環境（約 10 MB，只有第一次需要）...",
    "empty.ready": "拖曳 .py 檔或選擇範例開始。",
    "empty.nodes": "目前的篩選條件下，沒有與此節點相連的項目。",
    "empty.nofunc": "此檔案沒有函式，請直接搜尋變數。",
    "status.loading": "載入 Python 中...",
    "status.ready": "就緒",
    "status.failed": "無法載入 Python 執行環境，請確認網路連線後重新整理。",
    "status.analyzing": "分析中...",
    "file.info": "{name}：{lines} 行，{functions} 個函式／類別，{variables} 個變數",
    "file.syntax": "第 {line} 行語法錯誤：{message}",
    "file.notpy": "請拖曳 Python（.py）檔。",
    "file.big": "檔案超過 2 MB，已略過。",
    "d.name": "名稱", "d.kind": "種類", "d.scope": "作用域", "d.lines": "行號",
    "d.in": "來自", "d.out": "流向", "d.flags": "警告",
    "kind.module": "模組", "kind.function": "函式", "kind.method": "方法", "kind.class": "類別",
    "kind.parameter": "參數", "kind.variable": "變數", "kind.external": "外部",
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
  api: null,          // pyflow.api module inside Pyodide
  graph: null,        // full analysis result for the current file
  nodesById: new Map(),
  source: "",
  center: null,       // id of the node in the middle of the view (null = overview)
  selected: null,     // id shown in the details panel
  candidates: [],
  active: -1,         // keyboard-highlighted candidate
  pendingFile: null,  // file dropped before Python finished loading
  view: null,         // last subgraph drawn
};

let cy = null;

function setStatus(key) { $("#status").textContent = t(key); }

function showEmpty(key) {
  const box = $("#graph-empty");
  if (key) {
    box.querySelector("p").textContent = t(key);
    box.querySelector("p").dataset.i18n = key;
  }
  box.hidden = !key;
}

// ---------------------------------------------------------------- Python

async function startPython() {
  setStatus("status.loading");
  try {
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
  state.source = text;
  state.graph = JSON.parse(state.api.load(text, name));
  state.nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
  state.center = null;
  state.selected = null;
  setStatus("status.ready");

  renderCode();
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
  const select = $("#example-select");
  const preferred = [...select.options].find((o) => o.value === "pure_functions.py");
  const first = preferred || [...select.options].find((o) => o.value);
  if (first) await loadExample(first.value);
}

// ---------------------------------------------------------------- search

function updateCandidates() {
  if (!state.api || !state.graph) return;
  const query = $("#search").value;
  state.candidates = query.trim() ? JSON.parse(state.api.find(query, 30)) : [];
  state.active = state.candidates.length ? 0 : -1;
  renderCandidates(query.trim() !== "");
}

function renderCandidates(show) {
  const list = $("#candidates");
  list.innerHTML = "";
  if (!show) { closeCandidates(); return; }
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
    meta.textContent = [t(`kind.${c.kind}`), c.scope].filter(Boolean).join(" · ");
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
  renderCandidates(true);
  document.getElementById(`cand-${state.active}`)?.scrollIntoView({ block: "nearest" });
}

function chooseCandidate(i) {
  const c = state.candidates[i];
  if (!c) return;
  // Qualify nested names (main.data) but keep top-level ones short.
  $("#search").value = c.scope && c.scope !== "<module>" ? `${c.scope}.${c.name}` : c.name;
  closeCandidates();
  focusNode(c.id);
}

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
  let sub;
  if (state.center) {
    sub = JSON.parse(state.api.neighborhood(
      state.center, Number($("#depth").value), $("#direction").value, families()));
  } else {
    sub = JSON.parse(state.api.whole_file());
  }
  drawGraph(sub);
}

// ---------------------------------------------------------------- graph drawing

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function graphStyle() {
  const c = {
    text: cssVar("--text"), muted: cssVar("--muted"), up: cssVar("--up"), down: cssVar("--down"),
    center: cssVar("--center"), fn: cssVar("--node-fn"), v: cssVar("--node-var"), ext: cssVar("--node-ext"),
    call: cssVar("--edge-call"), data: cssVar("--edge-data"), flag: cssVar("--flag"), bg: cssVar("--surface"),
  };
  return [
    { selector: "node", style: {
      "label": "data(label)", "text-wrap": "wrap", "text-valign": "center", "text-halign": "center",
      "font-size": 11, "font-family": "ui-monospace, Menlo, Consolas, monospace", "color": c.text,
      "width": "label", "height": "label", "padding": "8px", "shape": "round-rectangle",
      "background-color": c.v, "border-width": 1.5, "border-color": c.muted,
    } },
    { selector: "node[kind = 'function'], node[kind = 'method'], node[kind = 'class'], node[kind = 'module']",
      style: { "background-color": c.fn, "font-weight": "bold", "shape": "round-rectangle" } },
    { selector: "node[kind = 'class']", style: { "shape": "cut-rectangle" } },
    { selector: "node[kind = 'variable'], node[kind = 'parameter']", style: { "shape": "ellipse", "padding": "10px" } },
    { selector: "node[kind = 'external']", style: { "background-color": c.ext, "border-style": "dashed", "color": c.muted } },
    { selector: "node[side = 'up']", style: { "border-color": c.up, "border-width": 2.5 } },
    { selector: "node[side = 'down']", style: { "border-color": c.down, "border-width": 2.5 } },
    { selector: "node[?flagged]", style: { "border-color": c.flag, "border-style": "dashed", "border-width": 2.5 } },
    { selector: "node[?isCenter]", style: { "border-color": c.center, "border-width": 4, "border-style": "solid" } },
    { selector: "node:selected", style: { "overlay-color": c.center, "overlay-opacity": 0.15, "overlay-padding": 4 } },
    { selector: "edge", style: {
      "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.9, "width": 1.5,
      "line-color": c.data, "target-arrow-color": c.data, "line-style": "dashed",
      "label": "data(label)", "font-size": 9, "color": c.muted,
      "text-background-color": c.bg, "text-background-opacity": 1, "text-background-padding": "2px",
    } },
    { selector: "edge[kind = 'call']", style: {
      "line-color": c.call, "target-arrow-color": c.call, "line-style": "solid", "width": 2,
    } },
  ];
}

function nodeLabel(n) {
  // Variables show their scope on a second line so same names stay distinguishable.
  if ((n.kind === "variable" || n.kind === "parameter") && n.scope) return `${n.name}\n${n.scope}`;
  if (n.kind === "method" && n.scope) return `${n.scope}.${n.name}`;
  return n.name;
}

function drawGraph(sub) {
  state.view = sub;
  if (!cy) {
    cy = cytoscape({
      container: $("#graph"), style: graphStyle(), wheelSensitivity: 0.3,
      minZoom: 0.1, maxZoom: 3, boxSelectionEnabled: false,
    });
    cy.on("tap", "node", (ev) => {
      const id = ev.target.id();
      if (id === state.center) selectNode(id);
      else focusNode(id);
    });
  }
  const elements = [
    ...sub.nodes.map((n) => ({ data: {
      id: n.id, label: nodeLabel(n), kind: n.kind,
      side: n.level < 0 ? "up" : n.level > 0 ? "down" : "mid",
      isCenter: n.id === sub.center, flagged: n.flags.length > 0,
    } })),
    ...sub.edges.map((e) => ({ data: {
      id: `${e.source}|${e.target}|${e.kind}`, source: e.source, target: e.target,
      kind: e.kind, label: t(`edge.${e.kind}`),
    } })),
  ];
  cy.elements().remove();
  cy.add(elements);
  if (!sub.nodes.length) {
    showEmpty(state.graph && !state.graph.error && !state.center ? "empty.nofunc" : null);
    return;
  }
  showEmpty(sub.nodes.length === 1 && state.center ? "empty.nodes" : null);
  // Layered left-to-right layout: upstream on the left, downstream on the right.
  cy.layout({ name: "dagre", rankDir: "LR", nodeSep: 18, rankSep: 70, edgeSep: 8, animate: false }).run();
  cy.fit(undefined, 30);
  if (sub.center) cy.getElementById(sub.center).select();
}

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
  const names = (ids) => [...new Set(ids)].map((id) => state.nodesById.get(id)?.name ?? id).join(", ") || "-";
  const rows = [
    ["d.name", node.name],
    ["d.kind", t(`kind.${node.kind}`)],
    ["d.scope", node.scope || "-"],
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
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = t("unsup.empty");
    li.style.borderLeftColor = "var(--border)";
    li.style.cursor = "default";
    list.append(li);
    return;
  }
  items.forEach((u) => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = u.detail;
    li.append(`${t(`u.${u.kind}`)}: `, code, ` · ${u.scope} · L${u.lines.join(", L")}`);
    li.addEventListener("click", () => highlightLines(u.lines));
    list.append(li);
  });
}

function renderCode() {
  const ol = $("#code");
  ol.innerHTML = "";
  const frag = document.createDocumentFragment();
  state.source.split("\n").forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line || " ";
    frag.append(li);
  });
  ol.append(frag);
}

// Highlight source lines and scroll the first (or a chosen) one into view.
function highlightLines(lines, scrollTo) {
  const items = $("#code").children;
  for (const li of $("#code").querySelectorAll(".hl")) li.classList.remove("hl");
  lines.forEach((ln) => items[ln - 1]?.classList.add("hl"));
  const target = items[(scrollTo ?? lines[0]) - 1];
  if (target) {
    const box = $("#code");
    box.scrollTop = target.offsetTop - box.clientHeight / 3;
  }
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
    else if (e.key === "Escape") closeCandidates();
  });
  $("#overview-btn").addEventListener("click", () => { search.value = ""; showOverview(); });

  // View controls redraw the current center.
  $("#depth").addEventListener("input", (e) => { $("#depth-value").textContent = e.target.value; refresh(); });
  ["#direction", "#fam-call", "#fam-data"].forEach((sel) => $(sel).addEventListener("change", refresh));

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

  // Keep graph colors in sync with the system light/dark setting.
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
