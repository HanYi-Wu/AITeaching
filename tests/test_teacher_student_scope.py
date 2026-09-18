from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _write_exam, _headers, _teacher_token
from solaire.web.platform_db import connect, default_platform_root


def test_shared_class_student_profile_excludes_other_teacher_exams(web_client, tmp_path):
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(web_client.post('/api/auth/login', json={'username':'school_a','password':'secret123'}).json()['token'])
    student = web_client.post('/api/school/students/import', headers=school, json={'class_id':class_id,'students':[{'student_no':'S01','display_name':'Shared student'}]}).json()['students'][0]
    second = web_client.post('/api/school/teachers', headers=school, json={'username':'teacher_two','password':'secret123','display_name':'Second','subjects':['Math']}).json()['teacher']
    web_client.post('/api/school/teacher-class-assignments', headers=school, json={'teacher_id':second['id'],'class_id':class_id,'subject':'Math'})
    _write_exam(tmp_path)
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
