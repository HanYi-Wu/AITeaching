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
      <div className={className}>
        <p className="text-sm text-red-600" role="alert">
          {loadError}
        </p>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-2 rounded border px-3 py-1 text-sm">重新加载预览</button>
      </div>
    );
  }

  if (!fileUrl) {
    return (
      <div className={className}>
        <p className="text-sm text-slate-500">{t("common:processing")}</p>
      </div>
    );
  }

  const pageWidth = Math.round(boxWidth * zoom);

  return (
    <div ref={wrapRef} className={cn("w-full min-w-0 max-w-full overflow-auto", className)}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-white p-2 text-sm">
        <button type="button" onClick={() => setZoom((z) => clampZoom(z / 1.2))} className="rounded border px-2 py-1" aria-label="缩小预览">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => clampZoom(z * 1.2))} className="rounded border px-2 py-1" aria-label="放大预览">＋</button>
        <button type="button" onClick={() => setZoom(1)} className="rounded border px-2 py-1">适应宽度</button>
        <span>{numPages} 页</span>
        <a href={fileUrl} download="试卷预览.pdf" className="ml-auto underline">下载预览</a>
      </div>
      <Document
        file={fileUrl}
        options={PDF_OPTIONS}
        loading={<p className="text-sm text-slate-500">{t("common:processing")}</p>}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => {
          URL.revokeObjectURL(fileUrl);
          setFileUrl(null);
          setLoadError(err.message);
        }}
      >
        <div className="flex flex-col items-center gap-4 pb-4">
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i + 1}
              pageNumber={i + 1}
              className="shadow-md"
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
