import { normalizeQuestionTypeForFilter } from "../../../lib/questionTypes";
import type { QuestionRow } from "../../../types/compose";

/**
 * The caller owns the cache so its lifetime follows the current question snapshot.
 * This preserves the baseline newline-joined lowercase search projection.
 */
export function getQuestionSearchText(
  question: QuestionRow,
  cache: WeakMap<QuestionRow, string>,
): string {
  let text = cache.get(question);
  if (text !== undefined) {
    return text;
  }

  const normalizedType = normalizeQuestionTypeForFilter(question.type, question.answer);
  const metadata = JSON.stringify(question.metadata ?? {});
  text = [
    question.id,
    question.qualified_id,
    question.content_preview,
    normalizedType,
    question.group_id ?? "",
    question.group_material ?? "",
    metadata,
  ]
    .join("\n")
    .toLowerCase();

  cache.set(question, text);
  return text;
}
