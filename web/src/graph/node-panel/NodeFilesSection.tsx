import { useTranslation } from "react-i18next";
import { resourceApiUrl } from "../../api/client";
import type { NodeFileLink, ResourceFileEntry } from "./types";

export interface NodeFilesSectionProps {
  nodeFiles: NodeFileLink[];
  fileOpen: boolean;
  setFileOpen: (v: boolean) => void;
  fileQ: string;
  setFileQ: (v: string) => void;
  fileList: ResourceFileEntry[];
  fileSel: Set<string>;
  setFileSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  attachSelectedFiles: () => Promise<void>;
  uploadAndAttach: (file: File | null) => Promise<void>;
  detachFile: (linkId: string) => Promise<void>;
}

export function NodeFilesSection({
  nodeFiles,
  fileOpen,
  setFileOpen,
  fileQ,
  setFileQ,
  fileList,
  fileSel,
  setFileSel,
  attachSelectedFiles,
  uploadAndAttach,
  detachFile,
}: NodeFilesSectionProps) {
  const { t } = useTranslation("graph");

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-slate-700">{t("boundFiles")}</h3>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="flex-1 rounded-md bg-slate-900 py-2 text-sm font-medium text-white"
          onClick={() => setFileOpen(true)}
        >
          {t("pickProjectFile")}
        </button>
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900">
          {t("uploadAndLink")}
          <input
            type="file"
            className="hidden"
            onChange={(e) => void uploadAndAttach(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <ul className="space-y-1 text-xs">
        {nodeFiles.map((l) => (
          <li
            key={l.id}
            className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white p-1.5"
          >
            <a
              className="break-all text-blue-700 underline"
              href={resourceApiUrl(l.relative_path)}
              target="_blank"
              rel="noreferrer"
            >
              {l.relative_path}
            </a>
            <button
              type="button"
              className="shrink-0 text-red-600"
              onClick={() => void detachFile(l.id)}
            >
              {t("remove")}
            </button>
          </li>
        ))}
        {nodeFiles.length === 0 ? (
          <li className="text-slate-400">{t("noFiles")}</li>
        ) : null}
      </ul>

      {/* File picker modal */}
      {fileOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("pickFileTitle")}</h3>
              <button
                type="button"
                className="text-sm text-slate-600"
                onClick={() => setFileOpen(false)}
              >
                {t("close")}
              </button>
            </div>
            <label className="mt-3 block text-[11px] font-medium text-slate-600">
              {t("searchPath")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={fileQ}
                onChange={(e) => setFileQ(e.target.value)}
                placeholder={t("filterPh")}
              />
            </label>
            <ul className="mt-2 max-h-[45vh] space-y-0.5 overflow-auto text-xs">
              {fileList.map((f) => (
                <li key={f.path}>
                  <label className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={fileSel.has(f.path)}
                      onChange={() => {
                        setFileSel((prev) => {
                          const n = new Set(prev);
                          if (n.has(f.path)) n.delete(f.path);
                          else n.add(f.path);
                          return n;
                        });
                      }}
                    />
                    <span className="flex-1 break-all font-mono">{f.path}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setFileOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                onClick={() => void attachSelectedFiles()}
              >
                {t("linkToNode")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
