export type ExamSavedPayload = { exam_id: string; name: string };

/** @deprecated 使用 ExamSavedPayload */
export type DraftSavedPayload = ExamSavedPayload;

export class ApiError extends Error {
  readonly status: number;
  readonly examSaved?: ExamSavedPayload;

  constructor(message: string, status: number, opts?: { examSaved?: ExamSavedPayload }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.examSaved = opts?.examSaved;
  }
}

/** Prefer RFC 5987 filename* (UTF-8) so non-ASCII names from the backend are preserved. */
export function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) {
    return null;
  }
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const m = /filename="([^"]+)"/.exec(cd);
  return m?.[1] ?? null;
}

export async function parseDetailFromResponse(r: Response): Promise<{
  message: string;
  examSaved?: ExamSavedPayload;
}> {
  try {
    const j = (await r.json()) as { detail?: unknown };
    if (typeof j.detail === "string") {
      return { message: j.detail };
    }
    if (Array.isArray(j.detail)) {
      return {
        message: j.detail
          .map((x: { msg?: string }) => x?.msg)
          .filter(Boolean)
          .join("; "),
      };
    }
    if (j.detail && typeof j.detail === "object" && !Array.isArray(j.detail)) {
      const d = j.detail as Record<string, unknown>;
      let msg =
        typeof d.message === "string" && d.message.trim()
          ? d.message
          : r.statusText || "Request failed";
      if (typeof d.suggestion === "string" && d.suggestion.trim()) {
        msg = `${msg} ${d.suggestion}`;
      }
      const raw = d.exam_saved ?? d.draft_saved;
      let examSaved: ExamSavedPayload | undefined;
      if (raw && typeof raw === "object" && raw !== null) {
        const o = raw as Record<string, unknown>;
        const eid = typeof o.exam_id === "string" ? o.exam_id : typeof o.draft_id === "string" ? o.draft_id : "";
        if (eid) {
          examSaved = { exam_id: eid, name: typeof o.name === "string" ? o.name : "" };
        }
      }
      return { message: msg, examSaved };
    }
  } catch {
    /* ignore */
  }
  return { message: r.statusText || "Request failed" };
}
