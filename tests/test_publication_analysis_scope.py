from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _write_exam, _headers, _teacher_token
from solaire.web.platform_db import connect, default_platform_root


def test_republished_paper_analysis_selects_one_batch(web_client, tmp_path):
    admin = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin)
    school_token = web_client.post('/api/auth/login', json={'username':'school_a','password':'secret123'}).json()['token']
    response = web_client.post('/api/school/students/import', headers=_headers(school_token),
        json={'class_id': class_id, 'students': [{'student_no':'B01','display_name':'Batch student'}]})
    assert response.status_code == 200
    _write_exam(tmp_path)
    headers = _headers(_teacher_token(web_client))
    paper = web_client.get('/api/papers', headers=headers).json()['papers'][0]
    base = f"/api/papers/{paper['paper_id']}"
    first = web_client.post(base+'/publish', headers=headers, json={'class_ids':[class_id], 'title':'First'}).json()['publication']
    with connect(default_platform_root()) as con:
        con.execute("UPDATE exam_publications SET status='revoked', created_at='2020-01-01' WHERE id=?", (first['id'],))
    second = web_client.post(base+'/publish', headers=headers, json={'class_ids':[class_id], 'title':'Second'}).json()['publication']
    with connect(default_platform_root()) as con:
        con.execute("UPDATE student_attempts SET status='submitted', score=5, max_score=10 WHERE publication_id=?", (first['id'],))
        con.execute("UPDATE student_attempts SET status='submitted', score=9, max_score=10 WHERE publication_id=?", (second['id'],))
        for publication, score in [(first, 5), (second, 9)]:
            attempt = con.execute('SELECT id FROM student_attempts WHERE publication_id=?', (publication['id'],)).fetchone()
            con.execute("INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES (?, ?, 'math/q1', '{}', 0, ?, 'manual', '2026-09-16')", (publication['id'], attempt['id'], score))
    current = web_client.get(base+'/analysis', headers=headers).json()['analysis']
    assert current['publication_id'] == second['id']
    assert current['summary']['total_students'] == 1
    assert len(current['publications']) == 2
    assert current['summary']['average_score'] == 90
    older = web_client.get(base+'/analysis', params={'publication_id':first['id']}, headers=headers).json()['analysis']
    assert older['publication_id'] == first['id']
    assert older['summary']['total_students'] == 1
    assert older['summary']['average_score'] == 50
    assert web_client.get(base+'/analysis?publication_id=not-owned', headers=headers).status_code == 400
