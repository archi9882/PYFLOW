// Draws the impact graph inside the VS Code webview. The extension sends one message with the
// result; a click on a node asks the extension to show that place in the editor.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  let cy = null;
  let payload = null;
  let flow = null; // "LR" | "TB" chosen by the user; null = by window width
  let currentLayout = null;

  const theme = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

  function colors() {
    return {
      text: theme("--vscode-editor-foreground", "#ccc"),
      muted: theme("--vscode-descriptionForeground", "#999"),
      bg: theme("--vscode-editor-background", "#1e1e1e"),
      border: theme("--vscode-editorWidget-border", "#555"),
      mono: theme("--vscode-editor-font-family", "monospace"),
      source: "#3b82f6", data: "#2dbd96", cond: "#a78bfa", eff: "#f08a5c",
    };
  }

  function styleSheet() {
    const c = colors();
    return [
      { selector: "node", style: {
        label: "data(label)", "text-wrap": "wrap", "text-valign": "center", "text-halign": "center",
        "font-size": 12, "font-family": c.mono, color: c.text, width: "label", height: "label", padding: "9px",
        shape: "round-rectangle", "background-color": c.bg, "border-width": 2, "border-color": c.data,
        "transition-property": "opacity", "transition-duration": "120ms",
      } },
      { selector: "node[kind = 'variable'], node[kind = 'parameter']", style: { shape: "ellipse", padding: "11px" } },
      { selector: "node[kind = 'function'], node[kind = 'method'], node[kind = 'class']", style: { "font-weight": 600 } },
      { selector: "node[kind = 'external']", style: { "border-style": "dashed", color: c.muted } },
      { selector: "node[influence = 'condition']", style: { "border-color": c.cond, "border-style": "dashed" } },
      { selector: "node[influence = 'caller']", style: { "border-color": c.muted } },
      { selector: "node[category = 'effect']", style: { "border-color": c.eff, "border-width": 3.5, color: c.eff, "font-weight": 600 } },
      { selector: "node[?isCenter]", style: { "border-color": c.source, "border-width": 4 } },
      { selector: "edge", style: {
        "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.9, width: 1.5,
        "line-color": c.muted, "target-arrow-color": c.muted, "line-style": "dashed", "line-dash-pattern": [6, 4],
        label: "", "font-size": 10, color: c.muted, "text-background-color": c.bg, "text-background-opacity": 1,
        "text-background-padding": "2px",
      } },
      { selector: "edge[kind = 'call']", style: { "line-style": "solid", width: 2 } },
      { selector: "edge[kind = 'control']", style: { "line-color": c.cond, "target-arrow-color": c.cond, "line-style": "dotted", width: 2 } },
      { selector: "edge.path", style: { width: 3.5, label: "data(label)" } },
      { selector: ".faded", style: { opacity: 0.18 } },
    ];
  }

  // A variable's scope is shown only when another visible variable has the same name.
  function labels(nodes) {
    const seen = new Map();
    nodes.forEach((n) => { if (n.kind === "variable" || n.kind === "parameter") seen.set(n.name, (seen.get(n.name) || 0) + 1); });
    return (n) => {
      switch (n.kind) {
        case "function": return `${n.name}()`;
        case "method": return `${n.scope}.${n.name}()`;
        case "attribute": return `${n.scope}.${n.name}`;
        case "variable":
        case "parameter": return seen.get(n.name) > 1 ? `${n.name}\n${n.scope === "<module>" ? "module" : n.scope}` : n.name;
        default: return n.name;
      }
    };
  }

  function direction() { return flow || (window.innerWidth < 600 ? "TB" : "LR"); }

  function render() {
    if (!payload) return;
    const { nodes, edges, center, strings } = payload;
    document.getElementById("title").textContent = strings.title;
    const note = document.getElementById("note");
    note.hidden = !strings.note;
    note.textContent = strings.note || "";

    const label = labels(nodes);
    if (!cy) {
      cy = cytoscape({ container: document.getElementById("graph"), style: styleSheet(), minZoom: 0.08, maxZoom: 3, boxSelectionEnabled: false });
      cy.on("tap", "node", (e) => {
        const n = e.target.data();
        if (n.line) vscode.postMessage({ type: "reveal", line: n.line });
      });
      cy.on("mouseover", "node", (e) => trace(e.target));
      cy.on("mouseout", "node", () => cy.elements().removeClass("faded path"));
    } else {
      cy.style(styleSheet());
    }
    cy.batch(() => {
      cy.elements().remove();
      cy.add([
        ...nodes.map((n) => ({ data: {
          id: n.id, label: label(n), kind: n.kind, influence: n.influence, category: n.category,
          isCenter: n.id === center, line: (n.where && n.where[0]) || (n.lines && n.lines[0]) || 0,
        } })),
        ...edges.map((e) => ({ data: { id: `${e.source}|${e.target}|${e.kind}`, source: e.source, target: e.target, kind: e.kind, label: strings["edge." + e.kind] || "" } })),
      ]);
    });
    const layout = cy.layout({ name: "dagre", rankDir: direction(), nodeSep: 22, rankSep: 56, edgeSep: 10, fit: false, animate: false });
    currentLayout = layout;
    layout.one("layoutstop", () => { if (layout === currentLayout) fit(); });
    layout.run();
  }

  // Fit, but keep text readable: stay at 0.6 and start at the center, as the web page does.
  function fit() {
    if (!cy || !cy.nodes().length) return;
    cy.fit(undefined, 30);
    if (cy.zoom() > 1.25) { cy.zoom(1.25); cy.center(); }
    if (cy.zoom() < 0.6) {
      cy.zoom(0.6);
      const c = cy.getElementById(payload.center);
      if (c.nonempty()) {
        const p = c.position();
        if (direction() === "LR") cy.pan({ x: 40 - p.x * 0.6, y: cy.height() / 2 - p.y * 0.6 });
        else cy.pan({ x: cy.width() / 2 - p.x * 0.6, y: 40 - p.y * 0.6 });
      }
    }
  }

  function trace(node) {
    const center = cy.getElementById(payload.center);
    let path = null;
    if (node.id() !== payload.center && center.nonempty()) {
      const upstream = node.data("influence") === "caller";
      const result = cy.elements().dijkstra({ root: upstream ? node : center, directed: true });
      path = result.pathTo(upstream ? center : node);
    }
    if (!path || path.length <= 1) path = node.closedNeighborhood();
    cy.batch(() => { cy.elements().addClass("faded"); path.removeClass("faded").addClass("path"); });
  }

  // Read-only handle for automated tests of this page.
  Object.defineProperty(window, "pyflowGraph", { value: { get cy() { return cy; } } });

  try { if (window.cytoscapeDagre) cytoscape.use(window.cytoscapeDagre); } catch (_) { /* already registered */ }
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "graph") { payload = event.data.payload; render(); }
  });
  // The button fits everything, even if the text gets small; automatic fitting keeps it readable.
  document.getElementById("fit").addEventListener("click", () => { if (cy) cy.fit(undefined, 30); });
  document.getElementById("flow").addEventListener("click", () => { flow = direction() === "LR" ? "TB" : "LR"; render(); });
  new MutationObserver(() => { if (cy) { cy.style(styleSheet()); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", () => { if (cy) { cy.resize(); fit(); } });
  vscode.postMessage({ type: "ready" });
})();
