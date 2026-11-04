// Runs the bundled Python analyzer as a child process. No `vscode` import, so tests can use it too.
import { spawn } from "child_process";
import { buildSpawn, CliOptions, parseOutput, RunOutcome } from "./core";

// The source goes in on stdin, so unsaved edits are analyzed exactly as they appear in the editor.
export function runAnalyzer(
  pythonPath: string, analyzerDir: string, source: string, options: CliOptions, timeoutMs = 20000,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const { command, args } = buildSpawn(pythonPath, analyzerDir, options);
    let settled = false;
    const done = (outcome: RunOutcome) => { if (!settled) { settled = true; clearTimeout(timer); resolve(outcome); } };

    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, kind: "timeout", message: `no answer after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e: NodeJS.ErrnoException) => {
      done({ ok: false, kind: e.code === "ENOENT" ? "no_python" : "crash", message: e.message });
    });
    child.on("close", (code) => {
      done(parseOutput(Buffer.concat(out).toString("utf8"), Buffer.concat(err).toString("utf8"), code));
    });
    child.stdin.on("error", () => { /* the process may exit before reading; "close" reports why */ });
    child.stdin.end(source, "utf8");
  });
}

// Asks a candidate interpreter for its own full path. Returns null when it cannot run, exits non-zero
// (the Windows Store stub exits with 49 and prints nothing), or is older than Python 3.10.
export function probePython(command: string, prefixArgs: string[] = [], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const code = "import sys; print(sys.executable if sys.version_info >= (3, 10) else '')";
    let out = "";
    let settled = false;
    const done = (value: string | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const child = spawn(command, [...prefixArgs, "-I", "-c", code], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done(null); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.on("error", () => done(null));
    child.on("close", (exit) => done(exit === 0 && out.trim() ? out.trim() : null));
  });
}
