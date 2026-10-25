import type { ComposeExportTaskCreateRequest, ComposePaperState } from "../../types/compose";
import { containsForbiddenAuthFields, isValidComposePaperState } from "./composeDraftStorage";

export type ExportSubmissionContext = {
  submitted?: ComposePaperState;
  idsToDelete: string[];
  sourceAction: "live_submit" | "retry" | "recent_resume";
};
export type PendingExportSubmissionFailure = {
  requestPayload: ComposeExportTaskCreateRequest;
  context: ExportSubmissionContext;
  reason: string;
};
const keyFor = (owner: string) => `solaire.compose.export.pending.v1:${encodeURIComponent(owner)}`;

export function retainExportSubmission(owner: string, pending: PendingExportSubmissionFailure): boolean {
  try {
    if (!owner || containsForbiddenAuthFields(pending)) return false;
    sessionStorage.setItem(keyFor(owner), JSON.stringify({ version: 1, owner, pending }));
    return true;
  } catch { return false; }
}

export function forgetExportSubmission(owner: string): void {
  try { sessionStorage.removeItem(keyFor(owner)); } catch { /* Storage can be disabled. */ }
}

export function readExportSubmission(owner: string): PendingExportSubmissionFailure | null {
  try {
    const text = sessionStorage.getItem(keyFor(owner));
    if (!text) return null;
    const stored = JSON.parse(text);
    const pending = stored.pending as PendingExportSubmissionFailure;
    const request = pending?.requestPayload;
    if (stored.version !== 1 || stored.owner !== owner || containsForbiddenAuthFields(stored)
      || !request || !["pdf", "docx"].includes(request.format) || !request.request_key
      || !Array.isArray(request.selected_items) || typeof request.export_label !== "string"
      || typeof request.subject !== "string" || typeof pending.reason !== "string"
      || !Array.isArray(pending.context?.idsToDelete) || !pending.context.idsToDelete.every((id) => typeof id === "string")
      || !["live_submit", "retry", "recent_resume"].includes(pending.context.sourceAction)
      || (pending.context.submitted && !isValidComposePaperState(pending.context.submitted))) {
      forgetExportSubmission(owner);
      return null;
    }
    return pending;
  } catch { forgetExportSubmission(owner); return null; }
}
