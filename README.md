# pyflow

[繁體中文](README.zh-TW.md)

Drop a Python file into the page, type a variable or function name, and see
where its values come from and where they go.

**Live demo:** https://archi9882.github.io/SciML/

- Runs entirely in your browser. Your file is never uploaded.
- Nothing to install: the analyzer is plain Python, run by [Pyodide](https://pyodide.org).
- Works on any `.py` file: scripts, function modules, classes, data pipelines.

## Run it locally

```bash
cd pyflow
python scripts/serve.py
```

This builds the site, downloads the libraries it needs once (about 14 MB,
checked against the npm registry's published hashes and cached in
`.vendor-cache/`), serves it at http://127.0.0.1:8000 and opens your browser.
After the first run it works offline. Requires Python 3.10+; no other packages.

## How to use

1. Open the demo and drop a `.py` file on the page (or pick an example).
2. You first see the whole-file call graph: which function calls which.
3. Type in the search box. Candidates appear as you type, each with its
   scope, so `data` in `load()` and `data` in `main()` are separate entries.
4. Pick one. The graph flows left to right:
   - **orange, left**: upstream, where the value comes from
   - **blue, middle**: the name you picked
   - **green, right**: downstream, where the value goes
5. Click any node to make it the new center. Adjust **Depth**, **Direction**
   and the **Calls / Data flow / External calls** filters in the sidebar.

Also on the page:

- **Hover** a node to trace the exact path between it and the center.
- **Click a line** in the source panel to jump to the names defined or used there.
- Lines involved in the current view are marked in the source panel.
- Methods and attributes of a class are drawn inside a class box when the
  layout allows it; large files fold methods into their class in the overview.
- Press <kbd>/</kbd> to jump to the search box. English and Traditional Chinese, light and dark.

## What the graph shows

| Edge | Meaning | Example |
|---|---|---|
| calls | function A calls function B | `def main(): load()` |
| (assign) | a value flows into a variable | `total = price * qty` |
| arg | a value is passed into a parameter or external call | `clean(rows)` |
| return | a variable is returned | `return result` |
| result | a function's return value is used | `rows = load(path)` |

Supported in this version:

- assignments, augmented assignments (`+=`), annotated assignments
- function parameters, default values, return values, call arguments (positional and keyword)
- tuple unpacking (`a, b = x, y` is paired element by element), `for` loop variables
- comprehensions, lambdas, `with ... as`, `except ... as`, the walrus operator
- methods called through `self`, through the class, or through an instance
  created in the same scope (`cart = Cart(); cart.add(...)`) or annotated (`p: Product`)
- inherited methods and `super().method()` for base classes defined in the same file
- attributes: `self.x = ...` in one method flows to `self.x` read in another;
  dataclass fields are the same attributes (`Product(name, price)` fills `Product.price`)
- containers filled in place: `items.append(x)`, `d.update(...)`, `d[k] = x`
- reads of module-level and enclosing-function variables
- calls into libraries and builtins (shown as dashed "external" nodes)

## Limits (read this before trusting the graph)

pyflow reads code; it does not run it. Anything decided at run time can be
missed. Rather than skipping such code silently, pyflow lists it in the
**Not analyzed** panel and outlines affected nodes with a red dashed border:

| Reported as | Why it cannot be followed statically |
|---|---|
| `*args` / `**kwargs` | which argument lands where is only known at run time |
| Decorator | a decorator can replace the function or change its signature |
| Dynamic call (`getattr`, `exec`, `eval`, ...) | the target is computed at run time |
| `global` / `nonlocal` rebinding | writes are linked, but other writers may exist |
| `match` / `case` | pattern captures are not tracked yet |
| `from x import *` | the imported names are unknown |

Other simplifications to keep in mind:

- **One file at a time.** Imports from your other files are treated as external calls.
- **Context-insensitive.** If `f` is called from two places, a value passed in
  at one call site appears to reach the result of both.
- **One node per attribute, not per object.** Two `Cart` objects share the node `Cart.items`.
- **No aliasing.** `b = a; b.append(x)` does not mark `a` as changed.
- **Control flow is not data flow.** `if x > 0: y = 1` does not draw `x -> y`.
- Base classes from other files (or libraries) are not followed.

## Command line

The analyzer also works without the browser:

```bash
cd pyflow
pip install -e .
pyflow examples/pure_functions.py              # summary + unsupported list
pyflow examples/pure_functions.py -q tokens    # upstream / downstream of a name
pyflow examples/pure_functions.py --json       # full graph as JSON
```

Or from Python:

```python
from pyflow import analyze, search, subgraph

graph = analyze(open("my_script.py").read())
hit = search(graph, "total")[0]
view = subgraph(graph, hit["id"], depth=2, direction="both")
```

## Development

```bash
cd pyflow
pip install pytest
python -m pytest                       # analyzer, search and CLI tests
python scripts/build_site.py           # assemble the self-contained site into _site/
python scripts/serve.py --no-open      # serve it at http://127.0.0.1:8000
```

Project layout:

```
pyflow/
  core/pyflow/     analyzer (ast -> graph), search / neighborhood queries, CLI, Pyodide bridge
  tests/           pytest suite: one small snippet per language feature
  web/             index.html, app.js, style.css (Cytoscape.js + dagre layout)
  examples/        demo files in four styles: script, pure functions, classes, pipeline
  scripts/         vendor.py (pinned, hash-checked libraries), build_site.py, serve.py
  docs/            design notes
```

The GitHub Actions workflow `.github/workflows/pyflow.yml` runs the tests on
Python 3.10, 3.12 and 3.13 and publishes the site to GitHub Pages from `main`.

## License

[MIT](LICENSE)
