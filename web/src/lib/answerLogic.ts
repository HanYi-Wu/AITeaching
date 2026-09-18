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
