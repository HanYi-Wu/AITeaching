import { useTranslation } from "react-i18next";
import { FolderOpen, Upload, X, Trash2, FileText, Plus } from "lucide-react";
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
    <div className="space-y-3.5">
      <h3 className="text-sm font-semibold text-[var(--or-text)] ">
        {t("boundFiles")}
      </h3>

      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          className="or-g50-btn or-g50-btn-primary flex-1"
          onClick={() => setFileOpen(true)}
        >
          <FolderOpen className="h-4 w-4" />
          <span>{t("pickProjectFile")}</span>
        </button>

        <label className="or-g50-btn or-g50-btn-secondary cursor-pointer">
          <Upload className="h-4 w-4" />
          <span>{t("uploadAndLink")}</span>
          <input
            type="file"
            className="hidden"
            onChange={(e) => void uploadAndAttach(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <ul className="space-y-2">
        {nodeFiles.map((l) => (
          <li
            key={l.id}
            className="flex items-center justify-between gap-2.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 shadow-sm  "
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="h-4 w-4 shrink-0 text-[var(--or-on-container)] " />
              <a
                className="break-all text-sm font-medium text-[var(--or-on-container)] hover:underline "
                href={resourceApiUrl(l.relative_path)}
                target="_blank"
                rel="noreferrer"
              >
                {l.relative_path}
              </a>
            </div>
            <button
              type="button"
              className="or-g50-btn or-g50-btn-danger !h-7 !px-2.5 !text-xs font-medium shrink-0"
              onClick={() => void detachFile(l.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t("remove")}</span>
            </button>
          </li>
        ))}
        {nodeFiles.length === 0 ? (
          <li className="py-4 text-center text-sm text-[var(--or-muted)] ">
            {t("noFiles")}
          </li>
        ) : null}
      </ul>

      {/* File picker modal */}
      {fileOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden flex flex-col rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl  ">
            <div className="flex items-center justify-between border-b border-[var(--or-outline)] px-5 py-4 ">
              <h3 className="text-base font-semibold text-[var(--or-text)] ">
                {t("pickFileTitle")}
              </h3>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-muted)] dark:hover:bg-[var(--or-primary)] dark:hover:text-[var(--or-on-primary)]"
                onClick={() => setFileOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] border-b border-[var(--or-outline)]  ">
              <label className="block text-xs font-medium text-[var(--or-muted)] ">
                <span>{t("searchPath")}</span>
                <input
                  className="or-g50-input mt-1.5 w-full"
                  value={fileQ}
                  onChange={(e) => setFileQ(e.target.value)}
                  placeholder={t("filterPh")}
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[45vh] p-4">
              <ul className="space-y-1">
                {fileList.map((f) => (
                  <li key={f.path}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl p-2 hover:bg-[var(--or-page)] dark:hover:bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]  "
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
                      <span className="flex-1 break-all font-mono text-xs text-[var(--or-text)] ">
                        {f.path}
                      </span>
                    </label>
                  </li>
                ))}
                {fileList.length === 0 ? (
                  <li className="py-6 text-center text-sm text-[var(--or-muted)]">
                    {t("noFiles")}
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-[var(--or-outline)] px-5 py-3.5 ">
              <button
                type="button"
                className="or-g50-btn or-g50-btn-secondary"
                onClick={() => setFileOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="or-g50-btn or-g50-btn-primary"
                onClick={() => void attachSelectedFiles()}
              >
                <Plus className="h-4 w-4" />
                <span>{t("linkToNode")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
