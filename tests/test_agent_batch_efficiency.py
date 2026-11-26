import inspect
import asyncio
import json
from unittest.mock import MagicMock
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


def test_batch_stream_previews_all_questions_before_one_write(tmp_path):
    from solaire.agent_layer.models import ChatMessage, SessionState
    from solaire.web.bank_service import get_question_detail

    questions = [{"question_id": f"review{i}", "question_type": "short_answer", "content": f"题干 {i}",
                  "answer": f"答案 {i}", "analysis": f"解析 {i}"} for i in range(10)]
    args = {"subject": "数学", "questions": questions}
    session = SessionState(session_id="review-batch", messages=[ChatMessage(role="user", content="生成十道数学题")])
    session.draft_assistant = {"content": None, "tool_calls": [{"id": "batch-1", "function": {
        "name": "bank.create_items", "arguments": json.dumps(args, ensure_ascii=False),
    }}]}
    seen = []

    async def emit(event, payload):
        seen.append((event, payload))

    asyncio.run(orchestrator.run_agent_turn(tmp_path, session, user_message=None, project_ctx={},
                                          router=MagicMock(), emit=emit, max_llm_rounds=1))
    confirmations = [payload for event, payload in seen if event == "confirm_needed"]
    assert len(confirmations) == 1
    action = confirmations[0]
    preview = action["preview"]["questions"]
    assert [question["content"] for question in preview] == [question["content"] for question in questions]
    assert preview[-1]["analysis"] == "解析 9"
    assert not list(tmp_path.rglob("review*.yaml"))
    asyncio.run(orchestrator._handle_confirmation_resume(project_root=tmp_path, session=session,
        ctx=InvocationContext(project_root=tmp_path, session_id="review-batch", session=session),
        confirm_action_id=action["action_id"], confirm_accepted=True, emit=emit))
    for question in questions:
        saved = get_question_detail(tmp_path, f"数学/默认/{question['question_id']}")
        assert saved["question"]["content"] == question["content"]


def test_review_can_select_and_edit_but_cannot_redirect_the_batch(tmp_path):
    from solaire.agent_layer.models import PendingConfirmation, SessionState
    from solaire.web.bank_service import get_question_detail

    session = SessionState(session_id="filtered")
    questions = [{"question_id": f"ret{i}", "question_type": "short_answer", "content": f"题干 {i}",
                  "answer": f"答案 {i}"} for i in range(2)]
    session.pending_confirmations["pending"] = PendingConfirmation(tool_call_id="c", tool_name="bank.create_items",
        arguments={"subject": "数学", "questions": questions}, description="Preview")
    seen = []

    async def emit(event, data):
        seen.append((event, data))

    def confirm(review):
        return asyncio.run(orchestrator._handle_confirmation_resume(project_root=tmp_path, session=session,
            ctx=InvocationContext(project_root=tmp_path, session_id="filtered", session=session),
            confirm_action_id="pending", confirm_accepted=True, confirm_questions=review, emit=emit))

    confirm([{"index": 1, "question_id": "unauthorized"}])
    assert "pending" in session.pending_confirmations
    assert seen[0][1]["code"] == "invalid_question_review"
    assert not list(tmp_path.rglob("ret*.yaml"))
    confirm([{"index": 1, "content": "教师改后的题干", "answer": "更正答案"}])
    assert "pending" not in session.pending_confirmations
    assert not list(tmp_path.rglob("ret0.yaml"))
    saved = get_question_detail(tmp_path, "数学/默认/ret1")["question"]
    assert saved["content"] == "教师改后的题干" and saved["answer"] == "更正答案"


def test_delete_and_batch_are_discoverable_without_focus_roundtrip():
    tools = select_tools_for_turn(skill_id=None, include_subtask=False)
    assert {'exam.workspace_delete','bank.create_items'} <= {tool.name for tool in tools}
    prompt = tool_descriptions_for_prompt(tools)
    assert len(prompt) < sum(len(tool.description) for tool in tools)
    assert 'paper.find_submissions' not in prompt


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
