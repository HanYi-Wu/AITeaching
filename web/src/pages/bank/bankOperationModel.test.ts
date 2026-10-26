import { describe, expect, it } from 'vitest';
import {
  boxSelection,
  dedupeSelection,
  pruneStaleSelection,
  rangeSelection,
  toggleFolderOrFilteredSelection,
  toggleSingleSelection,
} from './bankOperationModel';

describe('dedupeSelection', () => {
  it('deduplicates while preserving first occurrence order and removing falsy values', () => {
    const input = ['数学/q1', '数学/q2', '数学/q1', '', '数学/group1', '数学/q2'];
    expect(dedupeSelection(input)).toEqual(['数学/q1', '数学/q2', '数学/group1']);
  });
});

describe('toggleSingleSelection', () => {
  it('appends unselected item to selection', () => {
    const prev = ['数学/q1'];
    expect(toggleSingleSelection(prev, '数学/group1')).toEqual(['数学/q1', '数学/group1']);
  });

  it('removes selected item from selection', () => {
    const prev = ['数学/q1', '数学/q2'];
    expect(toggleSingleSelection(prev, '数学/q1')).toEqual(['数学/q2']);
  });

  it('ignores empty ID', () => {
    const prev = ['数学/q1'];
    expect(toggleSingleSelection(prev, '')).toEqual(['数学/q1']);
  });
});

describe('toggleFolderOrFilteredSelection', () => {
  it('selects all target items when partially or none selected, preserving other folder selections', () => {
    // Already selected an item from another folder (语文/q9)
    const current = ['语文/q9', '数学/q1'];
    const folderMath = ['数学/q1', '数学/q2', '数学/group1'];

    const next = toggleFolderOrFilteredSelection(current, folderMath);
    // Should preserve '语文/q9', '数学/q1' and append '数学/q2', '数学/group1'
    expect(next).toEqual(['语文/q9', '数学/q1', '数学/q2', '数学/group1']);
  });

  it('deselects target items when all target items are currently selected, keeping other folder selections', () => {
    const current = ['语文/q9', '数学/q1', '数学/q2', '数学/group1', '英语/q3'];
    const folderMath = ['数学/q1', '数学/q2', '数学/group1'];

    const next = toggleFolderOrFilteredSelection(current, folderMath);
    // Should remove only math items and leave 语文 and 英语 untouched
    expect(next).toEqual(['语文/q9', '英语/q3']);
  });

  it('handles empty target list gracefully', () => {
    const current = ['数学/q1'];
    expect(toggleFolderOrFilteredSelection(current, [])).toEqual(['数学/q1']);
  });
});

describe('rangeSelection', () => {
  const visible = ['q1', 'q2', 'group1', 'q3', 'q4'];

  it('selects range from anchor to target forward', () => {
    const current = ['q0']; // item outside visible
    const result = rangeSelection(current, visible, 'q2', 'q3');
    expect(result).toEqual(['q0', 'q2', 'group1', 'q3']);
  });

  it('selects range from anchor to target backward', () => {
    const current: string[] = [];
    const result = rangeSelection(current, visible, 'q4', 'group1');
    expect(result).toEqual(['group1', 'q3', 'q4']);
  });

  it('falls back to target when anchor is null or not found', () => {
    expect(rangeSelection(['q1'], visible, null, 'q3')).toEqual(['q3']);
    expect(rangeSelection(['q1'], visible, 'non_existent', 'q3')).toEqual(['q3']);
  });
});

describe('boxSelection', () => {
  it('unions base selection with hit questions preserving order and deduplicating', () => {
    const base = ['q1', 'q3'];
    const hit = ['q2', 'q3', 'group1'];
    expect(boxSelection(base, hit)).toEqual(['q1', 'q3', 'q2', 'group1']);
  });
});

describe('pruneStaleSelection', () => {
  it('separates valid and stale IDs based on current active items', () => {
    const current = ['q1', 'stale_q', 'group1'];
    const validSet = new Set(['q1', 'group1', 'q2']);
    const { valid, stale } = pruneStaleSelection(current, validSet);
    expect(valid).toEqual(['q1', 'group1']);
    expect(stale).toEqual(['stale_q']);
  });
});
