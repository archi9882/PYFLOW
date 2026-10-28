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
