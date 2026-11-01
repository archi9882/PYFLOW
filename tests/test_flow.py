"""Details panel wording (web/flow.js): who passes what in, and where results go.

The logic is JavaScript, so these tests run it with Node through flow_runner.js.
They are skipped when Node is not installed.
"""

import json
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

from pyflow import analyze

NODE = shutil.which("node")
RUNNER = Path(__file__).with_name("flow_runner.js")

pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js is not installed")


def flow(source: str, *ids: str) -> dict:
    """Panel sections per node id, as {key: {text: lines}}."""
    graph = analyze(textwrap.dedent(source))
    assert graph["error"] is None, graph["error"]
    done = subprocess.run([NODE, str(RUNNER)], input=json.dumps({"graph": graph, "ids": list(ids)}),
                          capture_output=True, text=True, encoding="utf-8", check=True)
    out = json.loads(done.stdout)
    return {i: {key: dict((text, lines) for text, lines in items) for key, items in out[i].items()}
            for i in ids}


PIPELINE = """
    def load(text):
        return text.split()

    def clean(rows):
        kept = []
        for row in rows:
            kept.append(row)
        return kept

    def run(text):
        rows = load(text)
        rows = clean(rows)
        return rows
"""


def test_function_lists_caller_arguments_return_and_result():
    f = flow(PIPELINE, "fn:clean")["fn:clean"]
    assert f["d.calledBy"] == {"run": [13]}
    # The argument reaches the parameter, which has no direct edge to the function.
    assert f["d.args"] == {"f.argTo(param=rows, src=run.rows)": [13]}
    assert f["d.returns"] == {"clean.kept": [9]}
    assert f["d.resultTo"] == {"run.rows": [13]}
    assert f["d.calls"] == {"kept.append": [8]}


def test_variable_says_which_call_returned_it_and_which_parameter_takes_it():
    v = flow(PIPELINE, "var:run:rows")["var:run:rows"]
    assert v["d.in"] == {"f.returned(fn=load)": [12], "f.returned(fn=clean)": [13]}
    assert v["d.out"] == {"f.paramOf(fn=clean, param=rows)": [13], "f.retOf(fn=run)": [14]}


NESTED = """
    def bar():
        return 1

    def foo(x):
        return x

    def main():
        y = foo(bar())
        print(bar())
        return bar()
"""


def test_result_edge_is_worded_by_where_it_lands():
    # One edge kind, three meanings: argument, argument to an external call, return value.
    bar = flow(NESTED, "fn:bar")["fn:bar"]
    assert bar["d.resultTo"] == {
        "f.paramOf(fn=foo, param=x)": [9],
        "f.extArg(fn=print)": [10],
        "f.retOf(fn=main)": [11],
    }


def test_nested_call_result_is_an_argument_not_a_return():
    out = flow(NESTED, "fn:foo", "fn:main", "ext:print")
    assert out["fn:foo"]["d.args"] == {"f.argTo(param=x, src=f.returned(fn=bar))": [9]}
    assert out["fn:main"]["d.returns"] == {"f.returned(fn=bar)": [11]}
    assert out["ext:print"]["d.args"] == {"f.returned(fn=bar)": [10]}
    assert "d.returns" not in out["ext:print"]


def test_repeated_calls_merge_into_one_item_with_all_lines():
    bar = flow(NESTED, "fn:bar")["fn:bar"]
    assert bar["d.calledBy"] == {"main": [9, 10, 11]}


def test_dataclass_fields_count_as_constructor_arguments():
    f = flow("""
        from dataclasses import dataclass

        @dataclass
        class Point:
            x: float
            y: float

        def make(a, b):
            return Point(a, b)
    """, "fn:Point")["fn:Point"]
    assert f["d.args"] == {"f.argTo(param=x, src=make.a)": [10], "f.argTo(param=y, src=make.b)": [10]}


def test_function_lists_its_locals_even_when_nothing_flows_through_them():
    # `y = 100` has no edges at all, so the graph cannot show it next to run();
    # the panel still lists it, together with the parameter, in source order.
    f = flow("""
        def load(text):
            return text

        def run(text):
            rows = load(text)
            y = 100
            return rows
    """, "fn:run")["fn:run"]
    assert list(f["d.locals"]) == ["text", "rows", "y"]
    assert f["d.locals"]["y"] == [7]


def test_external_calls_have_no_locals():
    out = flow(NESTED, "ext:print")["ext:print"]
    assert "d.locals" not in out


def test_attribute_assigned_from_a_call_is_not_called_a_parameter():
    f = flow("""
        def make():
            return []

        class Box:
            def __init__(self):
                self.items = make()
    """, "fn:make")["fn:make"]
    assert f["d.resultTo"] == {"Box.items": [7]}
