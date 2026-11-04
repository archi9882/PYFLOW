// Copies what the extension ships with into place:
//   python/pyflow/   the analyzer, from ../core/pyflow (so there is one copy of the code)
//   media/vendor/    Cytoscape and dagre for the graph, fetched and hash-checked by ../scripts/vendor.py
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

const python = process.platform === "win32" ? "python" : "python3";
execFileSync(python, [join(root, "..", "scripts", "vendor.py"), join(root, "media", "vendor"),
  "--only", "cytoscape", "dagre", "cytoscape-dagre"], { stdio: "inherit" });
console.log("graph libraries ready in media/vendor");
