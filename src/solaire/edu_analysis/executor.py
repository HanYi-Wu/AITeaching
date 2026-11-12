from __future__ import annotations

import array
import ast
import hashlib
import inspect
import json
import math
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from solaire.edu_analysis.ports import get_result_port

from . import charts as charts_module


_RATIO_SIDECAR_MIN_VALUES = 100_000
_RATIO_SIDECAR_SAMPLE_ROWS = 8
_RATIO_SIDECAR_MIN_COVERAGE_NUMERATOR = 3
_RATIO_SIDECAR_MIN_COVERAGE_DENOMINATOR = 4


def _is_compact_ratio_row(row: Any) -> bool:
    if type(row) is not dict:
        return False
    ratios = row.get("ratios")
    if type(ratios) is not list or not ratios:
        return False
    return all(type(value) is float and math.isfinite(value) for value in ratios)


def _compact_student_ratio_rows(rawdata: Any) -> tuple[dict[str, Any], array.array, dict[str, Any]] | None:
    """Build a copy with dense finite score rows represented by a binary sidecar."""
    if type(rawdata) is not dict:
        return None
    rows = rawdata.get("student_mastery_rows")
    if type(rows) is not list or not rows or array.array("d").itemsize != 8:
        return None

    ratio_slots = sum(
        len(ratios)
        for row in rows
        if type(row) is dict and type(ratios := row.get("ratios")) is list
    )
    if ratio_slots < _RATIO_SIDECAR_MIN_VALUES:
        return None

    sample_count = min(_RATIO_SIDECAR_SAMPLE_ROWS, len(rows))
    sample_indices = sorted(
        {
            0 if sample_count == 1 else index * (len(rows) - 1) // (sample_count - 1)
            for index in range(sample_count)
        }
    )
    compact_samples = sum(_is_compact_ratio_row(rows[index]) for index in sample_indices)
    if compact_samples * _RATIO_SIDECAR_MIN_COVERAGE_DENOMINATOR < (
        len(sample_indices) * _RATIO_SIDECAR_MIN_COVERAGE_NUMERATOR
    ):
        return None

    packed_values = array.array("d")
    compact_rows = list(rows)
    manifest_rows: list[list[int]] = []
    for row_index, row in enumerate(rows):
        if type(row) is not dict:
            continue
        ratios = row.get("ratios")
        if type(ratios) is not list or not ratios:
            continue

        offset = len(packed_values)
        for value in ratios:
            if type(value) is not float or not math.isfinite(value):
                del packed_values[offset:]
                break
            packed_values.append(value)
        else:
            row_copy = row.copy()
            row_copy["ratios"] = None
            compact_rows[row_index] = row_copy
            manifest_rows.append([row_index, len(ratios), offset])

    compact_value_count = len(packed_values)
    if compact_value_count * _RATIO_SIDECAR_MIN_COVERAGE_DENOMINATOR < (
        ratio_slots * _RATIO_SIDECAR_MIN_COVERAGE_NUMERATOR
    ):
        return None
    if compact_value_count < _RATIO_SIDECAR_MIN_VALUES:
        return None

    rawdata_copy = rawdata.copy()
    rawdata_copy["student_mastery_rows"] = compact_rows
    manifest = {
        "version": 1,
        "itemsize": packed_values.itemsize,
        "value_count": compact_value_count,
        "sha256": hashlib.sha256(packed_values).hexdigest(),
        "rows": manifest_rows,
    }
    return rawdata_copy, packed_values, manifest


def _restore_ratio_sidecar(request, sidecar_path) -> None:
    """Validate and restore numeric rows in the child before user code runs."""
    manifest = request.pop("_ratio_sidecar", None)
    if manifest is None:
        return

    import array as array_module
    import hashlib as hashlib_module
    import os
    from pathlib import Path

    if (
        type(manifest) is not dict
        or type(manifest.get("version")) is not int
        or manifest.get("version") != 1
    ):
        raise ValueError("unsupported numeric ratio sidecar")

    itemsize = array_module.array("d").itemsize
    rows = manifest.get("rows")
    value_count = manifest.get("value_count")
    expected_digest = manifest.get("sha256")
    if (
        itemsize != 8
        or type(manifest.get("itemsize")) is not int
        or manifest.get("itemsize") != itemsize
    ):
        raise ValueError("numeric ratio sidecar item size mismatch")
    if type(value_count) is not int or value_count <= 0 or type(rows) is not list or not rows:
        raise ValueError("invalid numeric ratio sidecar manifest")
    if type(expected_digest) is not str or len(expected_digest) != 64:
        raise ValueError("invalid numeric ratio sidecar digest")

    rawdata = request.get("rawdata")
    student_rows = rawdata.get("student_mastery_rows") if type(rawdata) is dict else None
    if type(student_rows) is not list or len(rows) > len(student_rows):
        raise ValueError("numeric ratio sidecar row list mismatch")

    parsed_rows = []
    expected_offset = 0
    previous_row_index = -1
    for entry in rows:
        if type(entry) is not list or len(entry) != 3:
            raise ValueError("invalid numeric ratio sidecar row entry")
        row_index, count, offset = entry
        if any(type(value) is not int for value in entry):
            raise ValueError("numeric ratio sidecar indices must be integers")
        if row_index <= previous_row_index or row_index < 0 or row_index >= len(student_rows):
            raise ValueError("numeric ratio sidecar row index out of range")
        if count <= 0 or offset != expected_offset:
            raise ValueError("numeric ratio sidecar offsets are inconsistent")
        row = student_rows[row_index]
        if type(row) is not dict or "ratios" not in row or row["ratios"] is not None:
            raise ValueError("numeric ratio sidecar placeholder mismatch")
        parsed_rows.append((row_index, count))
        expected_offset += count
        previous_row_index = row_index
    if expected_offset != value_count:
        raise ValueError("numeric ratio sidecar count mismatch")

    path = Path(sidecar_path)
    expected_bytes = value_count * itemsize
    digest = hashlib_module.sha256()
    with path.open("rb") as stream:
        if os.fstat(stream.fileno()).st_size != expected_bytes:
            raise ValueError("numeric ratio sidecar file size mismatch")
        for row_index, count in parsed_rows:
            row_values = array_module.array("d")
            row_values.fromfile(stream, count)
            if len(row_values) != count:
                raise ValueError("numeric ratio sidecar value count mismatch")
            digest.update(row_values)
            student_rows[row_index]["ratios"] = row_values.tolist()
        if stream.read(1):
            raise ValueError("numeric ratio sidecar contains trailing bytes")
    if digest.hexdigest() != expected_digest:
        raise ValueError("numeric ratio sidecar checksum mismatch")


def _truncate_text(s: str, limit: int = 20000) -> tuple[str, bool]:
    if len(s) <= limit:
        return s, False
    return s[:limit] + "\n...[truncated]", True


def build_graph_slice(rawdata: dict[str, Any]) -> dict[str, Any]:
    node_stats = rawdata.get("node_stats", [])
    if not isinstance(node_stats, list):
        return {"nodes": [], "edges": []}

    # Pass 1: Collect all valid node IDs
    node_ids: set[str] = set()
    for item in node_stats:
        if isinstance(item, dict):
            node_id = str(item.get("node_id") or "")
            if node_id:
                node_ids.add(node_id)

    # Pass 2: Connect parent-child hierarchy preserving deterministic order and deduplicating
    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str]] = set()
    for item in node_stats:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("node_id") or "")
        if not node_id:
            continue
        parent = node_id.rsplit("/", 1)[0] if "/" in node_id else ""
        if parent and parent in node_ids:
            edge_key = (parent, node_id)
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                edges.append({"from": parent, "to": node_id, "type": "part_of"})

    nodes = [{"id": nid} for nid in sorted(node_ids)]
    return {"nodes": nodes, "edges": edges}


def build_runtime_dataset(project_root: Path, exam_id: str, batch_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        port = get_result_port()
        raw = port.get_score_analysis(project_root, exam_id, batch_id)
        if not raw.get("question_stats"):
            raw = port.compute_statistics(project_root, exam_id, batch_id)
    except Exception:
        raw = {
            "exam_id": exam_id,
            "batch_id": batch_id,
            "student_count": 0,
            "question_count": 0,
            "question_stats": [],
            "node_stats": [],
            "student_stats": [],
            "warnings": [],
            "class_avg_ratio": 0.0,
            "class_avg_fuzzy": 0.0,
        }
    graph = build_graph_slice(raw)
    return raw, graph


def _validate_script_ast(
    code: str,
    *,
    blocked_import_prefixes: tuple[str, ...],
    allowed_imports: set[str],
) -> str | None:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"syntax error: {e.msg}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in blocked_import_prefixes:
                    return f"import '{alias.name}' is blocked"
                if root not in allowed_imports:
                    return f"import '{alias.name}' is not allowed"
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or "").split(".")[0]
            if mod in blocked_import_prefixes:
                return f"import from '{node.module}' is blocked"
            if mod and mod not in allowed_imports:
                return f"import from '{node.module}' is not allowed"
    return None


def _sandbox_runner() -> None:
    import builtins
    import contextlib
    import importlib.util
    import io
    import json
    import traceback
    from pathlib import Path

    policy = json.load(open("runtime_policy.json", "r", encoding="utf-8"))
    allowed_imports = set(policy.get("allowed_imports", []))
    safe_builtin_names = list(policy.get("safe_builtins", []))
    missing = [name for name in safe_builtin_names if not hasattr(builtins, name)]
    if missing:
        raise RuntimeError(f"safe builtins not found: {missing}")
    safe_builtins = {name: getattr(builtins, name) for name in safe_builtin_names}

    def guarded_import(name: str, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        if root not in allowed_imports:
            raise PermissionError(f"import '{name}' is not allowed")
        return __import__(name, globals, locals, fromlist, level)

    safe_builtins["__import__"] = guarded_import

    request = json.load(open("runtime_request.json", "r", encoding="utf-8"))
    try:
        _restore_ratio_sidecar(request, "runtime_ratios.bin")
    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_code": "runtime_error",
                    "error": str(e),
                    "stdout": "",
                    "stderr": "",
                },
                ensure_ascii=False,
            )
        )
        return
    rawdata = request["rawdata"]
    graph = request["graph"]
    charts_path = Path("runtime_charts.py").resolve()
    charts_spec = importlib.util.spec_from_file_location("runtime_charts", charts_path)
    if charts_spec is None or charts_spec.loader is None:
        raise RuntimeError("failed to load runtime_charts module")
    charts_mod = importlib.util.module_from_spec(charts_spec)
    charts_spec.loader.exec_module(charts_mod)
    base_chart = charts_mod.BaseChart
    histogram_chart = charts_mod.HistogramChart
    pie_chart = charts_mod.PieChart
    renderer_methods = (
        "to_payload",
        "get_picture",
        "to_payload_and_picture",
        "_series_points",
        "_payload_from_points",
        "_picture_from_points",
    )
    builtin_chart_renderers = {
        chart_type: tuple(getattr(chart_type, name) for name in renderer_methods)
        for chart_type in (histogram_chart, pie_chart)
    }

    ns = {"__builtins__": safe_builtins, "RESULT": None, "__name__": "__main__"}
    ns["BaseChart"] = base_chart
    ns["HistogramChart"] = histogram_chart
    ns["PieChart"] = pie_chart

    def get_rawdata():
        return rawdata

    def get_graph():
        return graph

    ns["get_rawdata"] = get_rawdata
    ns["get_graph"] = get_graph
    out = io.StringIO()
    err = io.StringIO()
    code = request["code"]
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(compile(code, "<user_script>", "exec"), ns, ns)
        result = ns.get("RESULT")
        payload = result
        picture = None
        result_kind = "value"
        if hasattr(result, "to_payload") and hasattr(result, "get_picture"):
            chart_type = type(result)
            expected_methods = builtin_chart_renderers.get(chart_type)
            current_methods = tuple(getattr(chart_type, name) for name in renderer_methods) if expected_methods else ()
            instance_methods = getattr(result, "__dict__", {})
            if expected_methods == current_methods and not any(name in instance_methods for name in renderer_methods):
                payload, picture = result.to_payload_and_picture()
            else:
                payload = result.to_payload()
                picture = result.get_picture()
            result_kind = "chart"
        elif isinstance(result, dict):
            result_kind = "dict"
        print(
            json.dumps(
                {
                    "status": "succeeded",
                    "result": payload,
                    "result_kind": result_kind,
                    "picture": picture,
                    "stdout": out.getvalue(),
                    "stderr": err.getvalue(),
                },
                ensure_ascii=False,
            )
        )
    except PermissionError as e:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_code": "sandbox_violation",
                    "error": str(e),
                    "stdout": out.getvalue(),
                    "stderr": err.getvalue(),
                },
                ensure_ascii=False,
            )
        )
    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_code": "runtime_error",
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                    "stdout": out.getvalue(),
                    "stderr": err.getvalue(),
                },
                ensure_ascii=False,
            )
        )


def _build_runner_source() -> str:
    restore_source = inspect.getsource(_restore_ratio_sidecar)
    function_source = inspect.getsource(_sandbox_runner)
    return f'{restore_source}\n\n{function_source}\n\nif __name__ == "__main__":\n    _sandbox_runner()\n'


def execute_python_script(
    code: str,
    *,
    rawdata: dict[str, Any],
    graph: dict[str, Any],
    timeout_seconds: int,
    max_output_bytes: int,
    max_cpu_seconds: int,
    max_memory_mb: int,
    safe_builtins: tuple[str, ...],
    allowed_imports: set[str],
    blocked_import_prefixes: tuple[str, ...],
) -> dict[str, Any]:
    ast_error = _validate_script_ast(
        code,
        blocked_import_prefixes=blocked_import_prefixes,
        allowed_imports=allowed_imports,
    )
    if ast_error:
        return {
            "status": "failed",
            "error_code": "sandbox_violation",
            "error": ast_error,
            "stdout": "",
            "stderr": "",
            "truncated": False,
            "killed_reason": "policy_violation",
            "limits_applied": {
                "timeout_seconds": timeout_seconds,
                "max_output_bytes": max_output_bytes,
                "max_cpu_seconds": max_cpu_seconds,
                "max_memory_mb": max_memory_mb,
            },
        }

    runner = _build_runner_source()

    with tempfile.TemporaryDirectory(prefix="edu_analysis_") as td:
        temp_dir = Path(td)
        shutil.copyfile(Path(charts_module.__file__), temp_dir / "runtime_charts.py")
        (temp_dir / "runtime_policy.json").write_text(
            json.dumps(
                {
                    "allowed_imports": sorted(allowed_imports),
                    "safe_builtins": list(safe_builtins),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        request_payload = {"rawdata": rawdata, "graph": graph, "code": code}
        compact_request = _compact_student_ratio_rows(rawdata)
        if compact_request is not None:
            compact_rawdata, packed_values, sidecar_manifest = compact_request
            try:
                with (temp_dir / "runtime_ratios.bin").open("wb") as stream:
                    packed_values.tofile(stream)
            except OSError:
                # The sidecar is an optional transport optimization.  A
                # temporary-file problem falls back to the original JSON shape.
                pass
            else:
                request_payload = {
                    "rawdata": compact_rawdata,
                    "graph": graph,
                    "code": code,
                    "_ratio_sidecar": sidecar_manifest,
                }
        (temp_dir / "runtime_request.json").write_text(
            json.dumps(request_payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        if compact_request is not None:
            del packed_values, compact_request, compact_rawdata, sidecar_manifest
        del request_payload
        try:
            p = subprocess.run(
                [sys.executable, "-I", "-X", "utf8", "-c", runner],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "status": "failed",
                "error_code": "timeout",
                "error": f"Script execution exceeded {timeout_seconds}s timeout",
                "stdout": "",
                "stderr": "",
                "truncated": False,
                "killed_reason": "timeout",
                "limits_applied": {
                    "timeout_seconds": timeout_seconds,
                    "max_output_bytes": max_output_bytes,
                    "max_cpu_seconds": max_cpu_seconds,
                    "max_memory_mb": max_memory_mb,
                },
            }

    raw = (p.stdout or "").strip()
    if not raw:
        return {
            "status": "failed",
            "error_code": "runtime_error",
            "error": "No output returned by runner",
            "stdout": "",
            "stderr": (p.stderr or ""),
            "truncated": False,
            "killed_reason": "runner_no_output",
            "limits_applied": {
                "timeout_seconds": timeout_seconds,
                "max_output_bytes": max_output_bytes,
                "max_cpu_seconds": max_cpu_seconds,
                "max_memory_mb": max_memory_mb,
            },
        }
    last_line = raw.splitlines()[-1]
    try:
        data = json.loads(last_line)
        if isinstance(data, dict):
            data["limits_applied"] = {
                "timeout_seconds": timeout_seconds,
                "max_output_bytes": max_output_bytes,
                "max_cpu_seconds": max_cpu_seconds,
                "max_memory_mb": max_memory_mb,
            }
            s_out = str(data.get("stdout", ""))
            s_err = str(data.get("stderr", ""))
            s_tb = str(data.get("traceback", "")) if "traceback" in data else ""
            merged = "\n".join([s_out, s_err, s_tb])
            if len(merged.encode("utf-8", errors="ignore")) > max_output_bytes:
                data["status"] = "failed"
                data["error_code"] = "resource_exceeded"
                data["error"] = f"output exceeds {max_output_bytes} bytes limit"
                data["killed_reason"] = "output_limit"
                data["truncated"] = True
            o1, t1 = _truncate_text(s_out, max_output_bytes)
            o2, t2 = _truncate_text(s_err, max_output_bytes)
            data["stdout"] = o1
            data["stderr"] = o2
            data["truncated"] = bool(data.get("truncated")) or t1 or t2
            if "traceback" in data:
                tb, tt = _truncate_text(str(data["traceback"]), max_output_bytes)
                data["traceback"] = tb
                data["truncated"] = bool(data.get("truncated")) or tt
            data.setdefault("killed_reason", None)
            return data
    except Exception:
        pass
    return {
        "status": "failed",
        "error_code": "runtime_error",
        "error": "Invalid runner output",
        "stdout": raw,
        "stderr": p.stderr or "",
        "truncated": False,
        "killed_reason": "runner_output_parse_error",
        "limits_applied": {
            "timeout_seconds": timeout_seconds,
            "max_output_bytes": max_output_bytes,
            "max_cpu_seconds": max_cpu_seconds,
            "max_memory_mb": max_memory_mb,
        },
    }
