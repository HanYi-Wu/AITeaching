import { type PaperPublicationRecord, type PlatformPaperRecord } from "../../../platform/auth";

export type PaperQuery = {
  directId?: string;
  q: string;
  deliveryMode: "all" | "offline" | "online";
  status: string;
  page: number;
  pageSize: number;
};

export type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

export function deliveryLabel(mode: PlatformPaperRecord["delivery_mode"]): string {
  return mode === "online" ? "线上" : "线下";
}

export function mergePaper(existing: PlatformPaperRecord, patch: PlatformPaperRecord): PlatformPaperRecord {
  return {
    ...existing,
    ...patch,
    question_count: patch.question_count ?? existing.question_count,
    section_count: patch.section_count ?? existing.section_count,
    score_batch_count: patch.score_batch_count ?? existing.score_batch_count,
    publication_count: patch.publication_count ?? existing.publication_count,
    published_class_count: patch.published_class_count ?? existing.published_class_count,
  };
}

export function mergeMeta(
  data: { total?: number; page?: number; page_size?: number; total_pages?: number },
  fallback: PaperQuery,
  itemCount: number,
): PageMeta {
  const pageSize = Number(data.page_size ?? fallback.pageSize);
  const total = Number(data.total ?? itemCount);
  return {
    total,
    page: Number(data.page ?? fallback.page),
    pageSize,
    totalPages: Number(data.total_pages ?? Math.max(1, Math.ceil(total / pageSize))),
  };
}

export function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function publicationStatusLabel(status: string): string {
  if (status === "published") return "发布中";
  if (status === "paused") return "已暂停";
  if (status === "closed") return "已关闭";
  if (status === "revoked") return "已撤回";
  return "草稿";
}

export function publicationWindowLabel(publication: PaperPublicationRecord, now: number) {
  if (publication.status !== 'published') return publicationStatusLabel(publication.status);
  const time = (value?: string | null) => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + '+08:00').getTime() : null;
  const start = time(publication.start_at), end = time(publication.end_at);
  return end !== null && now >= end ? '已结束' : start !== null && now < start ? '未开始' : '进行中';
}

export function submissionStatusLabel(status?: string | null): string {
  return ({ not_started: "未开始", in_progress: "答题中", submitted: "已提交", completed: "已完成" } as Record<string, string>)[status || ""] ?? status ?? "未知状态";
}

export function gradingStatusLabel(status?: string | null): string {
  return ({ pending: "待批改", auto_scored: "已自动判分，待复核", needs_review: "AI 建议待复核", reviewed: "教师已复核" } as Record<string, string>)[status || ""] ?? status ?? "待批改";
}

export function formatStudentAnswer(value: unknown): string {
  if (value == null) return "未作答";
  if (typeof value === "string") return value.trim() || "未作答";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
