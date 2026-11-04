"""What changes if X changes: one small program per rule, with the answer labelled by hand.

Each expected set below was worked out by reading the program, not by running
pyflow, so these tests are the accuracy benchmark for the impact feature.
"""

import json
import textwrap

import pytest

from pyflow import analyze, impact, locate, search


def short(node_id: str) -> str:
    """``var:main:x`` -> ``main.x``, ``var:<module>:x`` -> ``x``, ``fn:f`` -> ``f()``."""
    kind, _, rest = node_id.partition(":")
    if kind == "fn":
        return rest + "()"
    if kind == "ext":
        return rest
    return rest.replace("<module>:", "").replace(":", ".")


def run(source: str, center: str, **options):
    """Impact of the node whose short name is ``center``."""
    graph = analyze(textwrap.dedent(source))
    assert graph["error"] is None, graph["error"]
    ids = {short(n["id"]): n["id"] for n in graph["nodes"]}
    return graph, impact(graph, ids[center], **options)


def affected(source: str, center: str, **options) -> set[str]:
    _, result = run(source, center, **options)
    return {short(n["id"]) for n in result["nodes"][1:]}


# ----- plain data flow ---------------------------------------------------------------

def test_follows_a_chain_and_leaves_unrelated_names_alone():
    assert affected("""
        a = 1
        b = a + 1
        c = b * 2
        d = 5
        e = d + 1
    """, "a") == {"b", "c"}


def test_flows_through_function_parameters_and_back_to_the_caller():
    assert affected("""
        def f(x):
            y = x + 1
            return y
        a = 3
        r = f(a)
        s = 10
    """, "a") == {"f.x", "f.y", "f()", "r"}


def test_only_the_changed_argument_reaches_its_parameter():
    assert affected("""
        def f(p, q):
            return p
        a = 1
        b = 2
        r = f(a, b)
    """, "b") == {"f.q"}


def test_keyword_arguments_and_defaults():
    assert affected("""
        BASE = 10
        def f(x, scale=BASE):
            return x * scale
        r = f(1, scale=2)
    """, "BASE") == {"f.scale", "f()", "r"}


def test_same_name_in_two_functions_stays_separate():
    assert affected("""
        def f(v):
            x = v
            return x
        def g(v):
            x = v
            return x
    """, "f.v") == {"f.x", "f()"}


def test_tuple_unpacking_pairs_elements_when_shapes_match():
    assert affected("""
        x = 1
        y = 2
        a, b = x, y
    """, "x") == {"a"}


def test_unpacking_a_call_result_reaches_every_target():
    assert affected("""
        def pair(v):
            return v, 0
        n = 1
        a, b = pair(n)
    """, "n") == {"pair.v", "pair()", "a", "b"}


def test_augmented_assignment_and_loops():
    assert affected("""
        items = [1, 2]
        total = 0
        for item in items:
            total += item
    """, "items") == {"item", "total"}


def test_comprehension_and_lambda_names_do_not_leak():
    assert affected("""
        k = 2
        data = [1, 2]
        out = [v * k for v in data]
        fn = lambda v: v + k
    """, "k") == {"out", "fn"}


def test_closure_and_global_reads():
    assert affected("""
        LIMIT = 10
        def outer():
            base = 1
            def inner():
                return base + LIMIT
            return inner()
    """, "LIMIT") == {"outer.inner()", "outer()"}


def test_walrus_and_with_targets():
    assert affected("""
        raw = "data"
        if (n := len(raw)) > 3:
            pass
        with open(raw) as fh:
            text = fh.read()
    """, "raw") == {"n", "len", "open", "fh", "fh.read", "text"}


def test_recursion_terminates():
    assert affected("""
        def f(n):
            return f(n - 1) + n
        r = f(5)
    """, "f.n") == {"f()", "r"}


# ----- containers, attributes, classes -----------------------------------------------

def test_values_put_into_a_container_change_it():
    assert affected("""
        rows = []
        lookup = {}
        v = 1
        rows.append(v)
        lookup["k"] = v
    """, "v") == {"rows", "lookup", "rows.append"}


def test_attributes_connect_methods():
    assert affected("""
        class Cart:
            def __init__(self, rate):
                self.rate = rate
            def total(self, base):
                return base * self.rate
    """, "Cart.__init__.rate") == {"Cart.rate", "Cart.total()"}


def test_changing_an_attribute_reaches_every_reader():
    assert affected("""
        class A:
            def set(self, v):
                self.v = v
            def get(self):
                return self.v
            def twice(self):
                w = self.v * 2
                return w
    """, "A.v") == {"A.get()", "A.twice.w", "A.twice()"}


def test_dataclass_fields_and_instances():
    assert affected("""
        from dataclasses import dataclass
        @dataclass
        class P:
            name: str
            price: float
        cost = 3.0
        p = P("pen", cost)
        shown = p.price
    """, "cost") == {"P.price", "p", "shown"}


def test_inherited_attribute_and_method():
    assert affected("""
        class Base:
            def __init__(self, size):
                self.size = size
            def describe(self):
                return self.size
        class Child(Base):
            def show(self):
                return self.describe()
        n = 1
        c = Child(n)
    """, "n") == {"Base.__init__.size", "Base.size", "Base.describe()", "Child.show()", "c"}


# ----- conditions ----------------------------------------------------------------------

BRANCH = """
    def f(x):
        if x > 3:
            y = 1
        else:
            y = 2
        return y
"""


def test_a_condition_changes_what_its_branches_assign():
    got = affected(BRANCH, "f.x")
    assert got == {"f.y", "f()"}


def test_conditions_are_marked_and_can_be_switched_off():
    _, result = run(BRANCH, "f.x")
    assert {n["influence"] for n in result["nodes"][1:]} == {"condition"}
    assert result["summary"]["by_condition"] == 2
    assert affected(BRANCH, "f.x", control=False) == set()


def test_a_pure_data_path_wins_over_a_condition():
    _, result = run("""
        def f(x):
            if x:
                y = x
            return 0
    """, "f.x")
    y = next(n for n in result["nodes"] if n["id"] == "var:f:y")
    assert y["influence"] == "data"


def test_guard_clause_governs_the_rest_of_the_function():
    assert affected("""
        def price(qty, rate):
            if qty < 0:
                return 0
            total = qty * rate
            return total
    """, "price.qty") == {"price()", "price.total"}


def test_guard_does_not_leak_out_of_its_function():
    assert affected("""
        def check(x):
            if x:
                return 1
            return 2
        other = 5
        y = other + 1
    """, "check.x") == {"check()"}


def test_loop_body_depends_on_what_is_iterated():
    assert affected("""
        def count(items):
            n = 0
            for _ in items:
                n = n + 1
            return n
    """, "count.items") == {"count._", "count.n", "count()"}


def test_calls_inside_a_branch_depend_on_the_condition():
    got = affected("""
        def run(flag, msg):
            if flag:
                print(msg)
    """, "run.flag")
    assert got == {"print"}


def test_a_function_defined_in_a_branch_is_not_guarded_by_it():
    assert affected("""
        mode = 1
        if mode:
            def helper(v):
                w = v + 1
                return w
    """, "mode") == set()


# ----- sinks and effects ----------------------------------------------------------------

def test_external_calls_receive_values_but_never_connect_unrelated_ones():
    assert affected("""
        a = 1
        b = 2
        print(a)
        print(b)
    """, "a") == {"print"}


def test_effects_are_told_apart_from_plain_library_calls():
    _, result = run("""
        v = [1, 2]
        n = len(v)
        print(n)
        out = open("f", "w")
        out.write(str(v))
    """, "v")
    by_cat = {}
    for n in result["nodes"][1:]:
        by_cat.setdefault(n["category"], set()).add(short(n["id"]))
    assert {"print", "out.write"} <= by_cat["effect"]
    assert {"len", "str"} <= by_cat["external"]


def test_changing_a_function_changes_its_callers():
    got = affected("""
        def helper(v):
            return v
        def mid():
            return helper(1)
        def top():
            return mid()
        def unrelated():
            return 0
    """, "helper()")
    assert {"mid()", "top()"} <= got and "unrelated()" not in got


# ----- limits and warnings --------------------------------------------------------------

def test_depth_limits_the_reach():
    _, near = run("a = 1\nb = a\nc = b\nd = c\n", "a", depth=2)
    assert {short(n["id"]) for n in near["nodes"][1:]} == {"b", "c"}
    assert near["truncated"] is True
    _, full = run("a = 1\nb = a\nc = b\nd = c\n", "a")
    assert {short(n["id"]) for n in full["nodes"][1:]} == {"b", "c", "d"}
    assert full["truncated"] is False


def test_max_nodes_keeps_the_nearest_ones():
    _, result = run("a = 1\nb = a\nc = b\nd = c\ne = d\n", "a", max_nodes=2)
    assert {short(n["id"]) for n in result["nodes"][1:]} == {"b", "c"}
    assert result["truncated"] is True
    # Counts describe everything even though only the nearest are drawn.
    assert result["summary"]["total"] == 4 and result["summary"]["shown"] == 2
    assert len(result["lines"]) == 4


def test_unsupported_spots_in_touched_scopes_are_reported():
    _, result = run("""
        def f(x, *rest):
            y = getattr(x, "name")
            return y
        r = f(1)
    """, "f.x")
    kinds = {w["kind"] for w in result["warnings"]}
    assert {"star_args", "dynamic"} <= kinds


def test_quiet_when_nothing_is_unsupported():
    _, result = run("a = 1\nb = a\n", "a")
    assert result["warnings"] == []


def test_nothing_depends_on_a_dead_end():
    assert affected("a = 1\nb = 2\n", "a") == set()


# ----- positions for editors -------------------------------------------------------------

def test_token_positions_use_utf16_columns_even_after_chinese_and_emoji():
    source = textwrap.dedent('''\
        def f(x):
            label = "高🙂" + str(x)
            return label
    ''')
    graph = analyze(source)
    result = impact(graph, "var:f:x")
    line = source.split("\n")[1]
    tokens = {line.encode("utf-16-le")[r["col"] * 2:r["end"] * 2].decode("utf-16-le") for r in result["affected_refs"] if r["line"] == 2}
    assert "label" in tokens and "str" in tokens


def test_only_places_where_the_change_arrives_are_marked():
    graph = analyze(textwrap.dedent("""\
        total = 0
        step = 2
        total = 10
        total = total + step
    """))
    result = impact(graph, "var:<module>:step")
    assert {r["line"] for r in result["affected_refs"]} == {4}  # not the earlier assignments of total


def test_locate_finds_the_name_under_the_cursor():
    source = "def f(price):\n    cost = price * 2\n    return cost\n"
    graph = analyze(source)
    col = source.split("\n")[1].index("price")
    assert [n["id"] for n in locate(graph, 2, col + 2)] == ["var:f:price"]       # inside the word
    assert [n["id"] for n in locate(graph, 2, col + 5)] == ["var:f:price"]       # just after it
    assert [n["id"] for n in locate(graph, 1, 5)] == ["fn:f"]                     # a definition
    assert locate(graph, 2, 0) == []                                              # whitespace


def test_locate_uses_attribute_tokens():
    source = "class A:\n    def __init__(self, v):\n        self.v = v\n    def get(self):\n        return self.v\n"
    graph = analyze(source)
    assert [n["id"] for n in locate(graph, 5, source.split("\n")[4].index(".v") + 2)] == ["var:A:v"]


def test_impact_result_is_plain_json():
    _, result = run("a = 1\nb = a\nprint(b)\n", "a")
    json.dumps(result)


def test_search_still_finds_what_impact_needs():
    graph = analyze("def f(total):\n    return total\n")
    assert search(graph, "total")[0]["id"] == "var:f:total"


@pytest.mark.parametrize("source", ["", "x = 1\n", "def f(:\n"])
def test_degenerate_inputs_do_not_crash(source):
    graph = analyze(source)
    if graph["error"] is None and graph["nodes"]:
        impact(graph, graph["nodes"][0]["id"])
