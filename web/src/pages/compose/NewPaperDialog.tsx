import { useTranslation } from "react-i18next";
import type { ExamWorkspaceSummary, TemplateRow } from "../../types/compose";
import { Select as AppSelect } from "../../components/ui/select";

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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-paper-dialog-title"
    >
      <div className="or-g49-dialog-surface max-h-[92vh] max-w-lg w-full overflow-y-auto p-4 sm:p-6">
        <h2 id="new-paper-dialog-title" className="text-lg font-semibold text-[var(--or-text)]">
          {t("compose:newPaperDialogTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--or-muted)]">{t("compose:newPaperDialogHint")}</p>

        <div className="mt-5 flex gap-4 text-sm font-medium">
          <label className="flex cursor-pointer items-center gap-2 text-[var(--or-text)]">
            <input
              type="radio"
              name="np-mode"
              checked={mode === "scratch"}
              onChange={() => onModeChange("scratch")}
              className="h-4 w-4 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
            />
            {t("compose:newPaperModeScratch")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[var(--or-text)]">
            <input
              type="radio"
              name="np-mode"
              checked={mode === "history"}
              onChange={() => onModeChange("history")}
              className="h-4 w-4 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
            />
            {t("compose:newPaperModeHistory")}
          </label>
        </div>

        {mode === "history" ? (
          <div className="space-y-4 mt-4">
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              {t("compose:newPaperPickHistory")}
              <AppSelect
                className="or-g49-input mt-1 block w-full"
                value={historySourceExamId}
                onValueChange={(value) => onHistorySourceExamIdChange(value)}
              >
                <option value="">{t("compose:newPaperPickHistoryPlaceholder")}</option>
                {exportedExamRows.map((ex) => (
                  <option key={ex.exam_id} value={ex.exam_id}>
                    {ex.export_label || ex.name || ex.exam_id}
                    {ex.subject ? ` · ${ex.subject}` : ""}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              {t("compose:examLabel")}
              <input
                className="or-g49-input mt-1 block w-full"
                value={historyExportLabel}
                onChange={(e) => onHistoryExportLabelChange(e.target.value)}
                placeholder={t("compose:newPaperHistoryExamLabelPlaceholder")}
                autoComplete="off"
              />
            </label>
            <div>
              <div className="text-sm font-medium text-[var(--or-muted)]">
                {t("compose:subjectFromHistoryReadonly")}
              </div>
              <div className="mt-1 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] px-3 py-2 text-sm text-[var(--or-text)] font-medium">
                {selectedPastExam?.subject?.trim() || "—"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              {t("compose:examLabel")}
              <input
                className="or-g49-input mt-1 block w-full"
                value={exportLabel}
                onChange={(e) => onExportLabelChange(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              {t("compose:subjectPdf")}
              <AppSelect
                className="or-g49-input mt-1 block w-full"
                value={subject}
                onValueChange={(value) => onSubjectChange(value)}
              >
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              {t("compose:template")}
              <AppSelect
                className="or-g49-input mt-1 block w-full"
                value={selectedTemplate?.path ?? ""}
                onValueChange={(value) => onTemplatePathChange(value)}
              >
                {templates.length === 0 && <option value="">{t("compose:templatesMissing")}</option>}
                {templates.map((tp) => (
                  <option key={tp.path} value={tp.path}>
                    {tp.id}
                  </option>
                ))}
              </AppSelect>
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="or-g49-btn or-g49-btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            className="or-g49-btn or-g49-btn-primary"
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
