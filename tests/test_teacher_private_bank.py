import hashlib
from contextlib import contextmanager

import pytest

from solaire.common.actor_context import actor
from solaire.exam_compiler.facade import QuestionItem
from solaire.web.bank_service import save_question, get_question_detail, list_bank_entries, create_question_selection_export
from solaire.web.teacher_bank import bank_resource_root
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _headers, _teacher_token


@contextmanager
def as_teacher(identifier):
    token = actor.set({'id': identifier, 'role':'teacher'})
    try:
        yield
    finally:
        actor.reset(token)


def test_http_and_ai_cannot_read_or_change_other_teacher_bank(web_client, tmp_path):
    admin = _bootstrap_admin(web_client)
    _, first_id, _ = _create_school_teacher_class(web_client, admin)
    school_token = web_client.post('/api/auth/login', json={'username':'school_a','password':'secret123'}).json()['token']
    second = web_client.post('/api/school/teachers', headers=_headers(school_token), json={
        'username':'teacher_two', 'password':'secret123', 'display_name':'Second', 'subjects':[]}).json()['teacher']
    second_headers = _headers(web_client.post('/api/auth/login', json={'username':'teacher_two','password':'secret123'}).json()['token'])
    first_headers = _headers(_teacher_token(web_client))
    qid = 'math/default/same-id'
    with as_teacher(first_id):
        save_question(tmp_path, qid, QuestionItem(id='same-id',type='short_answer',content='PRIVATE ONE',answer='1'))
        exported = create_question_selection_export(tmp_path, [qid])
    assert web_client.get('/api/bank/items', headers=second_headers).json()['items'] == []
    with as_teacher(second['id']):
        save_question(tmp_path, qid, QuestionItem(id='same-id',type='short_answer',content='PRIVATE TWO',answer='2'))
    assert web_client.get('/api/bank/items/'+qid, headers=first_headers).json()['question']['content'] == 'PRIVATE ONE'
    assert web_client.get('/api/bank/items/'+qid, headers=second_headers).json()['question']['content'] == 'PRIVATE TWO'
    private_rel = f"__teachers/{hashlib.sha256(first_id.encode()).hexdigest()}/math/default/same-id.yaml"
    assert web_client.get('/api/resource/'+private_rel, headers=second_headers).status_code == 403
    assert web_client.put('/api/bank/raw', headers=second_headers, json={'path':private_rel,'yaml':'bad'}).status_code == 403
    assert web_client.get(exported['download_url'], headers=second_headers).status_code == 404
    from solaire.agent_layer.registry import invoke_registered_tool
    from solaire.agent_layer.models import InvocationContext
    ctx = InvocationContext(project_root=tmp_path, session_id='isolation', platform_user={'id':second['id'],'role':'teacher'})
    result = invoke_registered_tool('file.read', {'path':'resource/'+private_rel}, ctx)
    assert result.status == 'failed'
    assert 'PRIVATE ONE' not in str(result.data)
    result = invoke_registered_tool('doc.convert_to_markdown', {'path':'resource/'+private_rel}, ctx)
    assert result.status == 'failed'
    from solaire.common.actor_context import assert_private_bank_path
    with as_teacher(second['id']), pytest.raises(PermissionError):
        assert_private_bank_path(tmp_path, tmp_path / 'RESOURCE' / '__TEACHERS' / hashlib.sha256(first_id.encode()).hexdigest() / 'file.yaml')
    with as_teacher(first_id):
        assert get_question_detail(tmp_path,qid)['question']['content'] == 'PRIVATE ONE'


def test_legacy_snapshot_is_independent_and_new_teachers_start_empty(web_client,tmp_path):
    admin = _bootstrap_admin(web_client)
    _, first_id, _ = _create_school_teacher_class(web_client, admin)
    qid='math/default/old'
    save_question(tmp_path,qid,QuestionItem(id='old',type='short_answer',content='legacy',answer='old'))
    with as_teacher(first_id):
        assert get_question_detail(tmp_path,qid)['question']['content']=='legacy'
        save_question(tmp_path,qid,QuestionItem(id='old',type='short_answer',content='changed',answer='new'))
        from solaire.agent_layer.tools.file_tools import _resolve
        from solaire.agent_layer.models import InvocationContext
        import os
        ctx = InvocationContext(project_root=tmp_path, session_id='case-check')
        relative = 'RESOURCE/math/default/old.yaml' if os.name == 'nt' else 'resource/math/default/old.yaml'
        resolved = _resolve(ctx, relative)
        assert bank_resource_root(tmp_path) in resolved.parents
        assert 'changed' in resolved.read_text('utf-8')
    assert get_question_detail(tmp_path,qid)['question']['content']=='legacy'
    with as_teacher('teacher-created-after-migration'):
        assert list_bank_entries(tmp_path)==[]
