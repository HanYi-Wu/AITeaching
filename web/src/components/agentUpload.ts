export const AGENT_UPLOAD_EXTENSIONS = [
  ".txt", ".md", ".yaml", ".yml", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".rtf",
  ".xlsx", ".xls", ".docx", ".doc", ".pdf", ".pptx", ".ppt",
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif",
  ".odt", ".ods", ".odp",
] as const;

export const AGENT_UPLOAD_ACCEPT = AGENT_UPLOAD_EXTENSIONS.join(",");

export function isFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}

export function agentSendMessage(input: string, fileCount: number, fileOnlyPrompt: string): string | null {
  const text = input.trim();
  if (text) return text;
  return fileCount > 0 ? fileOnlyPrompt : null;
}

export function createAgentSubmissionGate() {
  let active = false;
  return {
    tryAcquire(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    release(): void {
      active = false;
    },
  };
}

export function shouldDispatchAgentMessage(
  typedInput: string,
  requestedFileCount: number,
  uploadedFileCount: number,
): boolean {
  return Boolean(typedInput.trim()) || requestedFileCount === 0 || uploadedFileCount > 0;
}

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
