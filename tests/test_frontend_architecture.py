"""Static guardrails for shell localization and route-level code splitting."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_app_shell_uses_lazy_page_imports_and_i18n() -> None:
    app_source = (ROOT / "web" / "src" / "App.tsx").read_text(encoding="utf-8")
    routes_source = (ROOT / "web" / "src" / "app" / "routes.tsx").read_text(encoding="utf-8")

    assert "lazy(" in app_source
    assert "Suspense" in app_source
    assert 'from "./pages/' not in app_source
    assert 'from "../pages/' not in routes_source
    assert "platformStatus.public_mode" in app_source
    for literal in ("正在加载平台权限", 'label="试卷"', 'label="设置"', 'label="退出"'):
        assert literal not in app_source


def test_vite_requires_explicit_public_hosts() -> None:
    vite_source = (ROOT / "web" / "vite.config.ts").read_text(encoding="utf-8")

    assert "SOLAIRE_PUBLIC_HOSTS" in vite_source
    assert '".frp-van.com"' not in vite_source


def test_web_shell_declares_an_existing_favicon() -> None:
    index_source = (ROOT / "web" / "index.html").read_text(encoding="utf-8")

    assert 'href="/favicon.svg"' in index_source
    assert (ROOT / "web" / "public" / "favicon.svg").is_file()
