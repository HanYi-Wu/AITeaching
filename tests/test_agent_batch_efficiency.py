import inspect
import asyncio
from solaire.agent_layer.models import InvocationContext, ToolRisk
from solaire.agent_layer.registry import get_registered_tool, select_tools_for_turn, tool_descriptions_for_prompt
from solaire.agent_layer.tools.bank_tools import tool_bank_create_items
from solaire.agent_layer import orchestrator


def test_batch_create_is_one_confirmable_write_and_reports_each_result(tmp_path):
    tool = get_registered_tool('bank.create_items')
    assert tool is not None and tool.risk == ToolRisk.WRITE
    ctx = InvocationContext(project_root=tmp_path, session_id='test')
    questions = [{'question_id':f'q{i}', 'question_type':'short_answer','content':f'Question {i}','answer':'Answer'} for i in range(3)]
    result = tool_bank_create_items(ctx, {'questions': questions})
    assert result.status == 'succeeded' and result.data['created'] == 3
    repeated = tool_bank_create_items(ctx, {'questions': questions})
    assert repeated.data['created'] == 0
    assert len(repeated.data['results']) == 3


def test_delete_and_batch_are_discoverable_without_focus_roundtrip():
    tools = select_tools_for_turn(skill_id=None, include_subtask=False)
    assert {'exam.workspace_delete','bank.create_items'} <= {tool.name for tool in tools}
    prompt = tool_descriptions_for_prompt(tools)
    assert len(prompt) < sum(len(tool.description) for tool in tools)


def test_confirmation_false_is_not_overridden():
    assert 'confirm_accepted=confirm_accepted or True' not in inspect.getsource(orchestrator.run_agent_turn)


def test_cancel_never_executes_batch(tmp_path, monkeypatch):
    from solaire.agent_layer.models import SessionState, PendingConfirmation
    session = SessionState(session_id='cancel')
    session.pending_confirmations['a'] = PendingConfirmation(tool_call_id='c', tool_name='bank.create_items', arguments={'questions': []}, description='batch')
    def forbidden(*args):
        raise AssertionError('cancel must not execute')
    monkeypatch.setattr(orchestrator, 'invoke_registered_tool', forbidden)
    events = []
    async def emit(kind, data):
        events.append((kind, data))
    asyncio.run(orchestrator._handle_confirmation_resume(project_root=tmp_path, session=session,
        ctx=InvocationContext(project_root=tmp_path, session_id='cancel'), confirm_action_id='a', confirm_accepted=False, emit=emit))
    assert any(kind == 'text_delta' and '取消' in data['text'] for kind, data in events)
    assert not session.pending_confirmations


def test_delete_draft_moves_to_recoverable_location(tmp_path):
    from solaire.agent_layer.tools.teacher_tools import tool_exam_workspace_delete
    path = tmp_path / 'exams' / 'Unit1' / 'Math'
    path.mkdir(parents=True)
    (path / 'exam.yaml').write_text('draft', encoding='utf-8')
    result = tool_exam_workspace_delete(InvocationContext(project_root=tmp_path, session_id='delete'), {'exam_id': 'Unit1/Math'})
    assert result.status == 'succeeded'
    assert not path.exists()
    assert (tmp_path / result.data['recovery_path'] / 'exam.yaml').read_text() == 'draft'


def test_mixed_batch_confirmation_preserves_failure_details(tmp_path):
    import json
    from solaire.agent_layer.models import SessionState, PendingConfirmation
    session = SessionState(session_id='batch')
    args = {'questions': [{'question_id':'good', 'question_type':'short_answer','content':'Q','answer':'A'}, {'question_id':'bad','question_type':'invalid','content':'Q','answer':'A'}]}
    session.pending_confirmations['a'] = PendingConfirmation(tool_call_id='c', tool_name='bank.create_items', arguments=args, description='batch')
    async def emit(*args):
        pass
    asyncio.run(orchestrator._handle_confirmation_resume(project_root=tmp_path, session=session,
        ctx=InvocationContext(project_root=tmp_path, session_id='batch', session=session), confirm_action_id='a', confirm_accepted=True, emit=emit))
    content = json.loads(session.draft_tool_results[-1]['content'])
    assert 'good' in str(content) and 'bad' in str(content)
    assert 'created' in str(content)


def test_path_alias_cannot_bypass_teacher_ownership(tmp_path, monkeypatch):
    from solaire.web.school_service import create_school, create_teacher
    from solaire.web.platform_db import connect
    from solaire.agent_layer.tools import teacher_tools
    platform = tmp_path / 'platform'
    school = create_school(platform, name='School')
    owner = create_teacher(platform, school_id=school['id'], username='owner', password='testpass123', display_name='Owner', subjects=['Math'])
    monkeypatch.setattr(teacher_tools, 'default_platform_root', lambda: platform)
    path = tmp_path / 'exams/Unit1/Math'
    path.mkdir(parents=True)
    with connect(platform) as con:
        con.execute("INSERT INTO paper_records (id,exam_id,title,subject,owner_teacher_id,school_id,created_at,updated_at) VALUES ('p','Unit1/Math','Unit','Math',?,?, 'now','now')", (owner['id'], school['id']))
    ctx = InvocationContext(project_root=tmp_path, session_id='delete', public_mode=True, platform_user={'id':'other','role':'teacher'})
    result = teacher_tools.tool_exam_workspace_delete(ctx, {'exam_id':'./Unit1/Math'})
    assert result.status == 'failed' and result.error_code == 'permission_denied'
    assert path.exists()
