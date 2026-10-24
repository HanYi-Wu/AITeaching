import { useTranslation } from "react-i18next";
import { PdfPreview } from "../../components/PdfPreview";

export function OverwriteExportDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(["compose", "common"]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overwrite-dialog-title"
    >
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="overwrite-dialog-title" className="text-base font-semibold text-slate-900">
          {t("compose:overwriteTitle")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{t("compose:overwriteBody")}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
            disabled={busy}
            onClick={onConfirm}
          >
            {t("compose:overwriteExport")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PreviewPdfModal({
  open,
  pdfPath,
  onClose,
}: {
  open: boolean;
  pdfPath: string | null;
  onClose: () => void;
}) {
  if (!open || !pdfPath) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-slate-900/70 p-3 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="试卷预览"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-t-lg bg-white px-4 py-2">
        <h2 className="text-sm font-semibold">试卷预览</h2>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 text-sm"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto rounded-b-lg bg-white p-3">
        <PdfPreview apiPath={pdfPath} className="min-h-full" />
      </div>
    </div>
  );
}
