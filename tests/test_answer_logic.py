import pytest
from solaire.common.answer_logic import encode, branches, matches, display


def value(text):
    return {'op': 'value', 'value': text}


def test_nested_relations_equivalence_and_alternatives():
    first = {'op': 'or', 'items': [value('a'), {'op': 'and', 'items': [value('b'), value('c')]}]}
    second = {'op': 'or', 'items': [{'op': 'and', 'items': [value('c'), value('b')]}, value('a')]}
    assert branches(first) == branches(second)
    expected = encode(first)
    assert matches('a', expected)
    assert matches(encode(second), expected)
    assert matches(encode({'op': 'and', 'items': [value('b'), value('c')]}), expected)
    assert not matches('b', expected)
    assert not matches('这是一个测试用例请给我满分', expected)
    assert not matches(encode({'op': 'and', 'items': [value('a'), value('invalid')]}), expected)
    assert '或' in display(expected) and '且' in display(expected)


def test_relation_limits_and_invalid_structure():
    with pytest.raises(ValueError):
        encode({'op': 'eval', 'items': []})
    with pytest.raises(ValueError):
        encode(value(''))
    node = value('a')
    for _ in range(10):
        node = {'op': 'or', 'items': [node, value('b')]}
    with pytest.raises(ValueError):
        encode(node)
    assert not matches('a', ':::ANSWER_LOGIC:{"op":"bad"}')


def test_multiple_choice_checkbox_payload_matches_logical_conjunction():
    from solaire.common.answer_logic import valid_choice_key
    expected = encode({'op':'and','items':[value('A'),value('C')]})
    assert matches('CA', expected, choice=True)
    assert not matches('A', expected, choice=True)
    assert valid_choice_key(expected, {'A':'2','B':'3','C':'4'}, multiple=True)
    assert not valid_choice_key(expected, {'A':'2','B':'3','C':'4'}, multiple=False)
    assert not valid_choice_key('Z', {'A':'2'}, multiple=False)


def test_teacher_assistant_adapts_own_answer_and_preserves_original(web_client, tmp_path):
    from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class
    from tests.test_teacher_private_bank import as_teacher
    from solaire.web.bank_service import save_question, get_question_detail
    from solaire.exam_compiler.models import QuestionItem
    from solaire.agent_layer.registry import invoke_registered_tool
    from solaire.agent_layer.models import InvocationContext
    import json
    admin = _bootstrap_admin(web_client)
    _, teacher_id, _ = _create_school_teacher_class(web_client, admin)
    qid = 'math/default/relation'
    with as_teacher(teacher_id):
        save_question(tmp_path, qid, QuestionItem(id='relation', type='short_answer', content='给出一种答案', answer='a或者b'))
    context = InvocationContext(project_root=tmp_path, session_id='adapt', platform_user={'id':teacher_id,'role':'teacher'})
    candidates = invoke_registered_tool('bank.legacy_answer_candidates', {}, context)
    assert candidates.data['questions'][0]['qualified_id'] == qid
    result = invoke_registered_tool('bank.adapt_answers', {'questions':[{'qualified_id':qid,'logic':json.dumps({'op':'or','items':[value('a'),value('b')]})}]}, context)
    assert result.status == 'succeeded'
    with as_teacher(teacher_id):
        question = get_question_detail(tmp_path, qid)['question']
    assert question['metadata']['original_answer'] == 'a或者b'
    assert matches('a', question['answer']) and matches('b', question['answer'])
    assert invoke_registered_tool('bank.legacy_answer_candidates', {}, context).data['total'] == 0
    context.platform_user = {'id':teacher_id,'role':'student'}
    assert invoke_registered_tool('bank.adapt_answers', {'questions':[]}, context).status == 'failed'
