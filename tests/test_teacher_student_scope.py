import yaml

from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _write_exam, _headers, _teacher_token
from solaire.web.platform_db import connect, default_platform_root


def test_two_schools_cannot_read_or_change_each_others_paper_attempts(web_client, tmp_path):
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    first_school = _headers(web_client.post(
        "/api/auth/login", json={"username": "school_a", "password": "secret123"}
    ).json()["token"])
    imported = web_client.post(
        "/api/school/students/import", headers=first_school,
        json={"class_id": class_id, "students": [{"student_no": "P01", "display_name": "First"}]},
    )
    assert imported.status_code == 200
    _write_exam(tmp_path)
    exam_path = tmp_path / "exams/midterm/Math/exam.yaml"
    exam = yaml.safe_load(exam_path.read_text(encoding="utf-8"))
    exam["metadata"]["owner_teacher_id"] = teacher_id
    exam_path.write_text(yaml.safe_dump(exam, allow_unicode=True), encoding="utf-8")
    first_teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=first_teacher).json()["papers"][0]
    paper_id = paper["paper_id"]
    published = web_client.post(
        f"/api/papers/{paper_id}/publish", headers=first_teacher, json={"class_ids": [class_id]},
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]
    with connect(default_platform_root()) as con:
        attempt_before = dict(con.execute(
            "SELECT * FROM student_attempts WHERE publication_id = ?", (publication_id,)
        ).fetchone())
        attempt_id = attempt_before["id"]

    second_school = web_client.post(
        "/api/schools", headers=_headers(admin), json={"name": "Second School"}
    )
    assert second_school.status_code == 200
    second_school_id = second_school.json()["school"]["id"]
    account = web_client.post(
        f"/api/schools/{second_school_id}/school-users", headers=_headers(admin),
        json={"username": "school_b", "password": "secret123", "display_name": "Second school"},
    )
    assert account.status_code == 200
    second_admin = _headers(web_client.post(
        "/api/auth/login", json={"username": "school_b", "password": "secret123"}
    ).json()["token"])
    teacher = web_client.post(
        "/api/school/teachers", headers=second_admin,
        json={"username": "teacher_b", "password": "secret123", "display_name": "Second", "subjects": ["Math"]},
    )
    assert teacher.status_code == 200
    second_teacher = _headers(web_client.post(
        "/api/auth/login", json={"username": "teacher_b", "password": "secret123"}
    ).json()["token"])
    assert web_client.get("/api/papers", headers=second_teacher).json()["papers"] == []
    for suffix in ("publications", "submissions", "analysis"):
        assert web_client.get(f"/api/papers/{paper_id}/{suffix}", headers=second_teacher).status_code == 403
    base = f"/api/papers/{paper_id}/attempts/{attempt_id}"
    assert web_client.patch(
        f"{base}/answers/math/q1/grade", headers=second_teacher, json={"score": 1}
    ).status_code == 403
    assert web_client.post(f"{base}/complete-grading", headers=second_teacher).status_code == 403
    assert web_client.post(
        f"/api/papers/{paper_id}/publish", headers=second_teacher, json={"class_ids": [class_id]}
    ).status_code == 403
    publication_url = f"/api/papers/{paper_id}/publications/{publication_id}"
    assert web_client.patch(publication_url, headers=second_teacher, json={"status": "paused"}).status_code == 403
    assert web_client.delete(publication_url, headers=second_teacher).status_code == 403
    with connect(default_platform_root()) as con:
        attempt = dict(con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone())
        assert attempt["publication_id"] == publication_id
        assert attempt == attempt_before
        assert con.execute("SELECT COUNT(*) FROM student_answers WHERE attempt_id = ?", (attempt_id,)).fetchone()[0] == 0
        publications = con.execute("SELECT id, status FROM exam_publications WHERE paper_id = ?", (paper_id,)).fetchall()
        assert [(row["id"], row["status"]) for row in publications] == [(publication_id, "published")]


def test_shared_class_student_profile_excludes_other_teacher_exams(web_client, tmp_path):
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(web_client.post('/api/auth/login', json={'username':'school_a','password':'secret123'}).json()['token'])
    student = web_client.post('/api/school/students/import', headers=school, json={'class_id':class_id,'students':[{'student_no':'S01','display_name':'Shared student'}]}).json()['students'][0]
    second = web_client.post('/api/school/teachers', headers=school, json={'username':'teacher_two','password':'secret123','display_name':'Second','subjects':['Math']}).json()['teacher']
    web_client.post('/api/school/teacher-class-assignments', headers=school, json={'teacher_id':second['id'],'class_id':class_id,'subject':'Math'})
    _write_exam(tmp_path)
    exam_yaml = tmp_path / 'exams' / 'midterm' / 'Math' / 'exam.yaml'
    source = yaml.safe_load(exam_yaml.read_text(encoding='utf-8'))
    source['metadata']['owner_teacher_id'] = teacher_id
    exam_yaml.write_text(yaml.safe_dump(source, allow_unicode=True), encoding='utf-8')
    headers = _headers(_teacher_token(web_client))
    paper = web_client.get('/api/papers', headers=headers).json()['papers'][0]
    publication = web_client.post(f"/api/papers/{paper['paper_id']}/publish", headers=headers, json={'class_ids':[class_id]}).json()['publication']
    with connect(default_platform_root()) as con:
        con.execute("UPDATE student_attempts SET status='submitted',score=10,max_score=10,grading_completed_at='2026-09-18' WHERE publication_id=?", (publication['id'],))
        con.execute("INSERT INTO paper_records(id,exam_id,title,subject,owner_teacher_id,status,created_at,updated_at) VALUES('other-paper','other/Math','OTHER PAPER','Math',?,'published','2026-09-18','2026-09-18')", (second['id'],))
        con.execute("INSERT INTO exam_publications(id,paper_id,teacher_id,title,status,created_at,updated_at) VALUES('other','other-paper',?,?,'published','2026-09-18','2026-09-18')", (second['id'],'OTHER TEACHER'))
        con.execute("INSERT INTO publication_classes(publication_id,class_id) VALUES('other',?)", (class_id,))
        con.execute("INSERT INTO student_attempts(id,publication_id,student_id,status,score,max_score,grading_completed_at) VALUES('other-attempt','other',?,'submitted',0,10,'2026-09-18')", (student['id'],))
        con.execute("INSERT INTO student_answers(id,attempt_id,question_id,answer_payload,is_correct,score,grading_status,responded_at) VALUES('other-answer','other-attempt','FOREIGN QUESTION','{}',0,0,'reviewed','2026-09-18')")
    url = f"/api/teacher/classes/{class_id}/students/{student['id']}/profile"
    response = web_client.get(url, headers=headers)
    assert response.status_code == 200
    profile = response.json()['profile']
    assert profile['summary']['exam_count'] == 1
    assert profile['summary']['average_score_percent'] == 100
    assert 'FOREIGN QUESTION' not in str(profile)
    second_headers = _headers(web_client.post('/api/auth/login', json={'username':'teacher_two','password':'secret123'}).json()['token'])
    second_profile = web_client.get(url, headers=second_headers).json()['profile']
    assert second_profile['summary']['exam_count'] == 1
    assert second_profile['summary']['average_score_percent'] == 0
    assert second_profile['recent_exams'][0]['publication_id'] == 'other'
