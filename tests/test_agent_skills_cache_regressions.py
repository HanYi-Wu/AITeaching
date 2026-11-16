from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from solaire.agent_layer import skills as skills_module


def _write_skill(root: Path, directory_name: str, frontmatter: str, body: str = "instructions") -> None:
    skill_dir = root / directory_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\n{frontmatter}\n---\n{body}\n",
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _clear_global_skill_cache():
    skills_module.clear_skill_cache()
    yield
    skills_module.clear_skill_cache()


def test_project_catalogs_are_isolated_and_project_entries_override_builtins(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    builtin = tmp_path / "builtin"
    _write_skill(builtin, "shared", "name: shared\ndescription: builtin")
    _write_skill(builtin, "core", "name: core\ndescription: core")
    monkeypatch.setattr(skills_module, "_builtin_skills_dir", lambda: builtin)

    project_a = tmp_path / "project-a"
    _write_skill(
        project_a / ".solaire" / "agent" / "skills",
        "shared",
        "name: shared\ndescription: project A",
    )
    _write_skill(
        project_a / ".solaire" / "agent" / "skills",
        "local-a",
        "name: local-a\ndescription: local to A",
    )
    project_b = tmp_path / "project-b"
    _write_skill(
        project_b / ".solaire" / "agent" / "skills",
        "local-b",
        "name: local-b\ndescription: local to B",
    )

    shared_a = skills_module.get_skill("shared", project_a)
    shared_b = skills_module.get_skill("shared", project_b)
    assert shared_a is not None and shared_a.description == "project A"
    assert shared_b is not None and shared_b.description == "builtin"
    assert skills_module.get_skill("local-a", project_b) is None
    assert skills_module.get_skill("local-b", project_a) is None
    assert list(skills_module._ensure_cache(project_a)) == ["core", "shared", "local-a"]


def test_non_mapping_frontmatter_is_skipped_and_bad_metadata_does_not_break_scan(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    builtin = tmp_path / "builtin"
    _write_skill(builtin, "a-bad-map", "- invalid\n- yaml")
    _write_skill(
        builtin,
        "b-bad-metadata",
        "name: metadata-list\ndescription: still usable\nmetadata:\n  - invalid",
    )
    _write_skill(
        builtin,
        "c-invalid-nested-yaml",
        "name: recovered\ndescription: fallback works\nmetadata: [broken",
    )
    monkeypatch.setattr(skills_module, "_builtin_skills_dir", lambda: builtin)

    catalog = skills_module._ensure_cache()
    assert list(catalog) == ["metadata-list", "recovered"]
    assert catalog["metadata-list"].description == "still usable"
    assert catalog["metadata-list"].tool_patterns == ()
    assert catalog["recovered"].description == "fallback works"


def test_project_cache_uses_canonical_keys_shared_builtin_ttl_and_lru_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    builtin = tmp_path / "builtin"
    _write_skill(builtin, "core", "name: core\ndescription: core")
    monkeypatch.setattr(skills_module, "_builtin_skills_dir", lambda: builtin)

    original_scan = skills_module._scan_skill_dir
    scanned: list[Path] = []

    def counted_scan(directory: Path):
        scanned.append(directory)
        return original_scan(directory)

    monkeypatch.setattr(skills_module, "_scan_skill_dir", counted_scan)
    clock = [100.0]
    monkeypatch.setattr(skills_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    cache = skills_module._SkillCache()
    cache._MAX_PROJECT_CATALOGS = 2
    projects = [tmp_path / f"project-{index}" for index in range(3)]
    for index, project in enumerate(projects):
        _write_skill(
            project / ".solaire" / "agent" / "skills",
            f"local-{index}",
            f"name: local-{index}\ndescription: project {index}",
        )

    cache.get(projects[0])
    cache.get(projects[1])
    cache.get(projects[0] / ".")  # Same canonical project; refreshes its LRU position.
    clock[0] += 5
    cache.get(projects[0])  # Hot hit does not scan either directory again.
    cache.get(projects[2])

    assert len(cache._project_catalogs) == 2
    assert list(cache._project_catalogs) == [
        cache._canonical_project_root(projects[0])[0],
        cache._canonical_project_root(projects[2])[0],
    ]
    assert scanned.count(builtin) == 1
    assert scanned.count(projects[0] / ".solaire" / "agent" / "skills") == 1

    clock[0] += 11
    cache.get(projects[2])
    assert scanned.count(builtin) == 2  # Builtins and dependent overlays expire together.
    assert scanned.count(projects[2] / ".solaire" / "agent" / "skills") == 2

    cache.clear()
    assert not cache._project_catalogs
    assert cache._builtin_skills is None
    cache.get(projects[2])
    assert scanned.count(builtin) == 3


def test_hot_catalog_calls_reuse_scanned_descriptors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    builtin = tmp_path / "builtin"
    _write_skill(builtin, "core", "name: core\ndescription: one stable entry")
    monkeypatch.setattr(skills_module, "_builtin_skills_dir", lambda: builtin)

    original_scan = skills_module._scan_skill_dir
    calls = 0

    def counted_scan(directory: Path):
        nonlocal calls
        calls += 1
        return original_scan(directory)

    monkeypatch.setattr(skills_module, "_scan_skill_dir", counted_scan)
    expected = "- **core**（`core`）：one stable entry"
    assert skills_module.build_skill_catalog() == expected
    for _ in range(100):
        assert skills_module.build_skill_catalog() == expected
    assert calls == 1
