import { type AnswerLogic, ANSWER_LOGIC_PREFIX, readAnswerLogic } from '../lib/answerLogic';

export function AnswerRelationEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const node = readAnswerLogic(value);
  const change = (entry: AnswerLogic) => onChange(ANSWER_LOGIC_PREFIX + JSON.stringify(entry));
  const atom = (): AnswerLogic => ({ op: 'value', value: '' });
  function editor(entry: AnswerLogic, update: (entry: AnswerLogic) => void, depth = 0) {
    return <div className="space-y-2 rounded border border-slate-300 p-2">
      {entry.op === 'value' ? <textarea aria-label="关联答案值" className="w-full rounded border p-2 text-sm" maxLength={2000} value={entry.value} onChange={event => update({ op: 'value', value: event.target.value })} />
        : <><select aria-label="答案关系" value={entry.op} onChange={event => update({ ...entry, op: event.target.value as 'and' | 'or' })} className="rounded border p-1 text-xs"><option value="or">或（任意一个答案成立）</option><option value="and">且（所有条件同时成立）</option></select>
          {entry.items.map((child, index) => <div key={index}>{editor(child, changed => update({ ...entry, items: entry.items.map((item, i) => i === index ? changed : item) }), depth + 1)}
            <button type="button" className="text-xs text-red-600" onClick={() => { const items = entry.items.filter((_, i) => i !== index); update(items.length === 1 ? items[0] : { ...entry, items }); }}>移除此项</button></div>)}
          {entry.items.length < 8 ? <button type="button" className="rounded border px-2 text-xs" onClick={() => update({ ...entry, items: [...entry.items, atom()] })}>添加答案 / 条件</button> : null}</>}
      {depth < 5 ? <button type="button" className="ml-2 rounded border px-2 text-xs" onClick={() => update({ op: 'and', items: [entry, atom()] })}>组合为新关系</button> : null}
    </div>;
  }
  return <div className="space-y-2">
    <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => node ? onChange('') : change({ op: 'or', items: [{ op: 'value', value }, atom()] })}>{node ? '退出多答案模式（清空关系）' : '使用多个答案 / 且或关系'}</button>
    {node ? <><p className="text-xs text-slate-500">用“或”表达替代答案，用“且”表达同时要求；可嵌套组合。空白条件需要填写或移除。</p>{editor(node, change)}</> : null}
  </div>;
}
