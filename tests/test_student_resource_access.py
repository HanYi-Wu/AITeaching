from tests.test_platform_student_api import _bootstrap_admin, _school_headers, _create_teacher_class_student, _teacher_headers, _write_online_exam, _headers


def test_student_sees_assigned_images_but_not_other_resources(web_client, tmp_path, monkeypatch):
    monkeypatch.setenv('SOLAIRE_PUBLIC_MODE', '1')
    admin = _bootstrap_admin(web_client)
    school, _ = _school_headers(web_client, admin)
    class_id, account = _create_teacher_class_student(web_client, school)
    _write_online_exam(tmp_path)
    source = tmp_path / 'resource/math/q1.yaml'
    import yaml
    question = yaml.safe_load(source.read_text(encoding='utf-8'))
    question['content'] += ' :::EMBED_IMG:math/page.png:::'
    source.write_text(yaml.safe_dump(question), encoding='utf-8')
    from PIL import Image
    for name in ('page.png', 'private.png'):
        Image.new('RGB', (10, 10)).save(tmp_path / 'resource/math' / name)
    teacher = _teacher_headers(web_client)
    paper = web_client.get('/api/papers', headers=teacher).json()['papers'][0]
    published = web_client.post(f"/api/papers/{paper['paper_id']}/publish", json={'class_ids':[class_id], 'title':'Images'}, headers=teacher)
    assert published.status_code == 200
    headers = _headers(web_client.post('/api/auth/login', json=account).json()['token'])
    publication = published.json()['publication']['id']
    assert web_client.post(f'/api/student/publications/{publication}/start', headers=headers).status_code == 200
    assert web_client.get('/api/resource/math/page.png', headers=headers).status_code == 200
    assert web_client.get('/api/resource/math/page.png').status_code == 401
    assert web_client.get('/api/resource/math/private.png', headers=headers).status_code == 403
