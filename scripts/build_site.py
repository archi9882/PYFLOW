"""Assemble the static site for GitHub Pages into ``_site/``.

Layout of the output:
    _site/index.html, app.js, style.css    (from web/)
    _site/py/pyflow/*.py                   (the analyzer, loaded by Pyodide)
    _site/examples/*.py + index.json       (one-click demo files)

Usage:
    python scripts/build_site.py              # build into _site/
    python -m http.server -d _site 8000       # preview at http://localhost:8000
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)

    # The analyzer package, minus caches; the web page fetches these by name.
    pkg_out = out / "py" / "pyflow"
    pkg_out.mkdir(parents=True)
    for src in sorted((ROOT / "core" / "pyflow").glob("*.py")):
        shutil.copy2(src, pkg_out / src.name)

    examples = sorted(p.name for p in (ROOT / "examples").glob("*.py"))
    ex_out = out / "examples"
    ex_out.mkdir()
    for name in examples:
        shutil.copy2(ROOT / "examples" / name, ex_out / name)
    (ex_out / "index.json").write_text(json.dumps(examples), encoding="utf-8")

    # GitHub Pages runs Jekyll by default, which skips some files; turn it off.
    (out / ".nojekyll").write_text("", encoding="utf-8")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    build(target)
    print(f"Site built in {target}")
