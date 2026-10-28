from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
import yaml

from solaire.common.yaml_utils import safe_load_yaml
from solaire.web import exam_workspace_service
from solaire.web.exam_workspace_service import list_exam_workspaces


def test_safe_yaml_loader_preserves_types_aliases_and_rejects_python_tags() -> None:
    source = """\
base: &base
  count: 3
  enabled: true
  created: 2026-10-28
  empty: null
  positive_infinity: .inf
  not_a_number: .nan
copy: *base
"""
    expected = yaml.safe_load(source)
    actual = safe_load_yaml(source)

    assert actual == expected
    assert actual["base"] is actual["copy"]
    assert isinstance(actual["base"]["created"], type(expected["base"]["created"]))
    assert math.isinf(actual["base"]["positive_infinity"])
    assert math.isnan(actual["base"]["not_a_number"])
    with pytest.raises(yaml.YAMLError):
        safe_load_yaml('value: !!python/object/apply:builtins.print ["unsafe"]')


def test_safe_yaml_loader_fallback_uses_safe_loader(monkeypatch: pytest.MonkeyPatch) -> None:
    from solaire.common import yaml_utils

    monkeypatch.setattr(yaml_utils, "_SAFE_LOADER", yaml.SafeLoader)
    assert yaml_utils.safe_load_yaml("count: 3\nenabled: true\n") == {"count": 3, "enabled": True}
    with pytest.raises(yaml.YAMLError):
        yaml_utils.safe_load_yaml('value: !!python/object/apply:builtins.print ["unsafe"]')


def test_workspace_list_parses_exam_yaml_once_for_legacy_and_current_workspaces(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    legacy_id = "legacy/数学"
    current_id = "current/数学"
    legacy_dir = tmp_path / "exams" / "legacy" / "数学"
    current_dir = tmp_path / "exams" / "current" / "数学"
    legacy_dir.mkdir(parents=True)
    current_dir.mkdir(parents=True)

    document = {
        "name": "兼容工作区",
        "subject": "数学",
        "export_label": "期中考试",
        "updated_at": "2026-10-28T00:00:00Z",
        "template_ref": "gaokao2024",
        "template_path": "../templates/gaokao2024.yaml",
        "selected_items": [],
    }
    for directory in (legacy_dir, current_dir):
        (directory / "exam.yaml").write_text(
            yaml.safe_dump(document, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
    (current_dir / "config.json").write_text(
        json.dumps(
            {
                "exam_id": current_id,
                "status": "draft",
                "exam_label": "期中考试",
                "subject": "数学",
                "display_name": "兼容工作区",
                "updated_at": "2026-10-28T00:00:00Z",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    parsed: list[str | None] = []
    original = exam_workspace_service.safe_load_yaml

    def counted(stream):
        parsed.append(getattr(stream, "name", None))
        return original(stream)

    monkeypatch.setattr(exam_workspace_service, "safe_load_yaml", counted)
    rows = list_exam_workspaces(tmp_path)

    assert len(parsed) == 2
    assert {row["exam_id"] for row in rows} == {legacy_id, current_id}
    assert all(row["template_ref"] == "gaokao2024" for row in rows)
    assert all(row["template_path"] == "templates/gaokao2024.yaml" for row in rows)
