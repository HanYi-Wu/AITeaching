"""Keep product version and custom-license declarations consistent."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.4.5"


def test_product_versions_are_aligned() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    web_package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
    primebrush = tomllib.loads((ROOT / "primebrush-rs" / "Cargo.toml").read_text(encoding="utf-8"))
    exam_init = (ROOT / "src" / "solaire" / "exam_compiler" / "__init__.py").read_text(
        encoding="utf-8"
    )

    assert pyproject["project"]["version"] == VERSION
    assert web_package["version"] == VERSION
    assert primebrush["workspace"]["package"]["version"] == VERSION
    assert f'__version__ = "{VERSION}"' in exam_init


def test_release_notes_include_adaptive_practice_versions() -> None:
    changelog = (
        ROOT / "src" / "solaire" / "web" / "assets" / "help_docs" / "changelog.md"
    ).read_text(encoding="utf-8")

    assert changelog.index("## version 1.4.5") < changelog.index("## version 1.4.4")
    assert "专项复习试卷" in changelog
    assert "历史错题试卷" in changelog
    assert "AI 工具" in changelog


def test_docs_do_not_claim_a_standard_open_source_license() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    legal = (
        ROOT / "src" / "solaire" / "web" / "assets" / "help_docs" / "introduction" / "legal-and-contact.md"
    ).read_text(encoding="utf-8")

    assert "MIT" not in readme
    assert "AGPL" not in readme
    assert "AGPL" not in legal
    assert "非商业" in readme
    assert "非商业" in legal
