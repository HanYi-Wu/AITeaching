import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

const LazyPdfPreview = lazy(() =>
  import("../../components/PdfPreview").then(({ PdfPreview }) => ({ default: PdfPreview })),
);

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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overwrite-dialog-title"
    >
      <div className="or-g49-dialog-surface max-w-md w-full p-4 sm:p-6">
        <h2 id="overwrite-dialog-title" className="text-lg font-semibold text-[var(--or-text)]">
          {t("compose:overwriteTitle")}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-[var(--or-muted)]">{t("compose:overwriteBody")}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="or-g49-btn or-g49-btn-secondary"
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            className="or-g49-btn bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
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
      className="fixed inset-0 z-[80] flex flex-col bg-slate-950/60 p-2 sm:p-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="试卷预览"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-t-2xl border border-b-0 border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] px-5 py-3">
        <h2 className="text-base font-semibold text-[var(--or-text)]">试卷预览</h2>
        <button
          type="button"
          className="or-g49-btn or-g49-btn-secondary py-1.5 px-3 text-sm"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto rounded-b-2xl border border-t-0 border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-4 shadow-xl">
        <Suspense fallback={<p className="text-sm text-[var(--or-muted)]" role="status">正在加载 PDF 预览…</p>}>
          <LazyPdfPreview apiPath={pdfPath} className="min-h-full" />
        </Suspense>
      </div>
    </div>
  );
}
