"""Bounded answer relations. Semantic legacy conversion is an assistant operation only."""
import json
import itertools

PREFIX = ':::ANSWER_LOGIC:'


def branches(node, depth=0, count=None):
    count = [0] if count is None else count
    count[0] += 1
    if depth > 8 or count[0] > 128 or not isinstance(node, dict):
        raise ValueError('答案关系过深或结构无效')
    op = node.get('op')
    if op == 'value':
        value = node.get('value')
        if not isinstance(value, str) or not value.strip() or len(value) > 2000:
            raise ValueError('答案值不能为空或超过2000字')
        return {frozenset([' '.join(value.split()).casefold()])}
    items = node.get('items')
    if op not in ('and', 'or') or not isinstance(items, list) or not 2 <= len(items) <= 8:
        raise ValueError('关系必须为且/或，并包含2至8项')
    parts = [branches(item, depth + 1, count) for item in items]
    if op == 'or':
        result = set().union(*parts)
    else:
        result = {frozenset()}
        for part in parts:
            if len(result) * len(part) > 1024:
                raise ValueError('答案关系组合过多，请简化')
            result = {a | b for a, b in itertools.product(result, part)}
    if len(result) > 256:
        raise ValueError('答案关系组合超过256种')
    # Boolean absorption: A or (A and B) is equivalent to A.
    return {branch for branch in result if not any(other < branch for other in result)}


def decode(text):
    if not isinstance(text, str) or not text.startswith(PREFIX):
        return {'op': 'value', 'value': str(text or '')}
    if len(text) > 32000:
        raise ValueError('答案关系内容过长')
    try:
        node = json.loads(text[len(PREFIX):])
    except (ValueError, RecursionError):
        raise ValueError('答案关系格式无效') from None
    branches(node)
    return node


def encode(node):
    branches(node)
    text = PREFIX + json.dumps(node, ensure_ascii=False, separators=(',', ':'))
    if len(text) > 32000:
        raise ValueError('答案关系内容过长')
    return text


def matches(actual, expected):
    """Any permitted alternative is sufficient; all asserted alternatives must be valid."""
    try:
        submitted, allowed = branches(decode(actual)), branches(decode(expected))
        return bool(submitted) and submitted <= allowed
    except (ValueError, RecursionError):
        return False


def display(text):
    def render(node):
        if node['op'] == 'value':
            return node['value']
        separator = ' 且 ' if node['op'] == 'and' else ' 或 '
        return '(' + separator.join(render(item) for item in node['items']) + ')'
    try:
        return render(decode(text)) if isinstance(text, str) and text.startswith(PREFIX) else text
    except (ValueError, RecursionError):
        return '答案关系无效，请教师修复'
