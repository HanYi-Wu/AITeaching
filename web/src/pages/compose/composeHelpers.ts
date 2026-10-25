import { apiGetBlob } from "../../api/client";
import { isChoiceQuestionType, normalizeQuestionTypeForFilter } from "../../lib/questionTypes";
import { saveBlobToDisk } from "../../lib/saveBlobToDisk";
import i18n from "../../i18n/i18n";

export async function downloadExportedBundle(examId: string, format: "pdf" | "docx") {
  const blob = await apiGetBlob(`/api/exams/download/${encodeURIComponent(examId)}?format=${format}`);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error(i18n.t("compose:errors.invalidExportBundle")));
    reader.readAsArrayBuffer(blob.slice(0, 4));
  });
  const header = new Uint8Array(bytes);
  if (header.length !== 4 || header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 3 || header[3] !== 4) {
    throw new Error(i18n.t("compose:errors.invalidExportBundle"));
  }
  return saveBlobToDisk(blob, {
    defaultFileName: `${examId.replace(/[\\/]/g, "-")}-${format}-学生版与教师版.zip`,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
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
