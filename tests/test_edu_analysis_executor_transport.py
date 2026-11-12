from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from solaire.edu_analysis import executor
from solaire.edu_analysis.contracts import (
    EXECUTOR_ALLOWED_IMPORTS,
    EXECUTOR_BLOCKED_IMPORT_PREFIXES,
    EXECUTOR_SAFE_BUILTINS,
)


def _rawdata(student_count: int, question_count: int) -> dict[str, Any]:
    return {
        "question_order": [f"q{i}" for i in range(question_count)],
        "student_mastery_rows": [
            {
                "student_id": f"s{student_index}",
                "ratios": [((student_index + question_index) % 100) / 100.0 for question_index in range(question_count)],
                "name": f"Student {student_index}",
            }
            for student_index in range(student_count)
        ],
        "student_stats": [{"student_id": f"s{student_index}"} for student_index in range(student_count)],
    }


def _execute(code: str, rawdata: dict[str, Any], *, timeout_seconds: int = 6) -> dict[str, Any]:
    return executor.execute_python_script(
        code,
        rawdata=rawdata,
        graph={"nodes": [], "edges": []},
        timeout_seconds=timeout_seconds,
        max_output_bytes=20000,
        max_cpu_seconds=timeout_seconds,
        max_memory_mb=256,
        safe_builtins=EXECUTOR_SAFE_BUILTINS,
        allowed_imports=EXECUTOR_ALLOWED_IMPORTS,
        blocked_import_prefixes=EXECUTOR_BLOCKED_IMPORT_PREFIXES,
    )


def test_ratio_sidecar_roundtrip_keeps_input_objects_and_mapping_order(tmp_path: Path) -> None:
    original = _rawdata(100, 1000)
    original_rows = original["student_mastery_rows"]
    original_row = original_rows[0]
    original_ratios = original_row["ratios"]
    compacted = executor._compact_student_ratio_rows(original)

    assert compacted is not None
    compact_rawdata, packed_values, manifest = compacted
    assert compact_rawdata is not original
    assert compact_rawdata["student_mastery_rows"] is not original_rows
    assert list(compact_rawdata) == list(original)
    assert list(compact_rawdata["student_mastery_rows"][0]) == list(original_row)
    assert compact_rawdata["student_mastery_rows"][0]["ratios"] is None
    assert original_rows[0] is original_row
    assert original_row["ratios"] is original_ratios

    sidecar = tmp_path / "ratios.bin"
    with sidecar.open("wb") as stream:
        packed_values.tofile(stream)
    request = {"rawdata": compact_rawdata, "graph": {}, "code": "", "_ratio_sidecar": manifest}
    executor._restore_ratio_sidecar(request, sidecar)

    assert request["rawdata"] == original
    assert list(request["rawdata"]["student_mastery_rows"][0]) == list(original_row)


def test_ratio_sidecar_skips_small_and_sparse_or_nonfinite_data() -> None:
    assert executor._compact_student_ratio_rows(_rawdata(20, 1000)) is None

    one_missing_per_row = _rawdata(200, 1000)
    for index, row in enumerate(one_missing_per_row["student_mastery_rows"]):
        row["ratios"][index] = None
    assert executor._compact_student_ratio_rows(one_missing_per_row) is None

    one_nonfinite = _rawdata(200, 1000)
    one_nonfinite["student_mastery_rows"][0]["ratios"][0] = float("nan")
    compacted = executor._compact_student_ratio_rows(one_nonfinite)
    assert compacted is not None
    compact_rawdata, _, manifest = compacted
    assert compact_rawdata["student_mastery_rows"][0]["ratios"][0] != compact_rawdata["student_mastery_rows"][0]["ratios"][0]
    assert manifest["value_count"] == 199_000


def test_ratio_sidecar_keeps_dense_rows_and_leaves_irregular_rows_in_json() -> None:
    rawdata = _rawdata(200, 1000)
    for row in rawdata["student_mastery_rows"][::10]:
        row["ratios"][0] = None

    compacted = executor._compact_student_ratio_rows(rawdata)
    assert compacted is not None
    compact_rawdata, packed_values, manifest = compacted
    assert manifest["value_count"] == 180_000
    assert len(manifest["rows"]) == 180
    assert compact_rawdata["student_mastery_rows"][0]["ratios"] == rawdata["student_mastery_rows"][0]["ratios"]
    assert compact_rawdata["student_mastery_rows"][1]["ratios"] is None
    assert len(packed_values) == 180_000


def test_ratio_sidecar_rejects_wrong_file_size(tmp_path: Path) -> None:
    compacted = executor._compact_student_ratio_rows(_rawdata(200, 1000))
    assert compacted is not None
    compact_rawdata, _, manifest = compacted
    sidecar = tmp_path / "ratios.bin"
    sidecar.write_bytes(b"short")
    request = {"rawdata": compact_rawdata, "_ratio_sidecar": manifest}

    with pytest.raises(ValueError, match="file size mismatch"):
        executor._restore_ratio_sidecar(request, sidecar)


def test_ratio_sidecar_requires_exact_integer_metadata_and_checks_file_digest(tmp_path: Path) -> None:
    compacted = executor._compact_student_ratio_rows(_rawdata(100, 1000))
    assert compacted is not None
    compact_rawdata, packed_values, manifest = compacted
    sidecar = tmp_path / "ratios.bin"
    with sidecar.open("wb") as stream:
        packed_values.tofile(stream)

    float_itemsize = {**manifest, "itemsize": float(manifest["itemsize"])}
    with pytest.raises(ValueError, match="item size mismatch"):
        executor._restore_ratio_sidecar(
            {"rawdata": compact_rawdata, "_ratio_sidecar": float_itemsize}, sidecar
        )

    boolean_count = {**manifest, "value_count": True}
    with pytest.raises(ValueError, match="manifest"):
        executor._restore_ratio_sidecar(
            {"rawdata": compact_rawdata, "_ratio_sidecar": boolean_count}, sidecar
        )

    non_finite_path = tmp_path / "non-finite.bin"
    import array

    corrupted = array.array("d", [float("nan")])
    non_finite_path.write_bytes(corrupted.tobytes() + bytes(sidecar.read_bytes()[8:]))
    with pytest.raises(ValueError, match="checksum mismatch"):
        executor._restore_ratio_sidecar(
            {"rawdata": compact_rawdata, "_ratio_sidecar": manifest}, non_finite_path
        )


def test_ratio_sidecar_accepts_legacy_request_shape_without_mutation(tmp_path: Path) -> None:
    legacy = {"rawdata": {"student_mastery_rows": []}, "graph": {}, "code": ""}
    rawdata = legacy["rawdata"]

    assert executor._restore_ratio_sidecar(legacy, tmp_path / "missing.bin") is None
    assert legacy == {"rawdata": rawdata, "graph": {}, "code": ""}
    assert legacy["rawdata"] is rawdata


def test_sandbox_reads_sidecar_and_keeps_json_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(executor.tempfile, "tempdir", str(tmp_path))
    large = _execute(
        "raw = get_rawdata(); RESULT = {'count': len(raw['student_mastery_rows']), 'is_list': isinstance(raw['student_mastery_rows'][0]['ratios'], list), 'last': raw['student_mastery_rows'][-1]['ratios'][-1]}",
        _rawdata(100, 1000),
    )
    assert large["status"] == "succeeded"
    assert large["result"] == {"count": 100, "is_list": True, "last": 0.98}

    small = _execute(
        "RESULT = get_rawdata()['student_mastery_rows'][0]['ratios'][0]",
        _rawdata(2, 10),
    )
    assert small["status"] == "succeeded"
    assert small["result"] == 0.0


def test_sandbox_timeout_and_policy_failures_keep_their_codes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(executor.tempfile, "tempdir", str(tmp_path))
    timeout = _execute("while True: pass", _rawdata(2, 10), timeout_seconds=1)
    assert timeout["status"] == "failed"
    assert timeout["error_code"] == "timeout"
    assert timeout["killed_reason"] == "timeout"

    blocked = _execute("import os", _rawdata(2, 10))
    assert blocked["status"] == "failed"
    assert blocked["error_code"] == "sandbox_violation"


def test_sandbox_keeps_irregular_json_rows_and_runtime_exceptions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(executor.tempfile, "tempdir", str(tmp_path))
    rawdata = _rawdata(2, 10)
    rawdata["student_mastery_rows"][0]["ratios"][0] = None
    rawdata["student_mastery_rows"][0]["ratios"][1] = "0.25"
    result = _execute(
        "RESULT = [get_rawdata()['student_mastery_rows'][0]['ratios'][0], get_rawdata()['student_mastery_rows'][0]['ratios'][1]]",
        rawdata,
    )
    assert result["status"] == "succeeded"
    assert result["result"] == [None, "0.25"]

    failed = _execute("raise ValueError('bad score row')", rawdata)
    assert failed["status"] == "failed"
    assert failed["error_code"] == "runtime_error"
    assert "bad score row" in failed["error"]
    assert "ValueError" in failed["traceback"]
