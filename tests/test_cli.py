"""Command line interface."""

import json

from pyflow.cli import main


def write(tmp_path, text):
    path = tmp_path / "sample.py"
    path.write_text(text, encoding="utf-8")
    return str(path)


def test_summary(tmp_path, capsys):
    assert main([write(tmp_path, "def f(x):\n    return x\n")]) == 0
    assert "1 functions/classes" in capsys.readouterr().out


def test_query_prints_neighborhood(tmp_path, capsys):
    path = write(tmp_path, "a = 1\nb = a + 1\nprint(b)\n")
    assert main([path, "-q", "b"]) == 0
    out = capsys.readouterr().out
    assert "Center: b" in out and "a (variable" in out and "print (external)" in out


def test_query_without_match(tmp_path, capsys):
    assert main([write(tmp_path, "a = 1\n"), "-q", "zzz"]) == 1


def test_json_output(tmp_path, capsys):
    assert main([write(tmp_path, "a = 1\n"), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["nodes"]


def test_syntax_error_exit_code(tmp_path, capsys):
    assert main([write(tmp_path, "def (:\n")]) == 2


IMPACT_SOURCE = "price = 3\ntotal = price * 2\nprint(total)\n"


def test_impact_report_lists_what_changes_and_why(tmp_path, capsys):
    assert main([write(tmp_path, IMPACT_SOURCE), "-q", "price", "--impact"]) == 0
    out = capsys.readouterr().out
    assert "If price changes" in out and "2 things are affected" in out
    assert "total" in out and "print" in out and "via price -> total -> print" in out


def test_impact_at_a_position_uses_editor_columns(tmp_path, capsys):
    # Line 2, column 9 (1-based) is inside "price" in "total = price * 2".
    assert main([write(tmp_path, IMPACT_SOURCE), "--at", "2:10", "--impact", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["center"] == "var:<module>:price"
    assert [n["name"] for n in data["nodes"][1:]] == ["total", "print"]


def test_impact_reads_unsaved_text_from_stdin(tmp_path, capsys, monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO('x = 1\ny = "高🙂" + str(x)\n'.encode("utf-8"))))
    assert main(["buffer.py", "--stdin", "--at", "1:1", "--impact", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    line = 'y = "高🙂" + str(x)'
    marked = {line.encode("utf-16-le")[r["col"] * 2:r["end"] * 2].decode("utf-16-le") for r in data["affected_refs"] if r["line"] == 2}
    assert {"y", "str"} <= marked


def test_impact_without_conditions(tmp_path, capsys):
    source = "def f(flag):\n    if flag:\n        y = 1\n    return 0\n"
    assert main([write(tmp_path, source), "-q", "flag", "--impact", "--no-control", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["summary"]["total"] == 0


def test_json_errors_are_machine_readable(tmp_path, capsys):
    assert main([write(tmp_path, "x = 1\n"), "--at", "1:4", "--impact", "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["error"] == "nothing_here"
    assert main([write(tmp_path, "def (:\n"), "--at", "1:1", "--impact", "--json"]) == 2
    assert json.loads(capsys.readouterr().out)["error"] == "syntax"
