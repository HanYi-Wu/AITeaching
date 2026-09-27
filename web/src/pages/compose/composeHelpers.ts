import { apiGetBlob } from "../../api/client";
import { isChoiceQuestionType, normalizeQuestionTypeForFilter } from "../../lib/questionTypes";

export async function downloadExportedBundle(examId: string, format: "pdf" | "docx") {
  const blob = await apiGetBlob(`/api/exams/download/${encodeURIComponent(examId)}?format=${format}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${examId.replace(/[\\/]/g, "-")}-${format}-学生版与教师版.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 与后端 `_norm_template_path_rel` 一致：去掉 ``../``，与 ``/api/templates`` 列表匹配 */
export function normTemplatePath(p: string): string {
  let s = p.replace(/\\/g, "/").trim();
  while (s.startsWith("../")) {
    s = s.slice(3);
  }
  return s.replace(/^\/+/, "");
}

export function questionTypeMatchesSection(questionType: string, sectionType: string, answer?: string | null) {
  if (sectionType === "practice") {
    return true;
  }
  const normalizedType = normalizeQuestionTypeForFilter(questionType, answer);
  if (sectionType === "choice") {
    return isChoiceQuestionType(questionType) || isChoiceQuestionType(normalizedType);
  }
  return normalizedType === sectionType;
}

export function sectionTypeToFilter(section: { section_id: string; type: string }) {
  if (section.type === "practice") {
    return "__all__";
  }
  if (section.type !== "choice") {
    return section.type;
  }
  return /多选|多项|multiple/i.test(section.section_id) ? "multiple_choice" : "single_choice";
}
