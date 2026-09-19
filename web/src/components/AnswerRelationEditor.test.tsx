import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { AnswerRelationEditor } from './AnswerRelationEditor';
import { ANSWER_LOGIC_PREFIX, recognizeAnswerExpression } from '../lib/answerLogic';

test('teacher recognizes precedence and rejects missing conditions', () => {
  expect(recognizeAnswerExpression('a 或 b 且 c')).toEqual({ op: 'or', items: [{ op: 'value', value: 'a' }, { op: 'and', items: [{ op: 'value', value: 'b' }, { op: 'value', value: 'c' }] }] });
  expect(() => recognizeAnswerExpression('a 或')).toThrow();
  const change = vi.fn();
  render(<AnswerRelationEditor teacher value="a" onChange={change} />);
  fireEvent.change(screen.getByLabelText('答案关系表达式'), { target: { value: 'a 或 (b 且 c)' } });
  fireEvent.click(screen.getByRole('button', { name: '识别或 / 且关系' }));
  expect(change).toHaveBeenCalledWith(ANSWER_LOGIC_PREFIX + JSON.stringify(recognizeAnswerExpression('a 或 (b 且 c)')));
});

test('removing an alternative retains one answer and conversion preserves text', () => {
  const change = vi.fn();
  const value = ANSWER_LOGIC_PREFIX + JSON.stringify({ op: 'or', items: [{ op: 'value', value: 'a' }, { op: 'value', value: 'b' }] });
  const view = render(<AnswerRelationEditor teacher value={value} onChange={change} />);
  fireEvent.click(screen.getAllByRole('button', { name: '移除此项' })[0]);
  expect(change).toHaveBeenLastCalledWith(ANSWER_LOGIC_PREFIX + JSON.stringify({ op: 'value', value: 'b' }));
  view.rerender(<AnswerRelationEditor teacher value={ANSWER_LOGIC_PREFIX + JSON.stringify({ op: 'value', value: 'b' })} onChange={change} />);
  expect(screen.queryByRole('button', { name: '移除此项' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '转为文本答案（保留内容）' }));
  expect(change).toHaveBeenLastCalledWith('b');
});
