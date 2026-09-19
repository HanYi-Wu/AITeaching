from pathlib import Path

import pytest

from solaire.web import bank_folders
from solaire.web.bank_service import save_question
from solaire.exam_compiler.facade import QuestionItem


def test_nested_folders_move_rename_and_remove_preserve_question(tmp_path):
    qid = 'math/default/q1'
    save_question(tmp_path, qid, QuestionItem(id='q1', type='short_answer', content='hello', answer='yes'))
    before = {p: p.read_bytes() for p in (tmp_path / 'resource').rglob('*.yaml')}
    bank_folders.act(tmp_path, 'create', path='数学/函数')
    bank_folders.act(tmp_path, 'move', path='数学/函数', qualified_ids=[qid])
    bank_folders.act(tmp_path, 'rename', path='数学', target='复习')
    assert bank_folders.read(tmp_path)['assignments'][qid] == '复习/函数'
    bank_folders.act(tmp_path, 'remove', path='复习/函数')
    assert bank_folders.read(tmp_path)['assignments'][qid] == '复习'
    assert all(p.read_bytes() == data for p, data in before.items())
    assert bank_folders.read(tmp_path / 'other')['folders'] == []


def test_invalid_move_is_atomic(tmp_path):
    bank_folders.act(tmp_path, 'create', path='目录')
    with pytest.raises(ValueError):
        bank_folders.act(tmp_path, 'move', path='目录', qualified_ids=['not-found'])
    assert bank_folders.read(tmp_path)['assignments'] == {}
    for path in ['../bad', '/absolute', 'a//b', 'a/./b']:
        with pytest.raises(ValueError):
            bank_folders.act(tmp_path, 'create', path=path)


def test_move_folder_preserves_nested_assignments_and_rejects_cycles(tmp_path):
    qid = 'math/default/q1'
    save_question(tmp_path, qid, QuestionItem(id='q1', type='short_answer', content='hello', answer='yes'))
    bank_folders.act(tmp_path, 'create', path='a/child')
    bank_folders.act(tmp_path, 'create', path='b')
    bank_folders.act(tmp_path, 'move', path='a/child', qualified_ids=[qid])
    for destination in ['a', 'a/child', 'missing']:
        with pytest.raises(ValueError):
            bank_folders.act(tmp_path, 'move_folder', path='a', target=destination)
    bank_folders.act(tmp_path, 'move_folder', path='a', target='b')
    assert bank_folders.read(tmp_path)['assignments'][qid] == 'b/a/child'
    bank_folders.act(tmp_path, 'move_folder', path='b/a', target='')
    assert bank_folders.read(tmp_path)['assignments'][qid] == 'a/child'


def test_rename_cannot_merge_existing_folder_or_nest_inside_self(tmp_path):
    bank_folders.act(tmp_path, 'create', path='a')
    bank_folders.act(tmp_path, 'create', path='b')
    for target in ['b', 'a/child']:
        with pytest.raises(ValueError):
            bank_folders.act(tmp_path, 'rename', path='a', target=target)
    assert bank_folders.read(tmp_path)['folders'] == ['a', 'b']


def test_teachers_organize_shared_bank_independently(tmp_path):
    bank_folders.act(tmp_path, 'create', path='教师一目录', owner_id='teacher-1')
    assert bank_folders.read(tmp_path, owner_id='teacher-1')['folders'] == ['教师一目录']
    assert bank_folders.read(tmp_path, owner_id='teacher-2')['folders'] == []


def test_rename_validates_descendant_depth_before_changing_anything(tmp_path):
    bank_folders.act(tmp_path, 'create', path='a/b/c')
    before = bank_folders.read(tmp_path)
    with pytest.raises(ValueError):
        bank_folders.act(tmp_path, 'rename', path='a', target='/'.join(['n'] * 11))
    assert bank_folders.read(tmp_path) == before


def test_api_and_ai_share_authenticated_teacher_folders(web_client, tmp_path, monkeypatch):
    from tests.test_platform_student_api import _bootstrap_admin, _school_headers, _create_teacher_class_student, _teacher_headers
    from solaire.agent_layer.models import InvocationContext
    from solaire.agent_layer.tools.bank_tools import tool_bank_organize
    monkeypatch.setenv('SOLAIRE_PUBLIC_MODE', '1')
    admin = _bootstrap_admin(web_client)
    school, _ = _school_headers(web_client, admin)
    _create_teacher_class_student(web_client, school)
    headers = _teacher_headers(web_client)
    result = web_client.post('/api/bank/folders/actions', json={'action': 'create', 'path': '数学/函数'}, headers=headers)
    assert result.status_code == 200, result.text
    assert web_client.get('/api/bank/folders').status_code == 401
    assert web_client.get('/api/bank/folders', headers=school).status_code == 403
    assert web_client.get('/api/bank/folders', headers={'Authorization': f'Bearer {admin}'}).json()['folders'] == []
    user = web_client.get('/api/auth/me', headers=headers).json()['user']
    ctx = InvocationContext(project_root=tmp_path, session_id='folders', platform_user=user, public_mode=True)
    assert tool_bank_organize(ctx, {'action': 'list'}).data == result.json()
    assert tool_bank_organize(ctx, {'action': 'rename', 'path': '数学', 'target': '复习'}).status == 'succeeded'
    assert web_client.get('/api/bank/folders', headers=headers).json()['folders'] == ['复习', '复习/函数']
