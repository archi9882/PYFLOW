"""Download the front-end libraries once, so the site runs without any CDN.

Each package is fetched from the npm registry at a pinned version, checked
against the registry's published sha512 integrity hash, and only the files
the page needs are extracted. Downloads are cached in ``.vendor-cache/``.

Usage:
    python scripts/vendor.py OUT_DIR      # copy vendored files into OUT_DIR
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".vendor-cache"

# package, version, {path inside the npm tarball: path under the vendor dir}
PACKAGES = [
    ("pyodide", "0.26.4", {
        "pyodide.js": "pyodide/pyodide.js",
        "pyodide.asm.js": "pyodide/pyodide.asm.js",
        "pyodide.asm.wasm": "pyodide/pyodide.asm.wasm",
        "python_stdlib.zip": "pyodide/python_stdlib.zip",
        "pyodide-lock.json": "pyodide/pyodide-lock.json",
    }),
    ("cytoscape", "3.30.2", {"dist/cytoscape.min.js": "cytoscape.min.js"}),
    ("dagre", "0.8.5", {"dist/dagre.min.js": "dagre.min.js"}),
    ("cytoscape-dagre", "2.5.0", {"cytoscape-dagre.js": "cytoscape-dagre.js"}),
    ("@fontsource/ibm-plex-sans", "5.1.1", {
        f"files/ibm-plex-sans-latin-{w}-normal.woff2": f"fonts/ibm-plex-sans-{w}.woff2" for w in (400, 600)
    }),
    ("@fontsource/ibm-plex-mono", "5.1.1", {
        f"files/ibm-plex-mono-latin-{w}-normal.woff2": f"fonts/ibm-plex-mono-{w}.woff2" for w in (400, 600)
    }),
]


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return resp.read()


def _tarball(name: str, version: str) -> bytes:
    """Return the package tarball, downloading and verifying it on first use."""
    cached = CACHE / f"{name.replace('/', '__')}-{version}.tgz"
    if cached.exists():
        return cached.read_bytes()
    meta = json.loads(_fetch(f"https://registry.npmjs.org/{name}/{version}"))
    data = _fetch(meta["dist"]["tarball"])
    algo, expected = meta["dist"]["integrity"].split("-", 1)
    actual = base64.b64encode(hashlib.new(algo, data).digest()).decode()
    if actual != expected:
        raise RuntimeError(f"integrity check failed for {name}@{version}")
    CACHE.mkdir(exist_ok=True)
    cached.write_bytes(data)
    return data


def vendor(out: Path) -> None:
    """Extract every needed library file into ``out``."""
    for name, version, files in PACKAGES:
        print(f"  {name}@{version}")
        with tarfile.open(fileobj=io.BytesIO(_tarball(name, version)), mode="r:gz") as tar:
            for inner, dest in files.items():
                member = tar.extractfile(f"package/{inner}")  # npm tarballs nest files under package/
                if member is None:
                    raise FileNotFoundError(f"{inner} not found in {name}@{version}")
                target = out / dest
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(member.read())


if __name__ == "__main__":
    vendor(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site" / "vendor")
