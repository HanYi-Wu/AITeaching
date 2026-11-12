from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import yaml

from solaire.exam_compiler import latex_metadata_ui
from solaire.exam_compiler.loaders.template_loader import load_template
from solaire.exam_compiler.merge_util import deep_merge
from solaire.exam_compiler.pipeline.hydrate import hydrate
from solaire.exam_compiler.pipeline.prepare import prepare_exam
from solaire.exam_compiler.template_editor_builtins import TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED
from solaire.exam_compiler.template_metadata_materialize import materialize_metadata_defaults_for_editor
from solaire.exam_compiler.template_parsed_models import TemplateParsedResponse


def _write_template(path: Path, template_id: str = "alpha") -> None:
    path.write_text(
        f"""template_id: {template_id}
layout: single_column
latex_base: paper.tex.j2
sections:
  - section_id: I
    type: single_choice
    required_count: 1
    score_per_item: 2
metadata_defaults:
  custom:
    section_override: yes
""",
        encoding="utf-8",
    )
    (path.parent / "paper.tex.j2").write_text("{{ metadata.title }}", encoding="utf-8")


def _restore_mtime(path: Path, before: os.stat_result) -> None:
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    assert path.stat().st_mtime_ns == before.st_mtime_ns


def test_template_cache_returns_private_models_and_tracks_same_size_source_edits(tmp_path: Path) -> None:
    path = tmp_path / "template.yaml"
    _write_template(path)
    defaults = tmp_path / "defaults.yaml"
    defaults.write_text(
        "metadata_defaults:\n  custom:\n    default_marker: x\n",
        encoding="utf-8",
    )

    first = load_template(path)
    first.metadata_defaults["custom"]["section_override"] = "mutated"
    first.sections[0].required_count = 99
    second = load_template(path)
    assert second is not first
    assert second.metadata_defaults["custom"]["section_override"] is True
    assert second.sections[0].required_count == 1
    assert second.metadata_defaults["custom"]["default_marker"] == "x"

    template_stat = path.stat()
    path.write_bytes(path.read_bytes().replace(b"template_id: alpha", b"template_id: bravo"))
    _restore_mtime(path, template_stat)
    changed_template = load_template(path)
    assert changed_template.template_id == "bravo"

    defaults_stat = defaults.stat()
    defaults.write_bytes(defaults.read_bytes().replace(b"default_marker: x", b"default_marker: y"))
    _restore_mtime(defaults, defaults_stat)
    changed_defaults = load_template(path)
    assert changed_defaults.template_id == "bravo"
    assert changed_defaults.metadata_defaults["custom"]["default_marker"] == "y"


def test_metadata_ui_cache_rechecks_priority_content_and_return_isolation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = tmp_path / "project"
    bundled = tmp_path / "bundled"
    project.mkdir()
    bundled.mkdir()
    (project / "paper.tex.j2").write_text("project", encoding="utf-8")
    (bundled / "paper.tex.j2").write_text("bundled", encoding="utf-8")
    bundled_companion = bundled / "paper.metadata_ui.yaml"
    bundled_companion.write_text(
        "fields:\n  - key: school\n    label: Bundled\n    kind: text\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(latex_metadata_ui, "_BUNDLED_LATEX_DIR", bundled)

    fields, source, warnings = latex_metadata_ui.load_latex_metadata_ui_fields(project, "paper.tex.j2")
    assert source == bundled_companion
    assert fields[0]["label"] == "Bundled"
    assert warnings == []

    project_companion = project / "paper.metadata_ui.yaml"
    project_companion.write_text(
        "fields:\n  - key: school\n    label: Project\n    kind: text\n",
        encoding="utf-8",
    )
    fields, source, _warnings = latex_metadata_ui.load_latex_metadata_ui_fields(project, "paper.tex.j2")
    assert source == project_companion
    fields[0]["label"] = "caller mutation"
    again, again_source, _warnings = latex_metadata_ui.load_latex_metadata_ui_fields(project, "paper.tex.j2")
    assert again_source == project_companion
    assert again[0]["label"] == "Project"

    before = project_companion.stat()
    project_companion.write_bytes(project_companion.read_bytes().replace(b"label: Project", b"label: Primary"))
    _restore_mtime(project_companion, before)
    updated, updated_source, _warnings = latex_metadata_ui.load_latex_metadata_ui_fields(project, "paper.tex.j2")
    assert updated_source == project_companion
    assert updated[0]["label"] == "Primary"


def test_template_cache_concurrent_loads_do_not_share_mutable_models(tmp_path: Path) -> None:
    path = tmp_path / "concurrent.yaml"
    _write_template(path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        templates = list(pool.map(lambda _index: load_template(path), range(24)))

    assert len({id(template) for template in templates}) == len(templates)
    templates[0].metadata_defaults["custom"]["section_override"] = "changed"
    assert all(template.metadata_defaults["custom"]["section_override"] is True for template in templates[1:])


def test_template_yaml_error_precedes_defaults_yaml_error(tmp_path: Path) -> None:
    path = tmp_path / "invalid.yaml"
    path.write_text("template_id: [\n", encoding="utf-8")
    (tmp_path / "defaults.yaml").write_text("metadata_defaults: [\n", encoding="utf-8")

    with pytest.raises(yaml.YAMLError) as error:
        load_template(path)
    assert str(path) in str(error.value)


def test_editor_metadata_materialization_keeps_nested_inputs_and_results_isolated() -> None:
    source = {
        "mermaid_pdf": {"landscape_width": "0.7\\linewidth"},
        "custom": {"values": [1, {"enabled": True}]},
    }
    first = materialize_metadata_defaults_for_editor(source)
    assert first["mermaid_pdf"]["landscape_width"] == "0.7\\linewidth"
    assert first["mermaid_pdf"]["portrait_width"]
    first["custom"]["values"][1]["enabled"] = False
    second = materialize_metadata_defaults_for_editor(source)
    assert source["custom"]["values"][1]["enabled"] is True
    assert second["custom"]["values"][1]["enabled"] is True


def test_editor_and_preview_prepare_share_template_and_export_merge(tmp_path: Path) -> None:
    template_path = Path(__file__).resolve().parents[1] / "examples" / "gaokao_sample" / "templates" / "gaokao2024.yaml"
    exam_path = tmp_path / "exam.yaml"
    exam_path.write_text(
        yaml.safe_dump(
            {
                "exam_id": "template-cache-check",
                "template_ref": "gaokao2024_math",
                "template_path": str(template_path),
                "metadata": {"sample_override": {"enabled": True}},
                "question_libraries": [],
                "selected_items": [],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    prepared = prepare_exam(exam_path, preview_relaxed=True)
    editor_template = load_template(template_path)
    assert editor_template.model_dump(mode="json") == prepared.template.model_dump(mode="json")
    materialized = materialize_metadata_defaults_for_editor(dict(editor_template.metadata_defaults))
    parsed = TemplateParsedResponse.from_exam_template(
        editor_template,
        layout_builtin_keys=list(TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED),
        materialized_metadata=materialized,
    )
    exported = hydrate(prepared.exam, prepared.template, prepared.loaded)

    assert len(parsed.sections) == len(prepared.template.sections) == 4
    assert [section.model_dump() for section in parsed.sections] == [
        section.model_dump() for section in prepared.template.sections
    ]
    assert exported.metadata == deep_merge(prepared.template.metadata_defaults, prepared.exam.metadata)
    assert len(prepared.preview_warnings) == 4
