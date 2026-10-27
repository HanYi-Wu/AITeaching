"""Result counts avoid materializing score rows or reading unused exam contents."""
import csv
from pathlib import Path
import tracemalloc

from solaire.web import agent_api
from solaire.web.results.batches import _list_score_batches


def test_assistant_exam_count_does_not_read_score_or_exam_contents(tmp_path, monkeypatch):
    for index in range(3):
        exam = tmp_path / "exams" / f"Quiz{index}" / "Math" / "exam.yaml"
        exam.parent.mkdir(parents=True)
        exam.write_text("exam_id: quiz\ntemplate_ref: t\nselected_items: []\n", encoding="utf-8")
        scores = exam.parent / "scores" / "batch" / "scores.csv"
        scores.parent.mkdir(parents=True)
        scores.write_text("姓名,学号,q1\nStudent,S1,5\n", encoding="utf-8")
    monkeypatch.setattr(agent_api, "list_graphs", lambda _root: [])
    opened = []
    original_open = Path.open
    def recorded_open(path, *args, **kwargs):
        opened.append(path)
        return original_open(path, *args, **kwargs)
    monkeypatch.setattr(Path, "open", recorded_open)
    assert agent_api._project_ctx(tmp_path)["exam_summary"] == "3 场考试记录"
    assert opened == []


def test_score_batch_count_streams_csv_records_with_quoted_newlines(tmp_path):
    batch = tmp_path / "scores" / "batch"
    batch.mkdir(parents=True)
    with (batch / "scores.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["姓名", "学号", "q1", "q2"])
        writer.writerow(["Student\nwith newline", "S1", 1, 2])
        writer.writerows((["Student", f"S{index}", 3, 4] for index in range(2, 50001)))
    tracemalloc.start()
    try:
        batches = _list_score_batches(tmp_path)
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert batches[0]["student_count"] == 50000
    assert batches[0]["question_count"] == 2
    assert peak < 2 * 1024 * 1024
