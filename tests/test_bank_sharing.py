from contextlib import contextmanager
from pathlib import Path

import pytest

from solaire.common.actor_context import actor, teacher_key
from solaire.exam_compiler.facade import QuestionItem
from solaire.web import bank_folders, bank_sharing
from solaire.web.bank_service import get_question_detail, list_bank_entries, save_question
from solaire.web.teacher_bank import bank_resource_root


@contextmanager
def teacher(identifier):
    token = actor.set({'id': identifier, 'role': 'teacher'})
    try: yield
    finally: actor.reset(token)


def prepare(root, monkeypatch):
    monkeypatch.setattr(bank_sharing, 'default_platform_root', lambda: root / 'platform')
    with teacher('teacher1'):
        image = bank_resource_root(root) / 'math/default/image/test.png'
        image.parent.mkdir(parents=True)
        image.write_bytes(b'test-image')
        answer = ':::ANSWER_LOGIC:{"op":"or","items":[{"op":"value","value":"a"},{"op":"value","value":"b"}]}'
        save_question(root, 'math/default/q1', QuestionItem(id='q1', type='short_answer', content=f':::EMBED_IMG:__teachers/{teacher_key()}/math/default/image/test.png:::', answer=answer))
        bank_folders.act(root, 'create', path='父/分享/子', owner_id='teacher1')
        bank_folders.act(root, 'move', path='父/分享/子', qualified_ids=['math/default/q1'], owner_id='teacher1')
        return bank_sharing.create(root, '父/分享')['code']


def test_snapshot_copies_subfolders_images_and_answers_without_source_access(tmp_path, monkeypatch):
    code = prepare(tmp_path, monkeypatch)
    with teacher('teacher1'):
        source = get_question_detail(tmp_path, 'math/default/q1')['question']
        save_question(tmp_path, 'math/default/q1', QuestionItem(id='q1', type='short_answer', content='later edit', answer='other'))
    with teacher('teacher2'):
        result = bank_sharing.redeem(tmp_path, code)
        assert result['folders'] == ['分享', '分享/子']
        assert result['question_count'] == 1
        qid = list_bank_entries(tmp_path)[0]['qualified_id']
        assert qid.startswith('math/')
        assert result['assignments'][qid] == '分享/子'
        copied = get_question_detail(tmp_path, qid)['question']
        assert copied['answer'] == source['answer']
        assert teacher_key() in copied['content']
        assert next(bank_resource_root(tmp_path).rglob('*.png')).read_bytes() == b'test-image'
        with pytest.raises(ValueError, match='已导入'): bank_sharing.redeem(tmp_path, code)
    with teacher('teacher1'):
        assert get_question_detail(tmp_path, 'math/default/q1')['question']['content'] == 'later edit'


def test_revoke_owner_permissions_expiration_and_collision_do_not_modify_bank(tmp_path, monkeypatch):
    code = prepare(tmp_path, monkeypatch)
    with teacher('teacher2'):
        with pytest.raises(ValueError): bank_sharing.revoke(code)
        bank_folders.act(tmp_path, 'create', path='分享', owner_id='teacher2')
        with pytest.raises(ValueError, match='同名'): bank_sharing.redeem(tmp_path, code)
        assert list_bank_entries(tmp_path) == []
        bank_folders.act(tmp_path, 'remove', path='分享', owner_id='teacher2')
    with teacher('teacher1'):
        with pytest.raises(ValueError, match='自己的'): bank_sharing.redeem(tmp_path, code)
        bank_sharing.revoke(code)
    with teacher('teacher2'):
        with pytest.raises(ValueError, match='过期'): bank_sharing.redeem(tmp_path, code)
    code2 = prepare(tmp_path / 'other', monkeypatch)
    with bank_sharing._shares() as con:
        con.execute('UPDATE invitations SET expires=?', ('2000-01-01T00:00:00+00:00',))
    with teacher('teacher2'):
        with pytest.raises(ValueError, match='过期'): bank_sharing.redeem(tmp_path / 'other', code2)
    with pytest.raises(PermissionError): bank_sharing.create(tmp_path, '分享')


def test_missing_attachment_does_not_issue_broken_invitation(tmp_path, monkeypatch):
    prepare(tmp_path, monkeypatch)
    with teacher('teacher1'):
        next(bank_resource_root(tmp_path).rglob('*.png')).unlink()
        with pytest.raises(ValueError, match='图片缺失'): bank_sharing.create(tmp_path, '父/分享')


def test_http_sharing_uses_authenticated_teacher_identity(web_client, monkeypatch):
    from tests.test_platform_student_api import _bootstrap_admin, _school_headers, _create_teacher_class_student, _teacher_headers, _headers
    monkeypatch.setenv('SOLAIRE_PUBLIC_MODE', '1')
    admin = _bootstrap_admin(web_client)
    school, _ = _school_headers(web_client, admin)
    _create_teacher_class_student(web_client, school)
    source_headers = _teacher_headers(web_client)
    assert web_client.post('/api/bank/folders/actions', json={'action': 'create', 'path': '分享/子目录'}, headers=source_headers).status_code == 200
    invitation = web_client.post('/api/bank/folders/share', json={'action': 'create', 'path': '分享'}, headers=source_headers)
    assert invitation.status_code == 200, invitation.text
    created = web_client.post('/api/school/teachers', headers=school, json={'username': 'teacher_two', 'password': 'teacher123', 'display_name': 'Two', 'subjects': ['Math']})
    assert created.status_code == 200
    login = web_client.post('/api/auth/login', json={'username': 'teacher_two', 'password': 'teacher123'})
    headers = _headers(login.json()['token'])
    result = web_client.post('/api/bank/folders/share', json={'action': 'redeem', 'code': invitation.json()['code']}, headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()['folders'] == ['分享', '分享/子目录']
    assert web_client.get('/api/bank/folders', headers=source_headers).json()['folders'] == ['分享', '分享/子目录']
    assert web_client.post('/api/bank/folders/share', json={'action': 'redeem', 'code': invitation.json()['code']}, headers=school).status_code == 403
