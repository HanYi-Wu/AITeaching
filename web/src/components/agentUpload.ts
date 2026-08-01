export const AGENT_UPLOAD_EXTENSIONS = [
  ".txt", ".md", ".yaml", ".yml", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".rtf",
  ".xlsx", ".xls", ".docx", ".doc", ".pdf", ".pptx", ".ppt",
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif",
  ".odt", ".ods", ".odp",
] as const;

export const AGENT_UPLOAD_ACCEPT = AGENT_UPLOAD_EXTENSIONS.join(",");

type StructuredUploadError = {
  detail?: { message?: unknown; suggestion?: unknown } | unknown;
  message?: unknown;
};

export function formatUploadFailure(name: string, error: unknown): string {
  let reason = "";
  if (error instanceof Error) {
    reason = error.message;
  } else if (error && typeof error === "object") {
    const candidate = error as StructuredUploadError;
    if (candidate.detail && typeof candidate.detail === "object") {
      const detail = candidate.detail as { message?: unknown; suggestion?: unknown };
      const message = typeof detail.message === "string" ? detail.message.trim() : "";
      const suggestion = typeof detail.suggestion === "string" ? detail.suggestion.trim() : "";
      reason = [message, suggestion].filter(Boolean).join(" ");
    }
    if (!reason && typeof candidate.message === "string") reason = candidate.message;
  } else if (error != null) {
    reason = String(error);
  }
  return reason ? `${name} — ${reason}` : name;
}
