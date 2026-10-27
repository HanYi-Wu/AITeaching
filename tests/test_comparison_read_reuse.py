"""Class comparisons batch current source scores and reuse historical evidence."""
from solaire.web.learning_progress import compatibility, store
from solaire.web.learning_progress.comparison import get_practice_comparison
from solaire.web.learning_progress.sources import compute_online_source_snapshot_hash, compute_online_source_snapshot_hashes
from solaire.web.platform_db import connect
from tests.test_learning_progress_comparison import _setup_comparison_db


def test_comparison_batches_source_hashes_and_reads_frozen_baselines_once(tmp_path, monkeypatch):
    root, project = _setup_comparison_db(tmp_path)
    with connect(root) as con:
        con.execute("INSERT INTO exam_publications(id,paper_id,teacher_id,title,status,created_at,updated_at) VALUES ('source','paper-practice','u-tea','Source','closed','now','now')")
        for index in (1, 2):
            con.execute("INSERT INTO student_attempts(id,publication_id,student_id,status) VALUES (?, 'source', ?, 'submitted')", (f"attempt-{index}", f"stu-{index}"))
        con.execute("INSERT INTO student_answers(id,attempt_id,question_id,answer_payload,score,is_correct,responded_at) VALUES ('a1','attempt-1','q1','{}',2.5,0,'now')")
        pairs = [("source", "stu-1"), ("source", "stu-2"), ("source", "missing-student")]
        hashes = compute_online_source_snapshot_hashes(con, pairs)
        assert hashes == {pair: compute_online_source_snapshot_hash(con, *pair) for pair in pairs}
        store.record_practice_source(con, practice_publication_id="pub-prac-1", practice_kind="wrong_question", source_type="exam_publication", source_publication_id="source", captured_at="now")
        store.insert_frozen_baseline_items(con, items=[{
            "id": f"baseline-{index}", "practice_publication_id": "pub-prac-1", "student_id": f"stu-{index}",
            "source_type": "exam_publication", "source_ref_id": "source", "source_attempt_id": f"attempt-{index}",
            "source_question_id": "q1", "knowledge_node_id": "knowledge", "effective_score": 2.5,
            "effective_max_score": 5, "weight": 1, "raw_score": 2.5, "raw_max_score": 5,
            "rule_version": "v1_equal_split", "source_snapshot_hash": hashes[("source", f"stu-{index}")], "captured_at": "now",
        } for index in (1, 2)])

    statements = []
    for module in (compatibility, store):
        original = module.connect
        def traced(path, original=original):
            con = original(path)
            con.set_trace_callback(statements.append)
            return con
        monkeypatch.setattr(module, "connect", traced)
    result = get_practice_comparison(root, None, practice_publication_id="pub-prac-1")
    assert result["source_status"]["status"] == "valid"
    assert sum("FROM practice_frozen_baselines" in sql for sql in statements) == 1
    assert sum("ans.score, ans.is_correct" in sql for sql in statements) == 1

    with connect(root) as con:
        con.execute("UPDATE student_answers SET score=4 WHERE id='a1'")
    assert compatibility.get_authoritative_source_status(root, project, practice_publication_id="pub-prac-1")["status"] == "source_modified"
    assert compatibility.get_authoritative_source_status(root, project, practice_publication_id="pub-prac-1", allowed_student_ids={"stu-2"})["status"] == "valid"
    with connect(root) as con:
        con.execute("UPDATE exam_publications SET status='revoked' WHERE id='source'")
    assert compatibility.get_authoritative_source_status(root, project, practice_publication_id="pub-prac-1")["status"] == "source_missing"


def test_source_hash_batches_stay_below_sqlite_variable_limits(tmp_path):
    root, _project = _setup_comparison_db(tmp_path)
    pairs = [(f"source-{index}", "stu-1") for index in range(901)]
    statements = []
    with connect(root) as con:
        con.set_trace_callback(statements.append)
        hashes = compute_online_source_snapshot_hashes(con, pairs)
    assert len(hashes) == 901
    assert len(set(hashes.values())) == 1
    assert len(statements) == 3
