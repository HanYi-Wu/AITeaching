"""Adapter implementing edu_analysis.ports.ResultDataPort."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.results.statistics import compute_statistics, get_score_analysis
from solaire.web.results.summary import list_exam_results


class ResultServiceAdapter:
    """Adapter that implements edu_analysis.ports.ResultDataPort using results functions.

    web 层在应用启动时将此类实例注入 edu_analysis：
        from solaire.edu_analysis.ports import configure
        configure(result_port=ResultServiceAdapter())
    """

    def list_exam_results(self, project_root: Path) -> list[dict[str, Any]]:
        return list_exam_results(project_root)

    def compute_statistics(
        self, project_root: Path, exam_id: str, batch_id: str
    ) -> dict[str, Any]:
        return compute_statistics(project_root, exam_id, batch_id)

    def get_score_analysis(
        self, project_root: Path, exam_id: str, batch_id: str
    ) -> dict[str, Any]:
        return get_score_analysis(project_root, exam_id, batch_id)
