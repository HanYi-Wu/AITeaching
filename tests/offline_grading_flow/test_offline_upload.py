"""Regression tests for offline upload limits and transactional rechecks."""

from __future__ import annotations

import asyncio
import io
import threading
from concurrent.futures import CancelledError, ThreadPoolExecutor
from pathlib import Path
from typing import Any

import anyio
import pytest
import yaml
from fastapi import HTTPException
from PIL import Image, ImageDraw
from starlette.datastructures import UploadFile

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web import paper_service, platform_db
from solaire.web.papers import api_routes, api_support
from solaire.web.project_layout import ensure_project_layout

@pytest.fixture
def offline_flow_env(tmp_path: Path) -> dict[str, Any]:
    data_root = tmp_path / "data_root"
    project_root = tmp_path / "project_root"
    data_root.mkdir(parents=True, exist_ok=True)
    project_root.mkdir(parents=True, exist_ok=True)
    ensure_project_layout(project_root)

    platform_db.init_platform_db(data_root)
    now = paper_service.utc_now()
    school_id = "school_flow_1"
    teacher = {
        "id": "teacher_flow_1",
        "school_id": school_id,
        "username": "teacher_flow",
        "display_name": "王老师",
        "role": "teacher",
    }
    class_id = "class_flow_1"
    paper_id = "paper_flow_1"
    exam_id = "flow_exam/Math"

    # Setup exam with 3 subjective questions
    lib_dir = project_root / "resource" / "math"
    lib_dir.mkdir(parents=True, exist_ok=True)
    q_ids = []
    for i in (1, 2, 3):
        qid = f"q_{i:02d}"
        q_ids.append(f"math/{qid}")
        (lib_dir / f"{qid}.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": qid,
                    "type": "short_answer",
                    "header": f"第 {i} 题",
                    "content": f"题目内容 {i}",
                    "answer": f"参考答案 {i}",
                },
                allow_unicode=True,
            ),
            encoding="utf-8",
        )

    exam_dir = project_root / "exams" / "flow_exam" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam_cfg = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "线下测试卷", "subject": "Math", "export_label": "flow_exam"},
        question_libraries=[QuestionLibraryRef(namespace="math", path="../../../resource/math")],
        template_path="templates/test.yaml",
        selected_items=[SelectedSection(section_id="sec1", question_ids=q_ids, score_per_item=10.0)],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam_cfg.model_dump(mode="json"), f, allow_unicode=True)

    with platform_db.connect(data_root) as con, con:
        con.execute(
            "INSERT INTO schools (id, name, status, created_at, updated_at) VALUES (?, '第一中学', 'active', ?, ?)",
            (school_id, now, now),
        )
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, 'teacher', ?, 'hash', ?, 'active', ?, ?)",
            (teacher["id"], school_id, teacher["username"], teacher["display_name"], now, now),
        )
        con.execute(
            "INSERT INTO classes (id, school_id, name, grade, subject_hint, created_at, updated_at) VALUES (?, ?, '高三(2)班', '高三', 'Math', ?, ?)",
            (class_id, school_id, now, now),
        )
        con.execute(
            "INSERT INTO teacher_class_assignments (teacher_id, class_id, subject) VALUES (?, ?, 'Math')",
            (teacher["id"], class_id),
        )
        # Student 1
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, created_at, updated_at) VALUES ('user_s1', ?, 'student', 'stu01', 'h', '学生甲', 'active', ?, ?)",
            (school_id, now, now),
        )
        con.execute(
            "INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at) VALUES ('stu_1', ?, 'user_s1', '20260101', '学生甲', 'active', ?, ?)",
            (school_id, now, now),
        )
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES (?, 'stu_1')", (class_id,))

        # Student 2
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, created_at, updated_at) VALUES ('user_s2', ?, 'student', 'stu02', 'h', '学生乙', 'active', ?, ?)",
            (school_id, now, now),
        )
        con.execute(
            "INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at) VALUES ('stu_2', ?, 'user_s2', '20260102', '学生乙', 'active', ?, ?)",
            (school_id, now, now),
        )
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES (?, 'stu_2')", (class_id,))

        con.execute(
            "INSERT INTO paper_records (id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at) VALUES (?, ?, '线下测试卷', 'Math', 'offline', ?, ?, 'draft', ?, ?)",
            (paper_id, exam_id, teacher["id"], school_id, now, now),
        )

    return {
        "data_root": data_root,
        "project_root": project_root,
        "teacher": teacher,
        "class_id": class_id,
        "paper_id": paper_id,
        "exam_id": exam_id,
        "students": [{"id": "stu_1", "student_no": "20260101"}, {"id": "stu_2", "student_no": "20260102"}],
    }



def scan_bytes() -> bytes:
    image = Image.new("RGB", (600, 600), "white")
    draw = ImageDraw.Draw(image)
    for y in range(20, 590, 12):
        draw.line([(10, y), (590, y + 4)], fill=(20, 30, 40), width=2)
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, size=len(content))


def test_png_fast_pass_retries_original_compression_at_page_limit():
    data = scan_bytes()
    _, _, fast = api_support._normalize_offline_scan("scan.png", data)
    assert len(fast) > len(data)
    limit = (len(fast) + len(data)) // 2
    _, mime, bounded = api_support._normalize_offline_scan("scan.png", data, max_output_bytes=limit)
    assert mime == "image/png"
    assert len(bounded) <= limit
    with Image.open(io.BytesIO(data)) as original, Image.open(io.BytesIO(bounded)) as actual:
        assert original.mode == actual.mode
        assert original.tobytes() == actual.tobytes()


def test_total_limit_recompresses_prior_pages_before_rejection(monkeypatch):
    data = scan_bytes()
    _, _, fast = api_support._normalize_offline_scan("scan.png", data)
    limit = len(data) * 2 + 100
    assert len(fast) * 2 > limit
    monkeypatch.setattr(api_routes, "OFFLINE_SCAN_MAX_TOTAL_BYTES", limit)
    pages = api_routes._read_and_normalize_offline_scans([upload("1.png", data), upload("2.png", data)])
    assert [page["name"] for page in pages] == ["1.png", "2.png"]
    assert sum(len(page["content"]) for page in pages) <= limit
    for page in pages:
        with Image.open(io.BytesIO(page["content"])) as decoded, Image.open(io.BytesIO(data)) as original:
            assert decoded.tobytes() == original.tobytes()


def test_rejects_unauthorized_request_before_reading_upload(monkeypatch, offline_flow_env):
    env = offline_flow_env
    monkeypatch.setattr(api_routes, "require_platform_root", lambda: env["data_root"])
    monkeypatch.setattr(api_routes, "require_content_project_root", lambda: env["project_root"])
    class NoRead(io.BytesIO):
        def read(self, *_args):
            raise AssertionError("unauthorized upload must not be read")
    file = UploadFile(file=NoRead(b"data"), filename="scan.png", size=4)
    denied = {**env["teacher"], "id": "not_the_owner"}
    with pytest.raises(HTTPException) as error:
        asyncio.run(api_routes.papers_offline_submission_upload(
            env["paper_id"], denied, env["class_id"], "stu_1", [file],
        ))
    assert error.value.status_code == 403


def test_rechecks_class_permission_after_snapshot_read(monkeypatch, offline_flow_env):
    env = offline_flow_env
    original = paper_service._paper_exam_question_payloads
    def revoke(project_root, paper):
        result = original(project_root, paper)
        with platform_db.connect(env["data_root"]) as con:
            con.execute("DELETE FROM teacher_class_assignments WHERE teacher_id = ? AND class_id = ?", (env["teacher"]["id"], env["class_id"]))
        return result
    monkeypatch.setattr(paper_service, "_paper_exam_question_payloads", revoke)
    with pytest.raises(PermissionError):
        paper_service.ingest_offline_submission(
            env["data_root"], env["project_root"], paper_id=env["paper_id"],
            class_id=env["class_id"], student_id="stu_1", user=env["teacher"],
            files=[{"name": "1.png", "mime_type": "image/png", "content": scan_bytes()}],
        )
    with platform_db.connect(env["data_root"]) as con:
        assert con.execute("SELECT COUNT(*) FROM student_attempts").fetchone()[0] == 0


def test_rechecks_grading_after_snapshot_read(monkeypatch, offline_flow_env):
    env = offline_flow_env
    kwargs = dict(paper_id=env["paper_id"], class_id=env["class_id"], student_id="stu_1", user=env["teacher"])
    first = [{"name": "first.png", "mime_type": "image/png", "content": scan_bytes()}]
    attempt = paper_service.ingest_offline_submission(env["data_root"], env["project_root"], files=first, **kwargs)
    original = paper_service._paper_exam_question_payloads
    def grade(project_root, paper):
        result = original(project_root, paper)
        with platform_db.connect(env["data_root"]) as con:
            con.execute("UPDATE student_answers SET score = 1 WHERE attempt_id = ?", (attempt["attempt_id"],))
        return result
    monkeypatch.setattr(paper_service, "_paper_exam_question_payloads", grade)
    with pytest.raises(ValueError, match="已进入批改流程"):
        paper_service.ingest_offline_submission(env["data_root"], env["project_root"], files=first, **kwargs)
    with platform_db.connect(env["data_root"]) as con:
        assert con.execute("SELECT file_name FROM attempt_scan_images WHERE attempt_id = ?", (attempt["attempt_id"],)).fetchone()[0] == "first.png"


def test_offline_student_id_is_trimmed_consistently(offline_flow_env):
    env = offline_flow_env
    result = paper_service.ingest_offline_submission(
        env["data_root"], env["project_root"], paper_id=env["paper_id"],
        class_id=env["class_id"], student_id=" stu_1 ", user=env["teacher"],
        files=[{"name": "1.png", "mime_type": "image/png", "content": scan_bytes()}],
    )
    assert result["student_id"] == "stu_1"
    with platform_db.connect(env["data_root"]) as con:
        row = con.execute("SELECT student_id FROM student_attempts WHERE id = ?", (result["attempt_id"],)).fetchone()
        assert row["student_id"] == "stu_1"


def test_running_upload_finishes_before_cancelled_request_closes_files():
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    def work():
        started.set()
        assert release.wait(5)
        finished.set()
        return {"ok": True}
    async def exercise():
        job = api_routes._scan_upload_pool.submit(work)
        task = asyncio.create_task(api_routes._await_scan_upload(job))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            task.cancel()
            await asyncio.sleep(0.02)
            assert not task.done()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert finished.is_set()
        finally:
            release.set()
    asyncio.run(exercise())


def test_cancelled_queued_upload_never_reads_its_files():
    occupied = threading.Event()
    release = threading.Event()
    ran = threading.Event()
    def block_worker():
        occupied.set()
        assert release.wait(5)
        return {}
    async def exercise():
        first = api_routes._scan_upload_pool.submit(block_worker)
        try:
            assert await asyncio.to_thread(occupied.wait, 5)
            second = api_routes._scan_upload_pool.submit(lambda: ran.set() or {})
            task = asyncio.create_task(api_routes._await_scan_upload(second))
            await asyncio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert second.cancelled()
            release.set()
            await asyncio.wrap_future(first)
            assert not ran.is_set()
        finally:
            release.set()
    asyncio.run(exercise())


def test_anyio_cancel_scope_waits_for_running_worker():
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    stopped = threading.Event()
    def work():
        started.set()
        assert release.wait(5)
        finished.set()
        return {}
    async def run():
        job = api_routes._scan_upload_pool.submit(work)
        async def await_job():
            try:
                await api_routes._await_scan_upload(job)
            except asyncio.CancelledError:
                stopped.set()
        try:
            async with anyio.create_task_group() as group:
                group.start_soon(await_job)
                assert await asyncio.to_thread(started.wait, 5)
                group.cancel_scope.cancel()
                with anyio.CancelScope(shield=True):
                    await anyio.sleep(0.02)
                    assert not stopped.is_set()
                    release.set()
            assert finished.is_set()
            assert stopped.is_set()
        finally:
            release.set()
    anyio.run(run)


def test_cancel_during_scan_normalization_skips_ingest_and_waits_for_upload_file(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    ingest_called = threading.Event()
    cancel_event = threading.Event()
    file = upload("scan.png", b"raw")

    def normalize(name, _content, *, max_output_bytes=None):
        started.set()
        assert release.wait(5)
        return name, "image/png", b"normalized"

    def ingest(*_args, **_kwargs):
        ingest_called.set()
        raise AssertionError("cancelled normalization must not start database ingest")

    monkeypatch.setattr(api_routes, "_normalize_offline_scan", normalize)
    monkeypatch.setattr(api_routes, "ingest_offline_submission", ingest)

    async def exercise():
        job = api_routes._scan_upload_pool.submit(
            api_routes._ingest_offline_scans, [file], Path("unused"), Path("unused"),
            "paper", "class", "student", {"role": "teacher"}, cancel_event,
        )
        task = asyncio.create_task(api_routes._await_scan_upload(job, cancel_event))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            task.cancel()
            await asyncio.sleep(0.02)
            assert cancel_event.is_set()
            assert not task.done()
            assert not file.file.closed
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert not ingest_called.is_set()
            assert not file.file.closed
        finally:
            release.set()

    try:
        asyncio.run(exercise())
    finally:
        file.file.close()


def test_cancel_rechecked_inside_transaction_before_any_database_write(monkeypatch, offline_flow_env):
    env = offline_flow_env
    cancel_event = threading.Event()
    original = paper_service._offline_upload_context

    def cancel_during_atomic_recheck(con, **kwargs):
        result = original(con, **kwargs)
        if con.in_transaction:
            cancel_event.set()
        return result

    monkeypatch.setattr(paper_service, "_offline_upload_context", cancel_during_atomic_recheck)
    with pytest.raises(CancelledError):
        paper_service.ingest_offline_submission(
            env["data_root"], env["project_root"], paper_id=env["paper_id"],
            class_id=env["class_id"], student_id="stu_1", user=env["teacher"],
            files=[{"name": "1.png", "mime_type": "image/png", "content": scan_bytes()}],
            cancel_event=cancel_event,
        )
    with platform_db.connect(env["data_root"]) as con:
        assert con.execute("SELECT COUNT(*) FROM student_attempts").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM attempt_scan_images").fetchone()[0] == 0


def test_cancellation_after_first_transaction_write_commits_complete_attempt(monkeypatch, offline_flow_env):
    env = offline_flow_env
    cancel_event = threading.Event()
    inside_first_write = threading.Event()
    release = threading.Event()
    original = paper_service.freeze_attempt_class_memberships

    def pause_after_attempt_insert(con, attempt_ids, *, captured_at):
        inside_first_write.set()
        assert release.wait(5)
        return original(con, attempt_ids, captured_at=captured_at)

    monkeypatch.setattr(paper_service, "freeze_attempt_class_memberships", pause_after_attempt_insert)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            paper_service.ingest_offline_submission,
            env["data_root"], env["project_root"], paper_id=env["paper_id"],
            class_id=env["class_id"], student_id="stu_1", user=env["teacher"],
            files=[{"name": "1.png", "mime_type": "image/png", "content": scan_bytes()}],
            cancel_event=cancel_event,
        )
        try:
            assert inside_first_write.wait(5)
            cancel_event.set()
            release.set()
            attempt = future.result(timeout=5)
        finally:
            release.set()
    with platform_db.connect(env["data_root"]) as con:
        row = con.execute("SELECT status FROM student_attempts WHERE id = ?", (attempt["attempt_id"],)).fetchone()
        assert row["status"] == "submitted"
        assert con.execute("SELECT COUNT(*) FROM attempt_scan_images WHERE attempt_id = ?", (attempt["attempt_id"],)).fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM student_answers WHERE attempt_id = ?", (attempt["attempt_id"],)).fetchone()[0] == 3


def test_offline_upload_byte_limits_remain_fixed():
    assert api_routes.OFFLINE_SCAN_MAX_FILE_BYTES == 15 * 1024 * 1024
    assert api_routes.OFFLINE_SCAN_MAX_TOTAL_BYTES == 100 * 1024 * 1024


def test_raw_page_and_normalized_total_limits_are_enforced(monkeypatch):
    monkeypatch.setattr(api_routes, "OFFLINE_SCAN_MAX_FILE_BYTES", 4)
    with pytest.raises(HTTPException) as page_error:
        api_routes._read_and_normalize_offline_scans([upload("large.png", b"12345")])
    assert page_error.value.status_code == 413

    monkeypatch.setattr(api_routes, "OFFLINE_SCAN_MAX_TOTAL_BYTES", 5)
    monkeypatch.setattr(api_routes, "_normalize_offline_scan", lambda name, _raw, **_kwargs: (name, "image/png", b"123"))
    monkeypatch.setattr(api_routes, "_optimize_normalized_png", lambda content: content)
    with pytest.raises(HTTPException) as total_error:
        api_routes._read_and_normalize_offline_scans([upload("one.png", b"1"), upload("two.png", b"2")])
    assert total_error.value.status_code == 413
