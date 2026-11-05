// Copies what the extension ships with into place:
//   python/pyflow/   the analyzer, from ../core/pyflow (so there is one copy of the code)
//   site/            the full web page (same build as the site, libraries included), for the "full view"
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const core = join(root, "..", "core", "pyflow");

const target = join(root, "python", "pyflow");
rmSync(join(root, "python"), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const f of readdirSync(core)) {
  if (f.endsWith(".py")) cpSync(join(core, f), join(target, f));
}
console.log("analyzer copied to python/pyflow");

// PYFLOW_PYTHON overrides; on Windows plain `python` may be the Store stub, so use the launcher.
const python = process.env.PYFLOW_PYTHON || (process.platform === "win32" ? "py" : "python3");
const py = (script, ...args) => execFileSync(python, [...(python === "py" ? ["-3"] : []), script, ...args], { stdio: "inherit" });
py(join(root, "..", "scripts", "build_site.py"), join(root, "site"));
console.log("full web page ready in site/");
