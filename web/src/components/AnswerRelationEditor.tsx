import { useState } from 'react';
import { type AnswerLogic, ANSWER_LOGIC_PREFIX, readAnswerLogic, recognizeAnswerExpression, formatAnswerLogic } from '../lib/answerLogic';
import { Select as AppSelect } from "./ui/select";

export function AnswerRelationEditor({
  value,
  onChange,
  teacher = false,
}: {
  value: string;
  onChange: (value: string) => void;
  teacher?: boolean;
}) {
  const [expression, setExpression] = useState('');
  const [error, setError] = useState('');
  const node = readAnswerLogic(value);
  const change = (entry: AnswerLogic) => onChange(ANSWER_LOGIC_PREFIX + JSON.stringify(entry));
  const atom = (): AnswerLogic => ({ op: 'value', value: '' });

  function editor(entry: AnswerLogic, update: (entry: AnswerLogic) => void, depth = 0) {
    return (
      <div className="space-y-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-3.5">
        {entry.op === 'value' ? (
          <textarea
            aria-label="关联答案值"
            className="w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 text-sm text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
            maxLength={2000}
            value={entry.value}
            onChange={(event) => update({ op: 'value', value: event.target.value })}
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <AppSelect
                aria-label="答案关系"
                value={entry.op}
                onValueChange={(value) => update({ ...entry, op: value as 'and' | 'or' })}
                className="or-select rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
              >
                <option value="or">或（任意一个答案成立）</option>
                <option value="and">且（所有条件同时成立）</option>
              </AppSelect>
            </div>
            {entry.items.map((child, index) => (
              <div key={index} className="space-y-1.5 pl-2 border-l-2 border-[var(--or-outline)]">
                {editor(child, (changed) =>
                  update({
                    ...entry,
                    items: entry.items.map((item, i) => (i === index ? changed : item)),
                  }),
                  depth + 1
                )}
                <button
                  type="button"
                  className="or-button or-button-danger or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_50%,transparent)] px-3 py-1 text-sm font-medium text-[var(--or-on-error)] hover:bg-[color-mix(in_srgb,var(--or-error-container)_60%,transparent)] active:bg-[var(--or-error-container)] transition-colors"
                  onClick={() => {
                    const items = entry.items.filter((_, i) => i !== index);
                    update(items.length === 1 ? items[0] : { ...entry, items });
                  }}
                >
                  移除此项
                </button>
              </div>
            ))}
            {entry.items.length < 8 ? (
              <button
                type="button"
                className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
                onClick={() => update({ ...entry, items: [...entry.items, atom()] })}
              >
                添加答案 / 条件
              </button>
            ) : null}
          </>
        )}
        {depth < 5 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
              onClick={() => update({ op: 'and', items: [entry, atom()] })}
            >
              添加且关系
            </button>
            <button
              type="button"
              className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
              onClick={() => update({ op: 'or', items: [entry, atom()] })}
            >
              添加或答案
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
          onClick={() => (node ? onChange(formatAnswerLogic(value)) : change({ op: 'or', items: [{ op: 'value', value }, atom()] }))}
        >
          {node ? '转为文本答案（保留内容）' : '使用多个答案 / 且或关系'}
        </button>
      </div>
      {teacher ? (
        <div className="space-y-2 rounded-2xl border border-[color-mix(in_srgb,var(--or-warning)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-warning-container)_60%,transparent)] p-3.5">
          {node ? (
            <p className="text-[13px] text-[color-mix(in_srgb,var(--or-on-warning)_85%,transparent)] leading-relaxed">
              手动识别仅按关系符解析，且优先于或。自然语言、数学括号可能有歧义，请检查结果；复杂旧答案仍建议让AI按题意适配。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="答案关系表达式"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="a 或 (b 且 c)"
              className="or-input min-w-[200px] flex-1 rounded-xl border border-[var(--or-warning)] bg-[var(--or-card)] px-3 py-1.5 text-sm text-[var(--or-text)] placeholder:text-[var(--or-on-warning)] focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="button"
              className="or-button or-pill inline-flex items-center justify-center rounded-full bg-amber-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-amber-700 active:bg-amber-800 transition-colors"
              onClick={() => {
                try {
                  change(recognizeAnswerExpression(expression || value));
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              识别或 / 且关系
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-[var(--or-on-error)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {node ? (
        <div className="space-y-2">
          <p className="text-[13px] text-[var(--or-muted)]">
            用“或”表达替代答案，用“且”表达同时要求；可嵌套组合。空白条件需要填写或移除。
          </p>
          {editor(node, change)}
        </div>
      ) : null}
    </div>
  );
}
