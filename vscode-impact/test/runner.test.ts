// Runs the real bundled analyzer with a real Python, the way the extension does.
import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { probePython, runAnalyzer } from "../src/runner";

const analyzerDir = path.join(__dirname, "..", "..", "python");
const python = process.env.PYFLOW_TEST_PYTHON || "python3";
const opts = (line: number, character: number, includeConditions = true) =>
  ({ line, character, fileName: "t.py", includeConditions });

test("answers for the name at the cursor, from unsaved text", async () => {
  const source = "price = 3\ntotal = price * 2\nprint(total)\n";
  const out = await runAnalyzer(python, analyzerDir, source, opts(0, 2));
  assert.ok(out.ok, JSON.stringify(out));
  if (!out.ok) return;
  assert.equal(out.impact.center, "var:<module>:price");
  assert.deepEqual(out.impact.nodes.slice(1).map((n) => n.name).sort(), ["print", "total"]);
  assert.equal(out.impact.summary.effects, 1);
});

test("columns are UTF-16 even after Chinese text and emoji on the same line", async () => {
  const source = 'def f(x):\n    note = "高🙂" + str(x)\n    return note\n';
  const out = await runAnalyzer(python, analyzerDir, source, opts(0, 6));
  assert.ok(out.ok);
  if (!out.ok) return;
  const line = source.split("\n")[1];
  const tokens = out.impact.affected_refs.filter((r) => r.line === 2).map((r) => line.slice(r.col, r.end));
  assert.ok(tokens.includes("note") && tokens.includes("str"), tokens.join(","));
  // The cursor itself must be found by its UTF-16 position (the editor sends this, not a byte offset).
  const col = line.indexOf("x)") ;
  const again = await runAnalyzer(python, analyzerDir, source, opts(1, col));
  assert.ok(again.ok);
});

test("conditions can be switched off", async () => {
  const source = "def f(flag):\n    if flag:\n        y = 1\n    return 0\n";
  const on = await runAnalyzer(python, analyzerDir, source, opts(0, 6, true));
  const off = await runAnalyzer(python, analyzerDir, source, opts(0, 6, false));
  assert.ok(on.ok && off.ok);
  if (on.ok && off.ok) {
    assert.ok(on.impact.summary.total > 0 && on.impact.summary.by_condition > 0);
    assert.equal(off.impact.summary.total, 0);
  }
});

test("each failure has its own outcome", async () => {
  const nothing = await runAnalyzer(python, analyzerDir, "x = 1\n", opts(0, 3)); // between "=" and the number
  assert.deepEqual([nothing.ok, !nothing.ok && nothing.kind], [false, "nothing_here"]);
  const broken = await runAnalyzer(python, analyzerDir, "def f(:\n", opts(0, 5));
  assert.deepEqual([broken.ok, !broken.ok && broken.kind, !broken.ok && broken.line], [false, "syntax", 1]);
  const missing = await runAnalyzer("definitely-not-a-python", analyzerDir, "x = 1\n", opts(0, 0));
  assert.deepEqual([missing.ok, !missing.ok && missing.kind], [false, "no_python"]);
  const slow = await runAnalyzer(python, analyzerDir, "x = 1\n", opts(0, 0), 1);
  assert.equal(slow.ok, false); // 1 ms is not enough to start Python
});

test("probePython gives the full path of a working interpreter and null for a broken one", async () => {
  const found = await probePython(python);
  assert.ok(found && found.length > 0);
  assert.equal(await probePython("definitely-not-a-python"), null);
});
