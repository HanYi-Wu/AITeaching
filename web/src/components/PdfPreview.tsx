import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { apiGetBlob } from "../api/client";
import { cn } from "../lib/utils";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Props = {
  /** 以 `/api/...` 开头的相对路径 */
  apiPath: string;
  className?: string;
};

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
const PDF_OPTIONS = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
};

export function PdfPreview({ apiPath, className }: Props) {
  const { t } = useTranslation(["compose", "common"]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [boxWidth, setBoxWidth] = useState(() =>
    typeof window !== "undefined" ? Math.min(900, Math.max(280, window.innerWidth - 120)) : 800,
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const clampZoom = useCallback((z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000)), []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const run = async () => {
      setLoadError(null);
      setFileUrl(null);
      setNumPages(0);
      setZoom(1);
      try {
        const blob = await apiGetBlob(apiPath);
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setFileUrl(objectUrl);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiPath, retry]);

  useEffect(() => {
    if (!fileUrl) return;
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      if (w > 0) setBoxWidth(Math.min(900, Math.max(240, w - 8)));
    };
    sync();
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fileUrl]);

  useEffect(() => {
    if (!fileUrl) return;
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => clampZoom(z * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fileUrl, clampZoom]);

  if (loadError) {
    return (
      <div className={cn("p-4 rounded-xl border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_90%,transparent)]", className)}>
        <p className="text-sm font-medium text-[var(--or-on-error)]" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => setRetry((n) => n + 1)}
          className="mt-3 or-g49-btn border border-red-300 bg-[var(--or-card)] text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] text-sm py-1.5 px-3"
        >
          重新加载预览
        </button>
      </div>
    );
  }

  if (!fileUrl) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <p className="text-sm font-medium text-[var(--or-muted)]">{t("common:processing")}</p>
      </div>
    );
  }

  const pageWidth = Math.round(boxWidth * zoom);

  return (
    <div ref={wrapRef} className={cn("w-full min-w-0 max-w-full overflow-auto rounded-xl", className)}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-card)_95%,transparent)] px-3 py-2 text-sm shadow-xs backdrop-blur-xs">
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z / 1.2))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] text-base font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
          aria-label="缩小预览"
        >
          −
        </button>
        <span className="min-w-12 text-center font-mono text-sm font-semibold text-[var(--or-text)] tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z * 1.2))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] text-base font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
          aria-label="放大预览"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="or-g49-btn or-g49-btn-secondary text-sm py-1 px-2.5"
        >
          适应宽度
        </button>
        <span className="or-g49-pill bg-[var(--or-block)] text-[var(--or-muted)] font-medium text-[13px]">
          {numPages} 页
        </span>
        <a
          href={fileUrl}
          download="试卷预览.pdf"
          className="ml-auto text-sm font-medium text-[var(--or-on-container)] hover:text-[var(--or-on-container)] hover:underline"
        >
          下载预览
        </a>
      </div>
      <Document
        file={fileUrl}
        options={PDF_OPTIONS}
        loading={
          <div className="flex items-center justify-center py-10">
            <p className="text-sm font-medium text-[var(--or-muted)]">{t("common:processing")}</p>
          </div>
        }
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => {
          URL.revokeObjectURL(fileUrl);
          setFileUrl(null);
          setLoadError(err.message);
        }}
      >
        <div className="flex flex-col items-center gap-5 p-4 pb-6">
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i + 1}
              pageNumber={i + 1}
              className="rounded-sm shadow-md ring-1 ring-black/5"
              width={pageWidth}
              renderTextLayer
              renderAnnotationLayer
            />
          ))}
        </div>
      </Document>
    </div>
  );
}
