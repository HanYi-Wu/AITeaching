import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Select as AppSelect } from "../../components/ui/select";

const LazyPdfPreview = lazy(() =>
  import("../../components/PdfPreview").then(({ PdfPreview }) => ({ default: PdfPreview })),
);

export type ComposePdfPreviewAsideProps = {
  busy: boolean;
  pdfVariant: "student" | "teacher";
  onPdfVariantChange: (variant: "student" | "teacher") => void;
  pdfExamId: string | null;
  previewPdfId: string | null;
  wordOpenExamId: string | null;
  composeRightPdfPath: string | null;
  viewPdfBusy: boolean;
  viewWordBusy: boolean;
  onDownloadPdfBundle: (examId: string) => void;
  onDownloadWordBundle: (examId: string) => void;
  onOpenPdfExternally: () => void;
  onOpenWordExternally: () => void;
};

export function ComposePdfPreviewAside({
  busy,
  pdfVariant,
  onPdfVariantChange,
  pdfExamId,
  previewPdfId,
  wordOpenExamId,
  composeRightPdfPath,
  viewPdfBusy,
  viewWordBusy,
  onDownloadPdfBundle,
  onDownloadWordBundle,
  onOpenPdfExternally,
  onOpenWordExternally,
}: ComposePdfPreviewAsideProps) {
  const { t } = useTranslation(["compose", "common"]);

  return (
    <aside
      className="or-g49-compose-pdf-aside"
      aria-label="PDF 预览"
      data-has-pdf={composeRightPdfPath ? "true" : "false"}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] px-4 py-2.5">
        <span className="text-sm font-medium text-[var(--or-muted)]">{t("compose:pdfVariantLabel")}</span>
        <AppSelect
          className="or-g49-input py-1 text-sm font-medium"
          value={pdfVariant}
          onValueChange={(value) =>
            onPdfVariantChange(value === "teacher" ? "teacher" : "student")
          }
        >
          <option value="student">{t("compose:pdfVariantStudent")}</option>
          <option value="teacher">{t("compose:pdfVariantTeacher")}</option>
        </AppSelect>
        {pdfExamId && !previewPdfId ? (
          <button
            type="button"
            className="or-g49-btn or-g49-btn-tonal text-xs py-1"
            onClick={() => onDownloadPdfBundle(pdfExamId)}
          >
            下载正式 PDF
          </button>
        ) : null}
        {pdfExamId && !previewPdfId ? (
          <button
            type="button"
            className="ml-auto or-g49-btn or-g49-btn-secondary text-xs py-1 disabled:opacity-50"
            disabled={busy || viewPdfBusy}
            onClick={onOpenPdfExternally}
          >
            {t("compose:openPdfExternal")}
          </button>
        ) : null}
        {wordOpenExamId && !previewPdfId ? (
          <button
            type="button"
            className="or-g49-btn or-g49-btn-tonal text-xs py-1"
            onClick={() => onDownloadWordBundle(wordOpenExamId)}
          >
            下载正式 Word
          </button>
        ) : null}
        {wordOpenExamId && !previewPdfId ? (
          <button
            type="button"
            className="or-g49-btn or-g49-btn-secondary text-xs py-1 disabled:opacity-50"
            disabled={busy || viewWordBusy}
            onClick={onOpenWordExternally}
          >
            {t("compose:openWordExternal")}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        {composeRightPdfPath ? (
          <Suspense fallback={<p className="p-4 text-sm font-medium text-[var(--or-muted)]" role="status">正在加载 PDF 预览…</p>}>
            <LazyPdfPreview apiPath={composeRightPdfPath} className="min-h-[min(70vh,560px)]" />
          </Suspense>
        ) : (
          <div className="flex h-64 items-center justify-center p-6 text-center">
            <p className="text-sm text-[var(--or-muted)]">{t("compose:previewPdfEmptyHint")}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
