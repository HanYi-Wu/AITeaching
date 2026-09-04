export function standardSections() {
  return [
    { section_id: '一、选择题', type: 'single_choice', required_count: 10, score_per_item: 5, describe: '' },
    { section_id: '二、填空题', type: 'fill', required_count: 5, score_per_item: 4, describe: '' },
    { section_id: '三、解答题', type: 'short_answer', required_count: 3, score_per_item: 10, describe: '' },
  ];
}
export function fillSectionGaps(
  sections: {section_id: string; type: string; required_count: number}[],
  existing: Record<string, string[]>,
  questions: {qualified_id: string; type: string; answer?: string | null}[],
  matches = (questionType: string, sectionType: string, _answer?: string | null) => questionType === sectionType,
) {
  const result = Object.fromEntries(Object.entries(existing).map(([id, ids]) => [id, [...ids]]));
  const used = new Set(Object.values(existing).flat());
  for (const section of sections) {
    if (section.type === 'text') continue;
    const selected = result[section.section_id] ??= [];
    for (const question of questions) {
      if (selected.length >= section.required_count) break;
      if (!used.has(question.qualified_id) && matches(question.type, section.type, question.answer)) {
        selected.push(question.qualified_id);
        used.add(question.qualified_id);
      }
    }
  }
  return result;
}
