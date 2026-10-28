"""Keep product version and custom-license declarations consistent."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.7.0"


def test_product_versions_are_aligned() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    web_package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
    web_lock = json.loads((ROOT / "web" / "package-lock.json").read_text(encoding="utf-8"))
    desktop = tomllib.loads((ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8"))
    tauri = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    primebrush = tomllib.loads((ROOT / "primebrush-rs" / "Cargo.toml").read_text(encoding="utf-8"))
    exam_init = (ROOT / "src" / "solaire" / "exam_compiler" / "__init__.py").read_text(
        encoding="utf-8"
    )

    assert pyproject["project"]["version"] == VERSION
    assert web_package["version"] == VERSION
    assert web_lock["version"] == web_lock["packages"][""]["version"] == VERSION
    assert desktop["package"]["version"] == tauri["version"] == VERSION
    assert primebrush["workspace"]["package"]["version"] == VERSION
    assert f'__version__ = "{VERSION}"' in exam_init
    from solaire.web.app import app

    assert app.version == VERSION


def test_release_notes_include_adaptive_practice_versions() -> None:
    changelog = (
        ROOT / "src" / "solaire" / "web" / "assets" / "help_docs" / "changelog.md"
    ).read_text(encoding="utf-8")

    assert changelog.index("## version 1.6.2") < changelog.index("## version 1.6.1") < changelog.index("## version 1.6.0") < changelog.index("## version 1.5.7") < changelog.index("## version 1.5.6")
    assert changelog.index("## version 1.5.6") < changelog.index("## version 1.5.5") < changelog.index("## version 1.5.4") < changelog.index("## version 1.5.3") < changelog.index("## version 1.5.2") < changelog.index("## version 1.5.1")
    assert "专项复习试卷" in changelog
    assert "历史错题试卷" in changelog
    assert "AI 工具" in changelog


def test_manual_omits_removed_copyright_page() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    manifest = json.loads((ROOT / "src" / "solaire" / "web" / "assets" / "help_docs" / "help-manifest.json").read_text(encoding="utf-8"))

    assert "MIT" not in readme
    assert "AGPL" not in readme
    assert "非商业" in readme
    assert all(page["id"] != "legal-and-contact" for page in manifest["pages"])
