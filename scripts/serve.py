"""Build the site and serve it locally: ``python scripts/serve.py [--port 8000] [--no-open]``.

The first run downloads the libraries (about 14 MB, cached afterwards);
after that the demo works offline.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_site import ROOT, build  # noqa: E402


class Handler(http.server.SimpleHTTPRequestHandler):
    # Correct types matter: Pyodide streams .wasm only when served as application/wasm.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".woff2": "font/woff2",
        ".py": "text/plain; charset=utf-8",
    }

    def log_message(self, *args) -> None:  # keep the terminal quiet
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and serve the pyflow demo locally.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true", help="do not open a browser window")
    args = parser.parse_args()

    site = ROOT / "_site"
    build(site)
    handler = functools.partial(Handler, directory=str(site))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"pyflow is running at {url}  (Ctrl+C to stop)")
    if not args.no_open:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
