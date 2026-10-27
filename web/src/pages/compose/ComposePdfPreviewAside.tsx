import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

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
    <aside className="hidden min-h-0 w-full flex-col border-slate-200 bg-white shadow-xl xl:relative xl:z-auto xl:flex xl:translate-x-0 xl:shadow-none xl:static xl:h-auto xl:w-auto xl:min-w-0 xl:flex-1 xl:basis-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-medium text-slate-600">{t("compose:pdfVariantLabel")}</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          value={pdfVariant}
          onChange={(e) =>
            onPdfVariantChange(e.target.value === "teacher" ? "teacher" : "student")
          }
        >
          <option value="student">{t("compose:pdfVariantStudent")}</option>
          <option value="teacher">{t("compose:pdfVariantTeacher")}</option>
        </select>
        {pdfExamId && !previewPdfId ? (
          <button
            type="button"
            className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800"
            onClick={() => onDownloadPdfBundle(pdfExamId)}
          >
            下载正式 PDF
          </button>
        ) : null}
        {pdfExamId && !previewPdfId ? (
          <button
            type="button"
            className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
            disabled={busy || viewPdfBusy}
            onClick={onOpenPdfExternally}
          >
            {t("compose:openPdfExternal")}
          </button>
        ) : null}
        {wordOpenExamId && !previewPdfId ? (
          <button
            type="button"
            className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800"
            onClick={() => onDownloadWordBundle(wordOpenExamId)}
          >
            下载正式 Word
          </button>
        ) : null}
        {wordOpenExamId && !previewPdfId ? (
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
            disabled={busy || viewWordBusy}
            onClick={onOpenWordExternally}
          >
            {t("compose:openWordExternal")}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {composeRightPdfPath ? (
          <Suspense fallback={<p className="text-xs text-slate-500" role="status">正在加载 PDF 预览…</p>}>
            <LazyPdfPreview apiPath={composeRightPdfPath} className="min-h-[min(70vh,560px)]" />
          </Suspense>
        ) : (
          <p className="text-xs text-slate-500">{t("compose:previewPdfEmptyHint")}</p>
        )}
      </div>
    </aside>
  );
}
