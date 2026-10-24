"""Compiler workspace exclusion across threads and operating-system processes."""

import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from solaire.web.export_lock import ExportBusyError, project_export_lock


def test_busy_thread_times_out_and_workspace_is_released(tmp_path):
    def contender():
        with project_export_lock(tmp_path, timeout=0.05):
            return "acquired"

    with ThreadPoolExecutor(max_workers=1) as pool:
        with project_export_lock(tmp_path):
            with pytest.raises(ExportBusyError):
                pool.submit(contender).result(timeout=3)
        assert pool.submit(contender).result(timeout=3) == "acquired"


def test_unrelated_projects_can_export_in_parallel(tmp_path):
    barrier = threading.Barrier(2)

    def worker(name):
        with project_export_lock(tmp_path / name):
            barrier.wait(timeout=3)
            return name

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker, name) for name in ("one", "two")]
        assert {future.result(timeout=5) for future in futures} == {"one", "two"}


def test_separate_process_cannot_enter_locked_workspace(tmp_path):
    code = """
import sys
from pathlib import Path
from solaire.web.export_lock import project_export_lock, ExportBusyError
try:
    with project_export_lock(Path(sys.argv[1]), timeout=0.05):
        print('acquired')
except ExportBusyError:
    print('busy')
"""
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).parents[1] / "src"), PYTHONUTF8="1")
    with project_export_lock(tmp_path):
        result = subprocess.run([sys.executable, "-c", code, str(tmp_path)], env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "busy"


def test_exception_does_not_leave_workspace_busy(tmp_path):
    with pytest.raises(ValueError):
        with project_export_lock(tmp_path):
            raise ValueError("compiler failure")
    with project_export_lock(tmp_path, timeout=0):
        pass
