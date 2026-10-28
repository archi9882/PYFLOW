# pyflow

[繁體中文](README.zh-TW.md)

Drop a Python file into the page, type a variable or function name, and see
where its values come from and where they go.

**Live demo:** https://archi9882.github.io/Hackthon/

- Runs entirely in your browser. Your file is never uploaded.
- Nothing to install: the analyzer is plain Python, run by [Pyodide](https://pyodide.org).
- Works on any `.py` file: scripts, function modules, classes, data pipelines.

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
   and the **Calls / Data flow** filters in the sidebar.

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
- dataclass-style constructors (`Product(name, price)` maps onto the annotated fields)
- reads of module-level and enclosing-function variables
- calls into libraries and builtins (shown as dashed "external" nodes)

## Limits (read this before trusting the graph)

pyflow reads code; it does not run it. Anything decided at run time can be
missed. Rather than skipping such code silently, pyflow lists it in the
**Not analyzed** panel and outlines affected nodes with a red dashed border:

| Reported as | Why it cannot be followed statically |
|---|---|
| Object attribute (`self.x`) | values stored on objects can be changed from anywhere |
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
- **No aliasing.** `b = a; b.append(x)` does not mark `a` as changed.
- **Control flow is not data flow.** `if x > 0: y = 1` does not draw `x -> y`.
- Inheritance is not followed when resolving methods.

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
python scripts/build_site.py           # assemble the static site into _site/
python -m http.server -d _site 8000    # preview at http://localhost:8000
```

Project layout:

```
pyflow/
  core/pyflow/     analyzer (ast -> graph), search / neighborhood queries, CLI, Pyodide bridge
  tests/           pytest suite: one small snippet per language feature
  web/             index.html, app.js, style.css (Cytoscape.js + dagre layout)
  examples/        demo files in four styles: script, pure functions, classes, pipeline
  scripts/         build_site.py for GitHub Pages
  docs/            design notes
```

The GitHub Actions workflow `.github/workflows/pyflow.yml` runs the tests on
Python 3.10, 3.12 and 3.13 and publishes the site to GitHub Pages from `main`.

## License

[MIT](LICENSE)
