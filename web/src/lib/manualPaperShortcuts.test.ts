import { expect, test } from 'vitest';
import { fillSectionGaps, standardSections } from './manualPaperShortcuts';

test('standard template totals 100 with unique sections', () => {
  const sections = standardSections();
  expect(sections.reduce((sum, s) => sum + s.required_count * s.score_per_item, 0)).toBe(100);
  expect(new Set(sections.map(s => s.section_id)).size).toBe(sections.length);
});
test('fill keeps existing questions and respects capacity and types without duplicates', () => {
  const existing = { choice: ['a'] };
  const result = fillSectionGaps([{section_id:'choice',type:'single_choice',required_count:2}], existing,
    [{qualified_id:'a',type:'single_choice'}, {qualified_id:'b',type:'short_answer'}, {qualified_id:'c',type:'single_choice'}]);
  expect(result.choice).toEqual(['a','c']);
  expect(existing.choice).toEqual(['a']);
});
