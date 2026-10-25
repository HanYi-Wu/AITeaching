import { useTranslation } from "react-i18next";
import type { ExamWorkspaceSummary, TemplateRow } from "../../types/compose";

export type NewPaperDialogProps = {
  open: boolean;
  busy: boolean;
  mode: "scratch" | "history";
  onModeChange: (mode: "scratch" | "history") => void;
  exportLabel: string;
  onExportLabelChange: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  subjectOptions: string[];
  templates: TemplateRow[];
  selectedTemplate: TemplateRow | undefined;
  onTemplatePathChange: (path: string) => void;
  exportedExamRows: ExamWorkspaceSummary[];
  historySourceExamId: string;
  onHistorySourceExamIdChange: (examId: string) => void;
  historyExportLabel: string;
  onHistoryExportLabelChange: (value: string) => void;
  selectedPastExam: ExamWorkspaceSummary | undefined;
  onCancel: () => void;
  onConfirm: () => void;
};

export function NewPaperDialog({
  open,
  busy,
  mode,
  onModeChange,
  exportLabel,
  onExportLabelChange,
  subject,
  onSubjectChange,
  subjectOptions,
  templates,
  selectedTemplate,
  onTemplatePathChange,
  exportedExamRows,
  historySourceExamId,
  onHistorySourceExamIdChange,
  historyExportLabel,
  onHistoryExportLabelChange,
  selectedPastExam,
  onCancel,
  onConfirm,
}: NewPaperDialogProps) {
  const { t } = useTranslation(["compose", "common"]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-paper-dialog-title"
    >
      <div className="max-w-lg w-full rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="new-paper-dialog-title" className="text-base font-semibold text-slate-900">
          {t("compose:newPaperDialogTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("compose:newPaperDialogHint")}</p>
        <div className="mt-4 flex gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="np-mode"
              checked={mode === "scratch"}
              onChange={() => onModeChange("scratch")}
            />
            {t("compose:newPaperModeScratch")}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="np-mode"
              checked={mode === "history"}
              onChange={() => onModeChange("history")}
            />
            {t("compose:newPaperModeHistory")}
          </label>
        </div>
        {mode === "history" ? (
          <>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t("compose:newPaperPickHistory")}
              <select
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={historySourceExamId}
                onChange={(e) => onHistorySourceExamIdChange(e.target.value)}
              >
                <option value="">{t("compose:newPaperPickHistoryPlaceholder")}</option>
                {exportedExamRows.map((ex) => (
                  <option key={ex.exam_id} value={ex.exam_id}>
                    {ex.export_label || ex.name || ex.exam_id}
                    {ex.subject ? ` · ${ex.subject}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t("compose:examLabel")}
              <input
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={historyExportLabel}
                onChange={(e) => onHistoryExportLabelChange(e.target.value)}
                placeholder={t("compose:newPaperHistoryExamLabelPlaceholder")}
                autoComplete="off"
              />
            </label>
            <div className="mt-4">
              <div className="text-xs font-medium text-slate-600">
                {t("compose:subjectFromHistoryReadonly")}
              </div>
              <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800">
                {selectedPastExam?.subject?.trim() || "—"}
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t("compose:examLabel")}
              <input
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={exportLabel}
                onChange={(e) => onExportLabelChange(e.target.value)}
              />
            </label>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t("compose:subjectPdf")}
              <select
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={subject}
                onChange={(e) => onSubjectChange(e.target.value)}
              >
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t("compose:template")}
              <select
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={selectedTemplate?.path ?? ""}
                onChange={(e) => onTemplatePathChange(e.target.value)}
              >
                {templates.length === 0 && <option value="">{t("compose:templatesMissing")}</option>}
                {templates.map((tp) => (
                  <option key={tp.path} value={tp.path}>
                    {tp.id}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={busy || (mode === "scratch" && !selectedTemplate)}
            onClick={onConfirm}
          >
            {t("compose:newPaperDialogConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
