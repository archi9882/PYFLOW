"""JSON-in / JSON-out bridge used by the web page through Pyodide.

The last analyzed graph is kept in module state so the browser does not
have to send it back on every keystroke.
"""

from __future__ import annotations

import json

from .analyzer import analyze
from .graph import overview, search, subgraph

_state: dict = {"graph": None}


def load(source: str, filename: str) -> str:
    """Analyze a file, remember the graph and return it as JSON."""
    _state["graph"] = analyze(source, filename)
    return json.dumps(_state["graph"])


def find(query: str, limit: int = 20) -> str:
    """Search candidates for the search box."""
    if _state["graph"] is None:
        return "[]"
    return json.dumps(search(_state["graph"], query, limit))


def neighborhood(center: str, depth: int, direction: str, families: str) -> str:
    """Subgraph around ``center``; ``families`` is a comma list such as "call,data"."""
    fams = tuple(f for f in families.split(",") if f)
    return json.dumps(subgraph(_state["graph"], center, int(depth), direction, fams))


def whole_file() -> str:
    """Call-graph overview shown right after a file is loaded."""
    return json.dumps(overview(_state["graph"]))


def highlight(source: str) -> str:
    """Syntax classes for the source panel as ``[[line, start_col, end_col, cls], ...]``.

    Uses Python's own tokenizer, so colouring matches how Python reads the
    file. Multi-line tokens (docstrings) are split per line. On a syntax
    error the tokens read so far are returned.
    """
    import builtins
    import io
    import keyword
    import token
    import tokenize

    lines = source.splitlines()
    builtin_names = set(dir(builtins))
    spans: list[list] = []
    prev = None

    def add(tok, cls):
        (srow, scol), (erow, ecol) = tok.start, tok.end
        for row in range(srow, erow + 1):
            start = scol if row == srow else 0
            end = ecol if row == erow else len(lines[row - 1]) if row - 1 < len(lines) else 0
            if end > start:
                spans.append([row, start, end, cls])

    string_types = {token.STRING} | {getattr(token, n) for n in ("FSTRING_START", "FSTRING_MIDDLE", "FSTRING_END") if hasattr(token, n)}
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            cls = None
            if tok.type == token.NAME:
                if keyword.iskeyword(tok.string):  # soft keywords (match, _, type) are often plain names
                    cls = "kw"
                elif prev is not None and prev.type == token.NAME and prev.string in ("def", "class"):
                    cls = "def"
                elif tok.string in ("self", "cls"):
                    cls = "self"
                elif tok.string in builtin_names:
                    cls = "builtin"
            elif tok.type in string_types:
                cls = "str"
            elif tok.type == token.NUMBER:
                cls = "num"
            elif tok.type == token.COMMENT:
                cls = "com"
            elif tok.type == token.OP and tok.string == "@" and (prev is None or prev.type in (token.NEWLINE, token.NL, token.INDENT, token.DEDENT)):
                cls = "deco"
            if cls:
                add(tok, cls)
            if tok.type not in (token.NL, token.COMMENT):
                prev = tok
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return json.dumps(spans)
