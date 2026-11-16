from tests.test_platform_student_api import _bootstrap_admin, _school_headers, _create_teacher_class_student, _teacher_headers


def test_teacher_initial_password_then_sequential_persistent_guide(web_client, monkeypatch):
    monkeypatch.setenv('SOLAIRE_PUBLIC_MODE', '1')
    admin = _bootstrap_admin(web_client)
    school, _ = _school_headers(web_client, admin)
    _create_teacher_class_student(web_client, school)
    headers = _teacher_headers(web_client)
    user = web_client.get('/api/auth/me', headers=headers).json()['user']
    assert user['must_change_password'] is True
    assert user['teacher_guide_step'] == 0
    assert web_client.post('/api/auth/teacher-guide', headers=headers, json={'step': 1}).status_code == 400
    changed = web_client.patch('/api/auth/account', headers=headers, json={'current_password': 'teacher123', 'new_password': 'TeacherNew156!'} )
    assert changed.status_code == 200, changed.text
    assert not changed.json()['user']['must_change_password']
    assert web_client.post('/api/auth/teacher-guide', headers=headers, json={'step': 2}).status_code == 400
    for step in range(1, 9):
        response = web_client.post('/api/auth/teacher-guide', headers=headers, json={'step': step})
        assert response.status_code == 200, response.text
        assert response.json()['user']['teacher_guide_step'] == step
    assert web_client.get('/api/auth/me', headers=headers).json()['user']['teacher_guide_step'] == 8
    assert web_client.post('/api/auth/teacher-guide', headers=school, json={'step': 0}).status_code == 403
    assert web_client.post('/api/auth/teacher-guide', headers=headers, json={'step': 0}).json()['user']['teacher_guide_step'] == 0
    assert web_client.post('/api/auth/teacher-guide', headers=headers, json={'step': 8}).json()['user']['teacher_guide_step'] == 8
