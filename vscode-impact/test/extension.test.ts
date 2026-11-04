// The extension's command flow, run against a stand-in for the VS Code API and the real analyzer.
import assert from "node:assert/strict";
import Module = require("module");
import * as path from "node:path";
import test from "node:test";
import { createFake, makeEditor, Position, Uri } from "./fakeVscode";

const extensionPath = path.join(__dirname, "..", "..");

function setup(language = "en") {
  const fake = createFake(language);
  const load = (Module as any)._load;
  (Module as any)._load = function (request: string, ...rest: unknown[]) {
    return request === "vscode" ? fake.api : load.call(this, request, ...rest);
  };
  for (const key of Object.keys(require.cache)) if (key.includes(`${path.sep}out${path.sep}src${path.sep}`)) delete require.cache[key];
  const ext = require("../src/extension");
  (Module as any)._load = load;
  const context = { subscriptions: [] as unknown[], extensionPath, extensionUri: Uri.file(extensionPath) };
  ext.activate(context);
  return { fake, context };
}

const SOURCE = [
  "def total(price, qty):",
  "    if qty < 0:",
  "        return 0",
  "    amount = price * qty",
  "    print(amount)",
  "    return amount",
  "",
].join("\n");

test("registers its commands, view context and decoration types", () => {
  const { fake, context } = setup();
  assert.deepEqual([...fake.handlers.keys()].sort(), ["pyflow.clear", "pyflow.reveal", "pyflow.showGraph", "pyflow.showImpact"]);
  assert.ok(context.subscriptions.length >= 8);
  assert.ok(fake.state.hover && fake.state.tree);
});

test("marks the editor, fills the tree and status bar, and explains on hover", async () => {
  const { fake } = setup();
  const editor = makeEditor(SOURCE, 0, 10); // on "price"
  fake.state.active = editor; fake.state.visible = [editor];
  await fake.handlers.get("pyflow.showImpact")!();

  assert.deepEqual(fake.log.messages, []);
  assert.deepEqual(fake.log.contexts.at(-1), ["pyflow.hasResult", true]);
  const status = fake.state.status[0];
  assert.equal(status.visible, true);
  assert.match(status.text, /3 affected/);

  const painted = [...editor.decorations.values()];
  assert.equal(painted.length, 5, "all five decoration types are set");
  const nonEmpty = painted.filter((r) => r.length > 0).length;
  assert.ok(nonEmpty >= 4, `source, affected, effect and line marks expected, got ${nonEmpty}`);

  const roots = fake.state.tree.getChildren();
  assert.match(roots[0].text, /3 affected/);
  const groups = roots.slice(1);
  assert.ok(groups.length >= 2);
  const first = fake.state.tree.getChildren(groups[0])[0];
  const item = fake.state.tree.getTreeItem(first);
  assert.equal(item.command.command, "pyflow.reveal");
  assert.equal(item.command.arguments[1] > 0, true);
  assert.equal(fake.state.treeViews[0].title, "If total.price changes");

  // Hover on the place where the change arrives (the "amount" assignment on line 4).
  const hover = fake.state.hover.provideHover(editor.document, new Position(3, 5));
  assert.match(hover.contents.value, /total\.price → total\.amount/);
  // "qty" is not affected by price, so nothing is said about it.
  assert.equal(fake.state.hover.provideHover(editor.document, new Position(0, 18)), null);
});

test("clicking a tree item shows its line in the editor", async () => {
  const { fake } = setup();
  const editor = makeEditor(SOURCE, 0, 10);
  fake.state.active = editor; fake.state.visible = [editor];
  await fake.handlers.get("pyflow.showImpact")!();
  await fake.handlers.get("pyflow.reveal")!(editor.document.uri, 4);
  assert.equal(editor.revealed.at(-1)!.start.line, 3);
});

test("an edit clears the marks, because their positions are stale", async () => {
  const { fake } = setup();
  const editor = makeEditor(SOURCE, 0, 10);
  fake.state.active = editor; fake.state.visible = [editor];
  await fake.handlers.get("pyflow.showImpact")!();
  fake.events.change.fire({ document: editor.document, contentChanges: [{}] });
  assert.deepEqual(fake.log.contexts.at(-1), ["pyflow.hasResult", false]);
  assert.ok([...editor.decorations.values()].every((r) => r.length === 0));
  assert.equal(fake.state.status[0].visible, false);
  assert.match(fake.log.statusMessages.at(-1)!, /changed/);
  assert.equal(fake.state.hover.provideHover(editor.document, new Position(3, 5)), null);
});

test("each problem gets a message that says what to do", async () => {
  const run = async (text: string, line: number, ch: number, mutate?: (f: ReturnType<typeof setup>["fake"]) => void) => {
    const { fake } = setup();
    mutate?.(fake);
    const editor = makeEditor(text, line, ch);
    fake.state.active = editor; fake.state.visible = [editor];
    await fake.handlers.get("pyflow.showImpact")!();
    return fake.log.messages.at(-1);
  };
  assert.deepEqual(await run("x = 1\n", 0, 3), ["info", "Put the cursor on a variable or function name first."]);
  const syntax = await run("def f(:\n", 0, 5);
  assert.equal(syntax![0], "warn");
  assert.match(syntax![1], /syntax error on line 1/);
  const noPython = await run("x = 1\n", 0, 0, (f) => { f.config.pythonPath = "no-such-python-binary"; });
  assert.equal(noPython![0], "error");
  assert.match(noPython![1], /Could not start Python \(no-such-python-binary\)/);

  const { fake } = setup();
  const notPython = makeEditor("hello", 0, 0, "notes.txt");
  notPython.document.languageId = "plaintext";
  fake.state.active = notPython;
  await fake.handlers.get("pyflow.showImpact")!();
  assert.deepEqual(fake.log.messages.at(-1), ["info", "pyflow works on Python files."]);
});

test("the graph panel gets the result, can ask for a line, and is closed by clear", async () => {
  const { fake } = setup();
  const editor = makeEditor(SOURCE, 0, 10);
  fake.state.active = editor; fake.state.visible = [editor];
  await fake.handlers.get("pyflow.showGraph")!();
  assert.match(fake.log.messages.at(-1)![1], /Run "What changes/, "nothing to show before a result exists");

  await fake.handlers.get("pyflow.showImpact")!();
  await fake.handlers.get("pyflow.showGraph")!();
  const panel = fake.log.panels[0];
  assert.match(panel.webview.html, /script-src 'nonce-[0-9a-f]{32}'/);
  assert.match(panel.webview.html, /webview:.*media\/vendor\/cytoscape\.min\.js/);

  panel.send({ type: "ready" });
  const sent = fake.log.posted.at(-1);
  assert.equal(sent.type, "graph");
  assert.equal(sent.payload.center, "var:total:price");
  assert.ok(sent.payload.nodes.length >= 4 && sent.payload.strings.title.includes("If total.price changes"));

  panel.send({ type: "reveal", line: 5 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(editor.revealed.at(-1)!.start.line, 4);

  await fake.handlers.get("pyflow.clear")!();
  assert.equal(panel.disposed, true);
});

test("Chinese UI strings are used when VS Code runs in Chinese", async () => {
  const { fake } = setup("zh-tw");
  const editor = makeEditor(SOURCE, 0, 10);
  fake.state.active = editor; fake.state.visible = [editor];
  await fake.handlers.get("pyflow.showImpact")!();
  assert.match(fake.state.status[0].text, /處受影響/);
  assert.equal(fake.state.treeViews[0].title, "如果 total.price 改變");
});
