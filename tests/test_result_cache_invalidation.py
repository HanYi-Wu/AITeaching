"""Regression and contract tests for results analysis caching."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch
import pytest
import yaml

from solaire.knowledge_forge.models import ConceptNode, GraphMeta, GraphState, QuestionBinding, SubjectMeta
from solaire.knowledge_forge.storage import _save_meta, _save_subject_state, load_graph
from solaire.web.app import ensure_project_layout
from solaire.web.exam_workspace_service import save_exam_workspace, workspace_dir
from solaire.web.results.analysis_cache import (
    compute_source_fingerprint,
    is_cache_valid,
    strip_cache_metadata,
)
from solaire.web.results.batches import delete_score_batch, import_scores
from solaire.web.results.statistics import compute_statistics, get_score_analysis

_SUBJ = "数学"


def _setup_exam_with_score(
    project_root: Path,
    label: str,
    score_per_item: float = 5.0,
    student_score: float = 5.0,
) -> tuple[str, str]:
    """Helper to set up a project, single question exam, and single student score batch."""
    ensure_project_layout(project_root)
    selected = [
        {
            "section_id": "s1",
            "question_ids": ["q_1_1"],
            "score_per_item": score_per_item,
        }
    ]
    saved = save_exam_workspace(
        project_root,
        exam_id=None,
        name=f"考试-{label}",
        subject=_SUBJ,
        export_label=label,
        template_ref="default",
        template_path="templates/default.yaml",
        selected_items=selected,
    )
    exam_id = saved["exam_id"]

    csv_data = f"姓名,学号,1.1\n张三,2026001,{student_score}\n"
    imported = import_scores(
        project_root,
        exam_id,
        csv_data.encode("utf-8"),
        "scores.csv",
    )
    return exam_id, imported["batch_id"]


class TestSourceFingerprintInvalidation:
    """A score-per-item change invalidates the analysis cache using consumed inputs."""

    def test_reproduce_score_per_item_invalidation(self, tmp_path: Path) -> None:
        """Score_per_item changed from 5 to 10: get_score_analysis must invalidate and reflect 0.5."""
        exam_id, batch_id = _setup_exam_with_score(
            tmp_path,
            "reproduce-staleness",
            score_per_item=5.0,
            student_score=5.0,
        )

        # First normal read: computes and caches 1.0 (5.0 / 5.0)
        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["class_avg_ratio"] == 1.0
        assert a1["student_stats"][0]["score_ratio"] == 1.0
        assert a1["question_stats"][0]["score_per_item"] == 5.0
        assert a1["question_stats"][0]["avg_score_ratio"] == 1.0

        # Change exam score_per_item to 10.0 in exam.yaml
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][0]["score_per_item"] = 10.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        # Second read via get_score_analysis: must NOT return stale 1.0, but correctly recomputed 0.5 (5.0 / 10.0)
        a2 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a2["class_avg_ratio"] == 0.5
        assert a2["student_stats"][0]["score_ratio"] == 0.5
        assert a2["question_stats"][0]["score_per_item"] == 10.0
        assert a2["question_stats"][0]["avg_score_ratio"] == 0.5

        # Independent compute_statistics should match
        recomputed = compute_statistics(tmp_path, exam_id, batch_id)
        assert recomputed["class_avg_ratio"] == 0.5
        assert recomputed["student_stats"][0]["score_ratio"] == 0.5

    def test_unrelated_exam_metadata_change_hits_cache(self, tmp_path: Path) -> None:
        """Modifying title or export description does not invalidate narrow fingerprint."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "metadata-cache-hit", score_per_item=5.0)

        # Initial compute & cache
        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["class_avg_ratio"] == 1.0

        # Modify only non-question metadata in exam.yaml
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        if not isinstance(doc.get("metadata"), dict):
            doc["metadata"] = {}
        doc["metadata"]["title"] = "全新标题改动（不应导致重新统计）"
        doc["metadata"]["note"] = "无关注释"
        doc["description"] = "顶层无关描述"
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        with patch("solaire.web.results.statistics.compute_statistics") as spy_compute:
            a2 = get_score_analysis(tmp_path, exam_id, batch_id)
            assert not spy_compute.called, "compute_statistics should not have been called on unrelated metadata change"
            assert a2["class_avg_ratio"] == 1.0

    def test_fingerprint_metadata_never_leaked_to_api(self, tmp_path: Path) -> None:
        """Returned dict from compute_statistics and get_score_analysis must not expose _fingerprint."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "api-leak-check", score_per_item=5.0)

        c_data = compute_statistics(tmp_path, exam_id, batch_id)
        g_data = get_score_analysis(tmp_path, exam_id, batch_id)

        expected_keys = {
            "batch_id",
            "exam_id",
            "student_count",
            "question_count",
            "imported_at",
            "warnings",
            "question_order",
            "student_mastery_rows",
            "question_stats",
            "node_stats",
            "student_stats",
            "class_avg_ratio",
            "class_avg_fuzzy",
        }
        for data in (c_data, g_data):
            assert set(data.keys()) == expected_keys
            for k in data.keys():
                assert not k.startswith("_"), f"Found private/metadata key {k!r} in API return value"

    def test_graph_binding_change_invalidates_cache_narrowly(self, tmp_path: Path) -> None:
        """Binding change for this exam's question invalidates cache; binding for another question does not."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "graph-invalidation", score_per_item=5.0)

        # Initially unbound: node_stats is empty, warnings has q_1_1
        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert len(a1["warnings"]) == 1
        assert a1["node_stats"] == []

        # Add node and bind q_1_1 to node_1
        state = GraphState(
            nodes=[ConceptNode(id="node_1", canonical_name="核心定理")],
            bindings=[QuestionBinding(question_qualified_id="q_1_1", node_id="node_1")],
        )
        _save_meta(tmp_path, GraphMeta(subjects=[SubjectMeta(slug=_SUBJ, display_name=_SUBJ, node_count=1)]))
        _save_subject_state(tmp_path, _SUBJ, state)

        # Next read should invalidate cache and compute node stats
        a2 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert len(a2["warnings"]) == 0
        assert len(a2["node_stats"]) == 1
        assert a2["node_stats"][0]["node_id"] == "node_1"

        # Now bind an unrelated question for another exam (e.g. q_unrelated)
        state.bindings.append(QuestionBinding(question_qualified_id="q_unrelated", node_id="node_1"))
        _save_subject_state(tmp_path, _SUBJ, state)

        # Unrelated question binding should NOT invalidate cache
        with patch("solaire.web.results.statistics.compute_statistics") as spy_compute:
            a3 = get_score_analysis(tmp_path, exam_id, batch_id)
            assert not spy_compute.called, "Unrelated question binding should not trigger recomputation"
            assert a3["node_stats"] == a2["node_stats"]

    def test_scores_csv_change_invalidates_cache(self, tmp_path: Path) -> None:
        """Modifying scores.csv invalidates cache."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "scores-change", score_per_item=5.0, student_score=5.0)
        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["class_avg_ratio"] == 1.0

        scores_csv = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "scores.csv"
        scores_csv.write_text("姓名,学号,1.1\n张三,2026001,2.5\n", encoding="utf-8")

        a2 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a2["class_avg_ratio"] == 0.5


class TestCacheLifecycleAndAtomicWrites:
    """Legacy cache compatibility, batch lifecycle, and atomic write failures."""

    def test_legacy_analysis_and_placeholder_compatibility(self, tmp_path: Path) -> None:
        """Placeholder from import_scores or legacy analysis.json without fingerprint recomputes safely and caches."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "legacy-cache", score_per_item=5.0)
        analysis_path = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "analysis.json"

        # 1. Fresh import writes a placeholder: verify get_score_analysis computes and saves new cache with _fingerprint
        assert analysis_path.is_file()
        placeholder = json.loads(analysis_path.read_text(encoding="utf-8"))
        assert "_fingerprint" not in placeholder

        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["class_avg_ratio"] == 1.0
        # Now analysis.json on disk has _fingerprint
        disk_data = json.loads(analysis_path.read_text(encoding="utf-8"))
        assert "_fingerprint" in disk_data

        # 2. Simulate legacy analysis.json: computed data without _fingerprint
        legacy_data = dict(disk_data)
        legacy_data.pop("_fingerprint", None)
        analysis_path.write_text(json.dumps(legacy_data, ensure_ascii=False, indent=2), encoding="utf-8")

        # First read on legacy: safely recomputes and writes new fingerprint
        a_legacy = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a_legacy["class_avg_ratio"] == 1.0
        updated_disk = json.loads(analysis_path.read_text(encoding="utf-8"))
        assert "_fingerprint" in updated_disk

        # Second read: hits cache without calling compute_statistics
        with patch("solaire.web.results.statistics.compute_statistics") as spy_compute:
            a_hit = get_score_analysis(tmp_path, exam_id, batch_id)
            assert not spy_compute.called
            assert a_hit["class_avg_ratio"] == 1.0

    def test_non_object_analysis_json_is_recomputed(self, tmp_path: Path) -> None:
        """Valid JSON scalars are malformed caches and should be replaced by computed analysis."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "scalar-cache", score_per_item=5.0)
        analysis_path = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "analysis.json"
        analysis_path.write_text("null", encoding="utf-8")

        analysis = get_score_analysis(tmp_path, exam_id, batch_id)

        assert analysis["class_avg_ratio"] == 1.0
        repaired = json.loads(analysis_path.read_text(encoding="utf-8"))
        assert isinstance(repaired, dict)
        assert "_fingerprint" in repaired

    def test_incomplete_analysis_response_is_recomputed(self, tmp_path: Path) -> None:
        """A cache missing a public response field must not be returned as a valid analysis."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "incomplete-cache", score_per_item=5.0)
        analysis_path = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "analysis.json"
        get_score_analysis(tmp_path, exam_id, batch_id)

        cached = json.loads(analysis_path.read_text(encoding="utf-8"))
        cached.pop("class_avg_ratio")
        analysis_path.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")

        analysis = get_score_analysis(tmp_path, exam_id, batch_id)

        assert analysis["class_avg_ratio"] == 1.0
        assert "class_avg_ratio" in json.loads(analysis_path.read_text(encoding="utf-8"))

    def test_cache_hit_and_single_recompute(self, tmp_path: Path) -> None:
        """When inputs do not change, cache is reused; when input changes, it recomputes exactly once."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "hit-count", score_per_item=5.0)

        # Populate cache
        get_score_analysis(tmp_path, exam_id, batch_id)

        # Subsequent 3 calls must all hit cache
        with patch("solaire.web.results.statistics.compute_statistics") as spy_compute:
            for _ in range(3):
                get_score_analysis(tmp_path, exam_id, batch_id)
            assert spy_compute.call_count == 0

        # Change score_per_item to 10
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][0]["score_per_item"] = 10.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        # Next call recomputes once
        a_new = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a_new["class_avg_ratio"] == 0.5

        # Subsequent calls hit new cache
        with patch("solaire.web.results.statistics.compute_statistics") as spy_compute:
            for _ in range(3):
                get_score_analysis(tmp_path, exam_id, batch_id)
            assert spy_compute.call_count == 0

    def test_batch_lifecycle_import_delete(self, tmp_path: Path) -> None:
        """Deleted batch cannot return analysis; new batch has distinct identity and cache."""
        exam_id, batch1_id = _setup_exam_with_score(tmp_path, "lifecycle", score_per_item=5.0)

        # Warm cache for batch1
        get_score_analysis(tmp_path, exam_id, batch1_id)

        # Delete batch1
        res = delete_score_batch(tmp_path, exam_id, batch1_id)
        assert res["ok"] is True

        # Calling get_score_analysis on deleted batch raises FileNotFoundError
        with pytest.raises(FileNotFoundError):
            get_score_analysis(tmp_path, exam_id, batch1_id)

        # Import a second batch with same data
        csv_data = "姓名,学号,1.1\n李四,2026002,5.0\n"
        imported2 = import_scores(tmp_path, exam_id, csv_data.encode("utf-8"), "scores.csv")
        batch2_id = imported2["batch_id"]
        assert batch2_id != batch1_id

        a2 = get_score_analysis(tmp_path, exam_id, batch2_id)
        assert a2["batch_id"] == batch2_id
        assert a2["student_stats"][0]["name"] == "李四"

    def test_atomic_write_failure_preserves_existing_cache(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Injected write failure in atomic write preserves existing analysis.json and cleans up tmp files."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "atomic-fail", score_per_item=5.0)

        # Initial successful cache write
        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["class_avg_ratio"] == 1.0

        analysis_path = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "analysis.json"
        original_bytes = analysis_path.read_bytes()

        # Modify exam.yaml to trigger recomputation
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][0]["score_per_item"] = 10.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        # Inject failure into write_text_atomic
        def mock_atomic_fail(path: Path, content: str) -> None:
            raise OSError("Injected disk write failure")

        monkeypatch.setattr(
            "solaire.web.results.analysis_cache.write_text_atomic",
            mock_atomic_fail,
        )

        with pytest.raises(OSError, match="Injected disk write failure"):
            get_score_analysis(tmp_path, exam_id, batch_id)

        # Existing analysis.json must remain completely uncorrupted
        assert analysis_path.read_bytes() == original_bytes

        # No temporary files left behind
        batch_dir = analysis_path.parent
        tmp_files = list(batch_dir.glob(".*.tmp"))
        assert tmp_files == []


class TestGraphStateReuse:
    """One read-only graph state serves node statistics and unbound warnings."""

    def test_single_load_graph_call_in_compute_statistics(self, tmp_path: Path) -> None:
        """load_graph must be called at most once during single compute_statistics execution."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "single-load-graph", score_per_item=5.0)

        # Setup graph with bindings
        state = GraphState(
            nodes=[ConceptNode(id="n1", canonical_name="知识点1")],
            bindings=[QuestionBinding(question_qualified_id="q_1_1", node_id="n1")],
        )
        _save_meta(tmp_path, GraphMeta(subjects=[SubjectMeta(slug=_SUBJ, display_name=_SUBJ, node_count=1)]))
        _save_subject_state(tmp_path, _SUBJ, state)

        with patch("solaire.web.results.statistics.load_graph", wraps=load_graph) as spy_load:
            analysis = compute_statistics(tmp_path, exam_id, batch_id)
            assert spy_load.call_count == 1, f"Expected load_graph to be called 1 time, got {spy_load.call_count}"
            assert len(analysis["node_stats"]) == 1
            assert len(analysis["warnings"]) == 0

    def test_graph_missing_or_error_graceful_fallback(self, tmp_path: Path) -> None:
        """Missing or failing load_graph falls back cleanly to empty node_stats and unbound warnings."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "graph-fallback", score_per_item=5.0)

        with patch("solaire.web.results.statistics.load_graph", side_effect=RuntimeError("Graph broken")):
            analysis = compute_statistics(tmp_path, exam_id, batch_id)
            assert analysis["node_stats"] == []
            assert len(analysis["warnings"]) == 1
            assert analysis["warnings"][0]["question_id"] == "q_1_1"


class TestUserPerspectiveEndToEnd:
    """User-perspective end-to-end tests: ensuring teachers/students face no bugs in realistic usage."""

    def test_user_http_workflow_full_lifecycle(self, web_client, tmp_path: Path) -> None:
        """Teacher workflow: import scores, view analysis, view diagnosis, edit exam points, and delete."""
        exam_id = "user-flow/数学"
        exam_dir = tmp_path / "exams" / "user-flow" / "数学"
        exam_dir.mkdir(parents=True)
        # 2 sections: Section 1 (2 questions @ 5.0), Section 2 (1 question @ 10.0) -> total 20.0
        from tests.integration._helpers import write_exam_yaml
        write_exam_yaml(exam_dir, exam_id, [("选择题", 2, 5.0), ("解答题", 1, 10.0)])

        # 1. Teacher uploads scores CSV
        csv_content = "姓名,学号,1.1,1.2,2.1\n张三,2026001,5,5,10\n李四,2026002,5,0,5\n"
        r_upload = web_client.post(
            f"/api/exams/{exam_id}/scores",
            files={"file": ("期中成绩.csv", csv_content.encode("utf-8"), "text/csv")},
        )
        assert r_upload.status_code == 200
        batch_id = r_upload.json()["batch_id"]

        # 2. Teacher views analysis on the frontend
        r_get = web_client.get(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r_get.status_code == 200
        data1 = r_get.json()
        assert data1["student_count"] == 2
        assert data1["student_stats"][0]["score_ratio"] == 1.0  # 张三: 20/20 = 1.0
        assert data1["student_stats"][1]["score_ratio"] == 0.5  # 李四: 10/20 = 0.5

        # 3. Teacher views diagnosis endpoints without manually clicking recompute
        r_diag_know = web_client.get("/api/analysis/diagnosis/knowledge", params={"exam_id": exam_id, "batch_id": batch_id})
        assert r_diag_know.status_code == 200

        r_diag_heat = web_client.get("/api/analysis/diagnosis/class-heatmap", params={"exam_id": exam_id, "batch_id": batch_id})
        assert r_diag_heat.status_code == 200
        assert len(r_diag_heat.json().get("matrix", [])) == 2

        # 4. Teacher finds an error in question points in exam editor:
        # Changes Section 2 points from 10.0 to 30.0 -> total now 5 + 5 + 30 = 40.0
        exam_yaml = exam_dir / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][1]["score_per_item"] = 30.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        # 5. Teacher directly refreshes the results page:
        # Cache must automatically invalidate without user having to clear server cache!
        r_refresh = web_client.get(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r_refresh.status_code == 200
        data2 = r_refresh.json()
        # 张三 got 5+5+10 = 20 / 40 = 0.5
        assert data2["student_stats"][0]["score_ratio"] == 0.5
        # 解答题 score_per_item is now 30.0
        q21 = next(q for q in data2["question_stats"] if q["header"] == "2.1")
        assert q21["score_per_item"] == 30.0
        assert q21["avg_score_ratio"] == round((10.0 / 30.0 + 5.0 / 30.0) / 2, 4)

        # 6. Teacher clicks explicit recompute button
        r_recompute = web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={})
        assert r_recompute.status_code == 200
        assert r_recompute.json()["class_avg_ratio"] == data2["class_avg_ratio"]

        # 7. Teacher deletes batch
        r_del = web_client.delete(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r_del.status_code == 200
        assert r_del.json()["ok"] is True

        # 8. User queries deleted batch: returns 404 cleanly, not 500 error
        r_404 = web_client.get(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r_404.status_code == 404

    def test_user_graph_binding_auto_updates_score_and_diagnosis(self, web_client, tmp_path: Path) -> None:
        """Teacher binds a knowledge node in graph: score analysis immediately reflects node stats without recompute."""
        exam_id = "user-bind/数学"
        exam_dir = tmp_path / "exams" / "user-bind" / "数学"
        exam_dir.mkdir(parents=True)
        from tests.integration._helpers import write_exam_yaml
        write_exam_yaml(exam_dir, exam_id, [("选择题", 1, 5.0)])

        csv_text = "姓名,学号,1.1\n学生A,001,5\n"
        r_import = web_client.post(
            f"/api/exams/{exam_id}/scores",
            files={"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        batch_id = r_import.json()["batch_id"]

        # Initially unbound
        r1 = web_client.get(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r1.status_code == 200
        assert r1.json()["node_stats"] == []
        qid = r1.json()["question_stats"][0]["question_id"]

        # Teacher binds question in Knowledge Graph editor
        node_id = "math/user/quadratics"
        assert web_client.post(
            "/api/graph/nodes",
            json={"id": node_id, "canonical_name": "二次函数", "subject": "数学", "aliases": []},
        ).status_code == 200
        assert web_client.post(
            "/api/graph/bindings",
            json={"question_qualified_id": qid, "node_id": node_id},
        ).status_code == 200

        # Teacher returns to scores view: cache automatically invalidates to include the node
        r2 = web_client.get(f"/api/exams/{exam_id}/scores/{batch_id}")
        assert r2.status_code == 200
        assert len(r2.json()["node_stats"]) == 1
        assert r2.json()["node_stats"][0]["node_id"] == node_id
        assert r2.json()["node_stats"][0]["mastery_fuzzy"] == 1.0

    def test_user_dirty_csv_and_bom_tolerance(self, tmp_path: Path) -> None:
        """Realistic user CSV with UTF-8 BOM, blank rows, and unattempted questions."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "dirty-csv", score_per_item=5.0)

        # User exports from Excel with UTF-8 BOM and blank lines at the end
        dirty_csv = "\ufeff姓名,学号,1.1\n王五,2026003,4.0\n赵六,2026004,\n\n   \n"
        scores_path = workspace_dir(tmp_path, exam_id) / "scores" / batch_id / "scores.csv"
        scores_path.write_text(dirty_csv, encoding="utf-8-sig")

        # Cache should recompute cleanly and tolerate blank row + unattempted student
        analysis = get_score_analysis(tmp_path, exam_id, batch_id)
        assert analysis["student_count"] == 2
        s1 = analysis["student_stats"][0]
        s2 = analysis["student_stats"][1]
        assert s1["name"] == "王五"
        assert s1["score_ratio"] == 0.8
        assert s2["name"] == "赵六"
        assert s2["score_ratio"] == 0.0

    def test_user_excel_upload_and_analysis_workflow(self, tmp_path: Path) -> None:
        """Teacher uploads Excel workbook (.xlsx) directly from grading software."""
        import io
        import openpyxl

        exam_id, _ = _setup_exam_with_score(tmp_path, "excel-flow", score_per_item=5.0)

        # Build in-memory workbook
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "成绩表"
        ws.append(["姓名", "学号", "1.1"])
        ws.append(["钱七", "2026005", 5.0])
        ws.append(["孙八", "2026006", 2.5])
        bio = io.BytesIO()
        wb.save(bio)
        excel_bytes = bio.getvalue()

        # Import as .xlsx
        res = import_scores(tmp_path, exam_id, excel_bytes, "月考成绩.xlsx")
        excel_batch_id = res["batch_id"]

        # View analysis
        a1 = get_score_analysis(tmp_path, exam_id, excel_batch_id)
        assert a1["student_count"] == 2
        assert a1["student_stats"][0]["name"] == "钱七"
        assert a1["student_stats"][0]["score_ratio"] == 1.0
        assert a1["student_stats"][1]["name"] == "孙八"
        assert a1["student_stats"][1]["score_ratio"] == 0.5
        assert a1["class_avg_ratio"] == 0.75

        # Modify exam score_per_item to 10
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][0]["score_per_item"] = 10.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        # Re-fetch analysis: automatic invalidation
        a2 = get_score_analysis(tmp_path, exam_id, excel_batch_id)
        assert a2["student_stats"][0]["score_ratio"] == 0.5
        assert a2["student_stats"][1]["score_ratio"] == 0.25
        assert a2["class_avg_ratio"] == 0.375

    def test_user_score_overrides_workflow(self, tmp_path: Path) -> None:
        """Teacher sets individual question score overrides in exam section."""
        ensure_project_layout(tmp_path)
        selected = [
            {
                "section_id": "s1",
                "question_ids": ["q1", "q2"],
                "score_per_item": 5.0,
                "score_overrides": {"q2": 15.0},  # total = 5 + 15 = 20
            }
        ]
        saved = save_exam_workspace(
            tmp_path,
            exam_id=None,
            name="分值覆盖测试",
            subject=_SUBJ,
            export_label="overrides",
            template_ref="default",
            template_path="templates/default.yaml",
            selected_items=selected,
        )
        exam_id = saved["exam_id"]
        csv_data = "姓名,学号,1.1,1.2\n学生1,001,5,15\n"
        imported = import_scores(tmp_path, exam_id, csv_data.encode("utf-8"), "scores.csv")
        batch_id = imported["batch_id"]

        a1 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a1["question_stats"][0]["score_per_item"] == 5.0
        assert a1["question_stats"][1]["score_per_item"] == 15.0
        assert a1["student_stats"][0]["score_ratio"] == 1.0  # 20/20 = 1.0

        # Teacher updates override for q2 to 35.0 (total = 5 + 35 = 40)
        exam_yaml = workspace_dir(tmp_path, exam_id) / "exam.yaml"
        doc = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
        doc["selected_items"][0]["score_overrides"]["q2"] = 35.0
        exam_yaml.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

        a2 = get_score_analysis(tmp_path, exam_id, batch_id)
        assert a2["question_stats"][1]["score_per_item"] == 35.0
        assert a2["student_stats"][0]["score_ratio"] == 0.5  # 20/40 = 0.5

    def test_user_zero_point_question_tolerance(self, tmp_path: Path) -> None:
        """Exam has a question with score_per_item=0 (e.g. bonus / survey question)."""
        exam_id, batch_id = _setup_exam_with_score(tmp_path, "zero-pts", score_per_item=0.0, student_score=0.0)
        analysis = get_score_analysis(tmp_path, exam_id, batch_id)
        assert analysis["question_stats"][0]["score_per_item"] == 0.0
        assert analysis["question_stats"][0]["avg_score_ratio"] == 0.0

    def test_concurrent_user_reads(self, tmp_path: Path) -> None:
        """Simulate concurrent teachers or students requesting score analysis simultaneously."""
        import concurrent.futures

        exam_id, batch_id = _setup_exam_with_score(tmp_path, "concurrency", score_per_item=5.0)

        # Pre-warm
        get_score_analysis(tmp_path, exam_id, batch_id)

        def worker():
            return get_score_analysis(tmp_path, exam_id, batch_id)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker) for _ in range(20)]
            results = [f.result() for f in futures]

        # All 20 requests must succeed with identical valid data
        for r in results:
            assert r["class_avg_ratio"] == 1.0
            assert r["student_count"] == 1
            assert "_fingerprint" not in r
