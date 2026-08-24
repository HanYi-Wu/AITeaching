"""Tests for /api/system/extensions and install route."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.web import extension_preferences
from solaire.web.app import app
from solaire.web.extension_registry import resolve_exe


@pytest.fixture(autouse=True)
def _isolated_extension_prefs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Do not write host_extension_paths.json into the real %APPDATA% during tests."""
    monkeypatch.setattr("solaire.web.extension_preferences.app_data_dir", lambda: tmp_path)


def test_extensions_list_returns_items() -> None:
    client = TestClient(app)
    r = client.get("/api/system/extensions")
    assert r.status_code == 200
    data = r.json()
    assert "extensions" in data
    assert isinstance(data["extensions"], list)
    ids = {e["id"] for e in data["extensions"]}
    assert ids == {"latex", "pandoc", "tesseract"}
    for ext in data["extensions"]:
        assert "name" in ext
        assert "description" in ext
        assert "ready" in ext
        assert "can_auto_install" in ext
        assert "executables" in ext
        assert isinstance(ext["executables"], list)
        assert "has_manual_paths" in ext
        assert "manual_paths" in ext
        assert ext["install_mode"] in {"winget", "command", "manual"}
        assert "requires_confirmation" in ext
        for exe in ext["executables"]:
            assert "resolved_from" in exe


@pytest.mark.skipif(sys.platform != "win32", reason="winget install is Windows-only")
def test_extension_install_calls_winget_for_pandoc(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    called: dict[str, object] = {}
    script_dir = tmp_path / "Temp Folder"
    script_dir.mkdir()
    script_path = script_dir / "sol edu install.cmd"

    class DummyPopen:
        def __init__(self, *args: object, **kwargs: object) -> None:
            called["args"] = args
            called["kwargs"] = kwargs

    cmd_exe = r"C:\Windows\System32\cmd.exe"
    monkeypatch.setenv("COMSPEC", cmd_exe)
    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", lambda x: "C:\\winget.exe" if x == "winget" else None)
    monkeypatch.setattr("solaire.web.extension_registry.tempfile.mkstemp", lambda **_: (123, str(script_path)))
    monkeypatch.setattr("solaire.web.extension_registry.os.close", lambda _: None)
    monkeypatch.setattr("solaire.web.extension_registry.subprocess.Popen", DummyPopen)

    client = TestClient(app)
    r = client.post("/api/system/extensions/pandoc/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "args" in called
    assert called["kwargs"] == {"close_fds": False}

    launch_command = called["args"][0]
    assert isinstance(launch_command, str)

    expected_script = '"' + str(script_path.resolve()).replace('"', '""') + '"'
    expected_cmd = '"' + cmd_exe.replace('"', '""') + '"'
    assert launch_command == f'{expected_cmd} /c start "" {expected_cmd} /c {expected_script}'

    script_body = script_path.read_text(encoding="utf-8-sig")
    assert 'call "C:\\winget.exe" install "JohnMacFarlane.Pandoc"' in script_body
    assert "pause" in script_body


def test_extension_install_unknown_id() -> None:
    client = TestClient(app)
    r = client.post("/api/system/extensions/not-a-real-id/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is False


def test_linux_extension_returns_copyable_install_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_which(name: str) -> str | None:
        return "/usr/bin/apt-get" if name == "apt-get" else None

    monkeypatch.setattr("solaire.web.extension_registry.sys.platform", "linux")
    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", fake_which)

    client = TestClient(app)
    listed = client.get("/api/system/extensions").json()["extensions"]
    latex = next(ext for ext in listed if ext["id"] == "latex")
    assert latex["install_mode"] == "command"
    assert "sudo apt-get install" in latex["install_command"]
    assert "texlive-xetex" in latex["install_command"]
    assert latex["can_auto_install"] is False

    response = client.post("/api/system/extensions/pandoc/install")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["action"] == "command"
    assert "sudo apt-get install -y pandoc" in response.json()["command"]


def test_windows_extension_advertises_confirmation_before_winget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("solaire.web.extension_registry.sys.platform", "win32")
    monkeypatch.setattr(
        "solaire.web.extension_registry.shutil.which",
        lambda name: r"C:\Windows\winget.exe" if name == "winget" else None,
    )

    client = TestClient(app)
    pandoc = next(
        ext for ext in client.get("/api/system/extensions").json()["extensions"] if ext["id"] == "pandoc"
    )
    assert pandoc["install_mode"] == "winget"
    assert pandoc["can_auto_install"] is True
    assert pandoc["requires_confirmation"] is True



def test_manual_path_latex_dir(tmp_path: Path) -> None:
    d = tmp_path / "bin"
    d.mkdir()
    (d / "latexmk.exe").write_bytes(b"")
    (d / "xelatex.exe").write_bytes(b"")
    client = TestClient(app)
    r = client.put(
        "/api/system/extensions/latex/manual-path",
        json={"path": str(d), "location_kind": "dir"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    latex = next(e for e in body["extensions"] if e["id"] == "latex")
    assert latex.get("has_manual_paths") is True


def test_manual_path_clear_unknown_returns_400() -> None:
    client = TestClient(app)
    r = client.delete("/api/system/extensions/latex/manual-path")
    assert r.status_code == 400


def test_resolve_exe_uses_manual_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    exe = tmp_path / "pandoc.exe"
    exe.write_bytes(b"")
    extension_preferences.set_extension_prefs("pandoc", {"pandoc": str(exe)})
    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", lambda _: "/wrong/pandoc")
    assert resolve_exe("pandoc", "pandoc") == str(exe.resolve())


def test_resolve_exe_falls_back_to_which(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "solaire.web.extension_registry.shutil.which",
        lambda name: "/bin/pandoc" if name == "pandoc" else None,
    )
    assert resolve_exe("pandoc", "pandoc") == "/bin/pandoc"


def test_resolve_exe_none_when_no_manual_and_no_which(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", lambda _: None)
    assert resolve_exe("pandoc", "pandoc") is None


def test_tex_status_matches_latex_extension() -> None:
    """PDF 排版检测与扩展列表中的 latex 项同源。"""
    client = TestClient(app)
    tex = client.get("/api/system/tex-status").json()
    exts = client.get("/api/system/extensions").json()["extensions"]
    latex = next(e for e in exts if e["id"] == "latex")
    assert tex["latexmk_on_path"] == latex["executables"][0]["on_path"]
    assert tex["xelatex_on_path"] == latex["executables"][1]["on_path"]
    assert tex["pdf_engine_ready"] == latex["ready"]
