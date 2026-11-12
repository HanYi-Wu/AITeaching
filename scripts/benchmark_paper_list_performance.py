r"""Measure the backend paper-list read path on a disposable fixture.

The script intentionally creates its project and platform database below a
temporary directory.  It never opens or mutates a user's project.  Run it
with the source or release ``src`` first on ``PYTHONPATH`` to compare builds::

    $env:PYTHONPATH = 'E:\智教双创\1.7.2源码\src'
    E:\智教双创\1.7.2发布\.venv\Scripts\python.exe \
      E:\智教双创\1.7.2源码\scripts\benchmark_paper_list_performance.py

The JSON output is deliberately small so a performance-validation job can
parse it without scraping human-readable logs.
"""

from __future__ import annotations

import argparse
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import time

import yaml

from solaire.web import platform_db
from solaire.web.paper_service import query_papers


def _seed_teacher(root: Path) -> None:
    platform_db.init_platform_db(root)
    with closing(platform_db.connect(root)) as con, con:
        con.execute(
            """
            INSERT INTO users
              (id, role, username, password_hash, display_name, created_at, updated_at)
            VALUES ('benchmark-teacher', 'teacher', 'benchmark', 'hash', 'Benchmark', 'now', 'now')
            """
        )
        con.execute(
            """
            INSERT INTO content_folders
              (id, owner_teacher_id, scope, parent_id, kind, name, created_at, updated_at)
            VALUES ('paper-default-benchmark-teacher', 'benchmark-teacher', 'paper', NULL,
                    'category', 'Benchmark', 'now', 'now')
            """
        )


def _seed_exams(root: Path, count: int, questions: int) -> None:
    for index in range(count):
        exam_dir = root / "exams" / f"exam-{index:03d}" / "Math"
        exam_dir.mkdir(parents=True)
        payload = {
            "exam_id": f"exam-{index:03d}/Math",
            "template_ref": "benchmark/template",
            "metadata": {
                "title": f"Benchmark exam {index:03d}",
                "subject": "Math",
                "owner_teacher_id": "benchmark-teacher",
            },
            "selected_items": [
                {
                    "section_id": "section-1",
                    "question_ids": [f"q-{item:03d}" for item in range(questions)],
                    "score_per_item": 1,
                }
            ],
        }
        (exam_dir / "exam.yaml").write_text(
            yaml.safe_dump(payload, allow_unicode=True),
            encoding="utf-8",
        )


def _call(root: Path) -> int:
    result = query_papers(
        root,
        root,
        {"id": "benchmark-teacher", "role": "teacher"},
        page=1,
        page_size=10,
    )
    return int(result["total"])


def _milliseconds(fn) -> float:
    started = time.perf_counter()
    fn()
    return (time.perf_counter() - started) * 1000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=40, help="exam directories in the fixture")
    parser.add_argument("--questions", type=int, default=50, help="questions per exam")
    parser.add_argument("--repeat", type=int, default=10, help="sequential/concurrent calls")
    args = parser.parse_args()
    if args.count < 1 or args.questions < 1 or args.repeat < 1:
        parser.error("--count, --questions, and --repeat must be positive")

    with tempfile.TemporaryDirectory(prefix="solaire-paper-list-") as temp_dir:
        root = Path(temp_dir)
        _seed_teacher(root)
        _seed_exams(root, args.count, args.questions)

        cold_ms = _milliseconds(lambda: _call(root))
        sequential_ms = [_milliseconds(lambda: _call(root)) for _ in range(args.repeat)]
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.repeat) as pool:
            totals = list(pool.map(lambda _: _call(root), range(args.repeat)))
        concurrent_ms = (time.perf_counter() - started) * 1000
        expected_total = args.count
        if any(total != expected_total for total in totals):
            raise RuntimeError(f"unexpected paper totals: {totals!r}")

        output = {
            "fixture": {
                "exams": args.count,
                "questions_per_exam": args.questions,
                "repeat": args.repeat,
            },
            "cold_list_ms": round(cold_ms, 3),
            "sequential_list_ms": {
                "min": round(min(sequential_ms), 3),
                "median": round(sorted(sequential_ms)[len(sequential_ms) // 2], 3),
                "max": round(max(sequential_ms), 3),
            },
            "concurrent_list_ms": round(concurrent_ms, 3),
            "concurrent_total_ok": True,
        }
        print(json.dumps(output, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
