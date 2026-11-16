import { describe, expect, it } from 'vitest';
import {
  buildBankFolderIndex,
  canMoveBankFolder,
  canMoveBankQuestions,
  isDescendantOrSelfFolder,
  validateBankFolderPath,
  validateQuestionIdInCollection,
  type BankFolders,
} from './bankModel';

describe('validateBankFolderPath', () => {
  it('allows valid single and nested folder paths', () => {
    expect(validateBankFolderPath('数学').ok).toBe(true);
    expect(validateBankFolderPath('数学/代数/函数').ok).toBe(true);
  });

  it('handles empty path according to allowRoot option', () => {
    expect(validateBankFolderPath('').ok).toBe(false);
    expect(validateBankFolderPath('   ').ok).toBe(false);
    expect(validateBankFolderPath('', { allowRoot: true }).ok).toBe(true);
    expect(validateBankFolderPath('   ', { allowRoot: true }).ok).toBe(true);
  });

  it('rejects paths exceeding length or depth limits', () => {
    const longName = 'a'.repeat(241);
    expect(validateBankFolderPath(longName).ok).toBe(false);

    const deepPath = Array.from({ length: 13 }, (_, i) => `level${i}`).join('/');
    expect(validateBankFolderPath(deepPath).ok).toBe(false);
  });

  it('rejects empty parts, dot segments and untrimmed parts', () => {
    expect(validateBankFolderPath('数学//函数').ok).toBe(false);
    expect(validateBankFolderPath('数学/./函数').ok).toBe(false);
    expect(validateBankFolderPath('数学/../函数').ok).toBe(false);
    expect(validateBankFolderPath('数学 /函数').ok).toBe(false);
  });

  it('rejects illegal characters', () => {
    expect(validateBankFolderPath('数学\\函数').ok).toBe(false);
    expect(validateBankFolderPath('数学*函数').ok).toBe(false);
    expect(validateBankFolderPath('数学?函数').ok).toBe(false);
    expect(validateBankFolderPath('数学<函数').ok).toBe(false);
    expect(validateBankFolderPath('数学>函数').ok).toBe(false);
    expect(validateBankFolderPath('数学|函数').ok).toBe(false);
    expect(validateBankFolderPath('数学:函数').ok).toBe(false);
    expect(validateBankFolderPath('数学"函数').ok).toBe(false);
  });
});

describe('isDescendantOrSelfFolder', () => {
  it('detects self and descendant relationships', () => {
    expect(isDescendantOrSelfFolder('数学', '数学')).toBe(true);
    expect(isDescendantOrSelfFolder('数学/代数', '数学')).toBe(true);
    expect(isDescendantOrSelfFolder('数学/代数/微积分', '数学')).toBe(true);
    expect(isDescendantOrSelfFolder('数学2', '数学')).toBe(false);
    expect(isDescendantOrSelfFolder('语文', '数学')).toBe(false);
    expect(isDescendantOrSelfFolder('数学', '')).toBe(false);
  });
});

describe('canMoveBankFolder', () => {
  const existingFolders = ['数学', '数学/代数', '数学/代数/微积分', '英语', '物理'];

  it('prevents moving folder into itself or its descendants', () => {
    const selfMove = canMoveBankFolder('数学', '数学', existingFolders);
    expect(selfMove.ok).toBe(false);
    expect(selfMove.reason).toContain('自身或子目录');

    const descMove = canMoveBankFolder('数学', '数学/代数', existingFolders);
    expect(descMove.ok).toBe(false);
    expect(descMove.reason).toContain('自身或子目录');
  });

  it('prevents moving non-existent source folder', () => {
    const res = canMoveBankFolder('化学', '数学', existingFolders);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('源目录不存在');
  });

  it('prevents moving into non-existent target parent', () => {
    const res = canMoveBankFolder('物理', '生物', existingFolders);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('目标目录不存在');
  });

  it('prevents collisions when destination directory already exists', () => {
    // Attempting to move '数学/代数' into root when '代数' exists (if existingFolders has '代数')
    const withAlgebra = [...existingFolders, '代数'];
    const res = canMoveBankFolder('数学/代数', '', withAlgebra);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('已存在同名目录');
  });

  it('allows moving into valid target or root', () => {
    const toRoot = canMoveBankFolder('数学/代数', '', existingFolders);
    expect(toRoot.ok).toBe(true);

    const toOther = canMoveBankFolder('物理', '数学', existingFolders);
    expect(toOther.ok).toBe(true);
  });
});

describe('canMoveBankQuestions', () => {
  const existingFolders = ['数学', '语文'];

  it('requires at least one question and caps at 500', () => {
    expect(canMoveBankQuestions([], '数学', existingFolders).ok).toBe(false);
    const tooMany = Array.from({ length: 501 }, (_, i) => `q_${i}`);
    expect(canMoveBankQuestions(tooMany, '数学', existingFolders).ok).toBe(false);
    const validBatch = Array.from({ length: 50 }, (_, i) => `q_${i}`);
    expect(canMoveBankQuestions(validBatch, '数学', existingFolders).ok).toBe(true);
  });

  it('validates target folder', () => {
    expect(canMoveBankQuestions(['q1'], '生物', existingFolders).ok).toBe(false);
    expect(canMoveBankQuestions(['q1'], '', existingFolders).ok).toBe(true);
    expect(canMoveBankQuestions(['q1'], '数学', existingFolders).ok).toBe(true);
  });
});

describe('buildBankFolderIndex', () => {
  it('builds sorted tree and maps questions, handling unclassified and orphaned items', () => {
    const data: BankFolders = {
      folders: ['数学/几何', '数学', '语文'],
      assignments: {
        q1: '数学',
        q2: '数学/几何',
        q3: '已删除目录', // orphaned
        q4: '', // unclassified
      },
    };
    const items = [
      { qualified_id: 'q1' },
      { qualified_id: 'q2' },
      { qualified_id: 'q3' },
      { qualified_id: 'q4' },
      { qualified_id: 'q5' }, // not in assignments
    ];

    const index = buildBankFolderIndex(data, items);

    // Sorted folders: children of root ""
    expect(index.children.get('')).toEqual(['数学', '语文']);
    expect(index.children.get('数学')).toEqual(['数学/几何']);

    // Questions in root: unclassified + orphaned
    const rootQuestions = index.questions.get('')?.map((q) => q.qualified_id);
    expect(rootQuestions).toEqual(['q3', 'q4', 'q5']);

    // Questions in '数学'
    expect(index.questions.get('数学')?.map((q) => q.qualified_id)).toEqual(['q1']);
    // Questions in '数学/几何'
    expect(index.questions.get('数学/几何')?.map((q) => q.qualified_id)).toEqual(['q2']);
  });
});

describe('validateQuestionIdInCollection', () => {
  const items = [
    { id: '第一题', qualified_id: '数学/默认/第一题', collection: '数学/默认', subject: '数学' },
    { id: 'Alpha', qualified_id: '数学/默认/Alpha', collection: '数学/默认', subject: '数学' },
    { id: '第一题', qualified_id: '物理/默认/第一题', collection: '物理/默认', subject: '物理' },
    {
      id: 'G1',
      qualified_id: '数学/默认/G1',
      collection: '数学/默认',
      subject: '数学',
      group_member_qualified_ids: ['数学/默认/G1__01'],
    },
  ];

  it('rejects empty ids, slashes, case-folded duplicates, and group member collisions within the target collection', () => {
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: '   ' })).toContain('不能为空');
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: 'a/b' })).toContain('斜杠');
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: ' 第一题 ' })).toContain('已存在');
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: 'alpha' })).toContain('已存在');
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: 'g1__01' })).toContain('已存在');
    expect(
      validateQuestionIdInCollection({
        items,
        subject: '数学/默认',
        rawId: ' 第一题 ',
        excludeQualifiedId: '数学/默认/第一题',
      }),
    ).toBeNull();
    expect(validateQuestionIdInCollection({ items, subject: '数学', collection: '默认', rawId: '第二题' })).toBeNull();
  });
});
