from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from solaire.edu_analysis import storage
from solaire.edu_analysis import core
from solaire.edu_analysis import _request_index
from solaire.edu_analysis.storage import AnalysisStorage


def test_request_index_reads_legacy_without_rewriting_it(tmp_path: Path) -> None:
    root = tmp_path / "project"
    analysis = root / "result" / "edu_analysis"
    analysis.mkdir(parents=True)
    legacy = analysis / "request_index.json"
    original = '{"legacy-request":"job-legacy"}'
    legacy.write_text(original, encoding="utf-8")

    store = AnalysisStorage(root)
    assert store.get_job_for_request("legacy-request") == "job-legacy"
    store.bind_request_to_job("new-request", "job-new")

    assert store.get_job_for_request("new-request") == "job-new"
    assert store.get_job_for_request("legacy-request") == "job-legacy"
    assert legacy.read_text(encoding="utf-8") == original
    assert json.loads(legacy.read_text(encoding="utf-8")) == {"legacy-request": "job-legacy"}


def test_request_index_refreshes_changed_legacy_file_and_keeps_native_rows(tmp_path: Path) -> None:
    root = tmp_path / "project"
    analysis = root / "result" / "edu_analysis"
    analysis.mkdir(parents=True)
    legacy = analysis / "request_index.json"
    legacy.write_text('{"old":"job-old","overlap":"job-legacy"}', encoding="utf-8")
    store = AnalysisStorage(root)
    assert store.get_job_for_request("old") == "job-old"
    store.bind_request_to_job("overlap", "job-native")

    legacy.write_text('{"new":"job-new","overlap":"job-updated-legacy"}', encoding="utf-8")
    os.utime(legacy, ns=(legacy.stat().st_atime_ns, legacy.stat().st_mtime_ns + 2_000_000_000))

    assert store.get_job_for_request("old") is None
    assert store.get_job_for_request("new") == "job-new"
    assert store.get_job_for_request("overlap") == "job-native"


def test_legacy_cache_checks_exact_bytes_even_when_file_metadata_matches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "project"
    analysis = root / "result" / "edu_analysis"
    analysis.mkdir(parents=True)
    legacy = analysis / "request_index.json"
    legacy.write_text('{"request":"job-A"}', encoding="utf-8")
    store = AnalysisStorage(root)
    fixed_signature = _request_index._file_signature(legacy)
    real_signature = _request_index._file_signature
    monkeypatch.setattr(
        _request_index,
        "_file_signature",
        lambda path: fixed_signature if path == legacy else real_signature(path),
    )

    assert store.get_job_for_request("request") == "job-A"
    original = legacy.stat()
    legacy.write_text('{"request":"job-B"}', encoding="utf-8")
    os.utime(legacy, ns=(original.st_atime_ns, original.st_mtime_ns))
    assert legacy.stat().st_size == original.st_size
    assert legacy.stat().st_mtime_ns == original.st_mtime_ns

    assert store.get_job_for_request("request") == "job-B"


def test_request_index_claim_is_single_winner_for_concurrent_callers(tmp_path: Path) -> None:
    store = AnalysisStorage(tmp_path / "project")
    assert store.get_job_for_request("shared") is None

    with ThreadPoolExecutor(max_workers=12) as executor:
        winners = list(executor.map(
            lambda number: store.claim_request_for_job("shared", f"job-{number}"),
            range(24),
        ))

    assert len(set(winners)) == 1
    assert store.get_job_for_request("shared") == winners[0]


def test_json_replace_keeps_previous_file_after_partial_serialization_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "document.json"
    target.write_text('{"previous":true}', encoding="utf-8")

    def fail_dump(*args, **kwargs):
        raise OSError("simulated serialization failure")

    monkeypatch.setattr(storage.json, "dump", fail_dump)
    with pytest.raises(OSError, match="simulated serialization failure"):
        storage._write_json(target, {"next": True})

    assert target.read_text(encoding="utf-8") == '{"previous":true}'
    assert not [path for path in tmp_path.iterdir() if path.suffix == ".tmp"]


def test_save_output_writes_compact_json_in_bounded_c_encoded_chunks(tmp_path: Path) -> None:
    store = AnalysisStorage(tmp_path / "project")
    payload = {
        "summary": {"title": "学生成绩分析", "version": 1},
        "tables": [
            {
                "id": "student_mastery_rows",
                "rows": [
                    {
                        "student_id": f"s{index:04}",
                        "ratios": [((index * 17 + column * 13) % 1001) / 1000.0 for column in range(1920)],
                    }
                    for index in range(12)
                ],
            }
        ],
        "large_scalar_list": [index / 10 for index in range(5000)],
        "special_json_values": [None, True, -0.0, float("nan"), float("inf"), float("-inf")],
        "tuple_value": (1, "two", False),
        "mixed_keys": {None: "null", False: "false", 2.5: "float", "中文": "unicode"},
    }
    expected = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    reference = store.save_output("chunked", payload)

    path = store.root / reference
    assert path.read_bytes() == expected.encode("utf-8")
    loaded = store.load_output(reference)
    assert loaded["tables"][0]["rows"][11]["ratios"] == payload["tables"][0]["rows"][11]["ratios"]
    assert loaded["large_scalar_list"] == payload["large_scalar_list"]
    assert loaded["tuple_value"] == [1, "two", False]
    assert loaded["mixed_keys"] == {"null": "null", "false": "false", "2.5": "float", "中文": "unicode"}


def test_save_output_serialization_or_replace_failure_keeps_previous_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = AnalysisStorage(tmp_path / "project")
    path = store._file("outputs", "stable.json")
    path.write_text('{"previous":true}', encoding="utf-8")

    cycle: list[object] = []
    cyclic_payload = {"items": cycle}
    cycle.append(cyclic_payload)
    with pytest.raises(ValueError, match="Circular reference detected"):
        store.save_output("stable", cyclic_payload)
    assert path.read_text(encoding="utf-8") == '{"previous":true}'
    assert not [candidate for candidate in path.parent.iterdir() if candidate.suffix == ".tmp"]

    with pytest.raises(TypeError, match="Object of type object is not JSON serializable"):
        store.save_output("stable", {"unsupported": object()})
    assert path.read_text(encoding="utf-8") == '{"previous":true}'
    assert not [candidate for candidate in path.parent.iterdir() if candidate.suffix == ".tmp"]

    with pytest.raises(TypeError, match="keys must be str, int, float, bool or None"):
        store.save_output("stable", {object(): "unsupported key"})
    assert path.read_text(encoding="utf-8") == '{"previous":true}'
    assert not [candidate for candidate in path.parent.iterdir() if candidate.suffix == ".tmp"]

    def fail_replace(*args: object) -> None:
        raise OSError("simulated atomic replace failure")

    monkeypatch.setattr(storage.os, "replace", fail_replace)
    with pytest.raises(OSError, match="simulated atomic replace failure"):
        store.save_output("stable", {"next": True})
    assert path.read_text(encoding="utf-8") == '{"previous":true}'
    assert not [candidate for candidate in path.parent.iterdir() if candidate.suffix == ".tmp"]


def test_job_listing_keeps_top_k_order_and_corruption_behavior(tmp_path: Path) -> None:
    store = AnalysisStorage(tmp_path / "project")
    for job_id in ("older", "middle", "newest"):
        store.save_job({"job_id": job_id, "status": "succeeded"})
    jobs_directory = store._directory("jobs")
    for position, job_id in enumerate(("older", "middle", "newest"), start=1):
        path = jobs_directory / f"{job_id}.json"
        os.utime(path, (position, position))
    (jobs_directory / "broken.json").write_text("{bad json", encoding="utf-8")
    os.utime(jobs_directory / "broken.json", (4, 4))

    assert [job["job_id"] for job in store.list_jobs(limit=4)] == ["newest", "middle", "older"]
    assert [job["job_id"] for job in store.list_jobs(limit=3)] == ["newest", "middle"]
    assert [job["job_id"] for job in store.list_jobs(limit=2)] == ["newest"]
    assert [job["job_id"] for job in store.list_jobs(limit=1)] == []


def test_storage_rejects_path_components_in_user_ids(tmp_path: Path) -> None:
    store = AnalysisStorage(tmp_path / "project")
    with pytest.raises(ValueError, match="script ID"):
        store.save_script({"script_id": "../outside", "code": ""})


@pytest.mark.parametrize("entrypoint", ("builtin", "script"))
def test_request_claim_failure_removes_unregistered_pending_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entrypoint: str
) -> None:
    store = AnalysisStorage(tmp_path / "project")

    def fail_claim(self, request_id: str, job_id: str) -> str:
        raise OSError("simulated request-index commit failure")

    monkeypatch.setattr(AnalysisStorage, "claim_request_for_job", fail_claim)
    if entrypoint == "builtin":
        monkeypatch.setitem(core._DIAGNOSIS_BUILTIN_FNS, "builtin:test", lambda *_: {"nodes": []})
        invoke = lambda: core.run_builtin(
            store.project_root,
            builtin_id="builtin:test",
            exam_id="exam",
            batch_id="batch",
            request_id="request",
        )
    else:
        saved_script = core.save_script_doc(store.project_root, name="script", code="")
        script_id = saved_script["script"]["script_id"]
        invoke = lambda: core.run_script_with_request_id(
            store.project_root,
            script_id=script_id,
            exam_id="exam",
            batch_id="batch",
            request_id="request",
        )

    with pytest.raises(OSError, match="simulated request-index commit failure"):
        invoke()

    assert store.list_jobs() == []
    assert store.get_job_for_request("request") is None
