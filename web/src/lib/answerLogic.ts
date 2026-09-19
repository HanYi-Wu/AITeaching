export const ANSWER_LOGIC_PREFIX = ':::ANSWER_LOGIC:';
export type AnswerLogic = { op: 'value'; value: string } | { op: 'and' | 'or'; items: AnswerLogic[] };

export function readAnswerLogic(text: string): AnswerLogic | null {
  if (!text.startsWith(ANSWER_LOGIC_PREFIX) || text.length > 32000) return null;
  try {
    const node: unknown = JSON.parse(text.slice(ANSWER_LOGIC_PREFIX.length));
    let count = 0;
    function valid(value: unknown, depth = 0): value is AnswerLogic {
      if (++count > 128 || depth > 8 || !value || typeof value !== 'object') return false;
      const entry = value as Record<string, unknown>;
      return entry.op === 'value' ? typeof entry.value === 'string' && entry.value.length <= 2000
        : (entry.op === 'and' || entry.op === 'or') && Array.isArray(entry.items) && entry.items.length >= 2 && entry.items.length <= 8 && entry.items.every(item => valid(item, depth + 1));
    }
    return valid(node) ? node : null;
  } catch { return null; }
}

export function formatAnswerLogic(text: string): string {
  const node = readAnswerLogic(text);
  const render = (entry: AnswerLogic): string => entry.op === 'value' ? entry.value : '(' + entry.items.map(render).join(entry.op === 'and' ? ' 且 ' : ' 或 ') + ')';
  return node ? render(node) : text;
}

/** Explicit teacher-requested syntax recognition, never an automatic semantic migration. */
export function recognizeAnswerExpression(text: string): AnswerLogic {
  const tokens = text.replace(/（/g, '(').replace(/）/g, ')').split(/(\(|\)|或者|而且|以及|并且|或|且|和|\|\||&&)/).map(t => t.trim()).filter(Boolean);
  let position = 0;
  const isOr = (t: string) => ['或', '或者', '||'].includes(t);
  const isAnd = (t: string) => ['且', '而且', '以及', '并且', '和', '&&'].includes(t);
  const combine = (op: 'and' | 'or', a: AnswerLogic, b: AnswerLogic): AnswerLogic => ({ op, items: [a, b] });
  function atom(): AnswerLogic {
    const token = tokens[position++];
    if (token === '(') {
      const node = alternative();
      if (tokens[position++] !== ')') throw new Error('括号不匹配');
      return node;
    }
    if (!token || token === ')' || isOr(token) || isAnd(token)) throw new Error('关系符两侧必须有答案');
    return { op: 'value', value: token };
  }
  function conjunction(): AnswerLogic {
    let node = atom();
    while (isAnd(tokens[position])) { position++; node = combine('and', node, atom()); }
    return node;
  }
  function alternative(): AnswerLogic {
    let node = conjunction();
    while (isOr(tokens[position])) { position++; node = combine('or', node, conjunction()); }
    return node;
  }
  const node = alternative();
  if (position !== tokens.length || !readAnswerLogic(ANSWER_LOGIC_PREFIX + JSON.stringify(node))) throw new Error('答案关系过复杂或格式无效');
  return node;
}
