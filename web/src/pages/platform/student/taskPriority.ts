import type { StudentPaperRecord } from "../../../platform/auth";

function deadline(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function prioritizeStudentTasks(papers: readonly StudentPaperRecord[]): StudentPaperRecord[] {
  const rank = (paper: StudentPaperRecord) => paper.can_answer === false ? 2 : paper.status === "in_progress" ? 0 : 1;
  return papers.filter((paper) => !["submitted", "completed"].includes(paper.status)).sort((left, right) => {
    const order = rank(left) - rank(right);
    if (order) return order;
    const leftDeadline = deadline(left.end_at), rightDeadline = deadline(right.end_at);
    if (leftDeadline !== rightDeadline) return leftDeadline < rightDeadline ? -1 : 1;
    return left.title.localeCompare(right.title, "zh-CN") || left.publication_id.localeCompare(right.publication_id);
  });
}
