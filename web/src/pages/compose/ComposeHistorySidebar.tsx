import { useTranslation } from "react-i18next";
import { ContentFolders } from "../../components/ContentFolders";
import { TagChips } from "../../components/ContentTags";
import { cn } from "../../lib/utils";
import type { ContentFolder, ContentTag, FolderDeleteResult } from "../../platform/auth";
import type { ExamWorkspaceSummary } from "../../types/compose";

export type ComposeHistorySidebarProps = {
  busy: boolean;
  currentExamId: string | null;
  composeFolders: ContentFolder[];
  selectedComposeFolderId: string | null;
  onSelectComposeFolder: (folderId: string | null) => void;
  onFolderCreated: (folder: ContentFolder) => void;
  onFolderUpdated: (folder: ContentFolder) => void;
  onFolderDeleted: (result: FolderDeleteResult) => void;
  onDropItemToFolder: (itemId: string, folderId: string | null) => void;
  draftExamRows: ExamWorkspaceSummary[];
  exportedExamRows: ExamWorkspaceSummary[];
  taggedItems: Record<string, ContentTag[]>;
  onLoadDraftExam: (examId: string) => void;
  onLoadExportedExam: (exam: ExamWorkspaceSummary) => void;
  onDeleteExam: (examId: string, opts?: { exported?: boolean }) => void;
  onError: (msg: string | null) => void;
};

export function ComposeHistorySidebar({
  busy,
  currentExamId,
  composeFolders,
  selectedComposeFolderId,
  onSelectComposeFolder,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
  onDropItemToFolder,
  draftExamRows,
  exportedExamRows,
  taggedItems,
  onLoadDraftExam,
  onLoadExportedExam,
  onDeleteExam,
  onError,
}: ComposeHistorySidebarProps) {
  const { t } = useTranslation(["compose", "common"]);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50 xl:w-56">
      <div className="shrink-0 p-2">
        <ContentFolders
          scope="compose"
          folders={composeFolders}
          selectedId={selectedComposeFolderId}
          onSelect={onSelectComposeFolder}
          onCreated={onFolderCreated}
          onUpdated={onFolderUpdated}
          onDeleted={onFolderDeleted}
          onDropItem={onDropItemToFolder}
          onError={onError}
        />
      </div>
      <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-2">
        <h2 className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          {t("compose:historySidebarTitle")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        <div>
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t("compose:draftsGroup")}
          </p>
          {draftExamRows.length === 0 ? (
            <p className="px-1 text-xs text-slate-500">{t("compose:historyDraftEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {draftExamRows.map((d) => (
                <li key={d.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-or-content-item",
                        JSON.stringify({ scope: "compose", id: d.exam_id }),
                      )
                    }
                    className={cn(
                      "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs [overflow-wrap:anywhere]",
                      currentExamId === d.exam_id
                        ? "border-slate-900 bg-slate-100"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    disabled={busy}
                    onClick={() => onLoadDraftExam(d.exam_id)}
                  >
                    <span className="font-medium text-slate-900">{d.name || d.exam_id}</span>
                    <span className="ml-1 inline-block whitespace-nowrap rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                      临时
                    </span>
                    {(taggedItems[d.exam_id]?.length ?? 0) > 0 ? (
                      <TagChips tags={taggedItems[d.exam_id]!} />
                    ) : null}
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {t("compose:examStatusEditing")}
                    </span>
                    {d.export_label ? (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {d.export_label}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                    disabled={busy}
                    title={t("compose:deleteDraft")}
                    aria-label={t("compose:deleteDraft")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteExam(d.exam_id);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t("compose:historyGroup")}
          </p>
          {exportedExamRows.length === 0 ? (
            <p className="px-1 text-xs text-slate-500">{t("compose:historyExamEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {exportedExamRows.map((ex) => (
                <li key={ex.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-or-content-item",
                        JSON.stringify({ scope: "compose", id: ex.exam_id }),
                      )
                    }
                    className={cn(
                      "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs [overflow-wrap:anywhere]",
                      currentExamId === ex.exam_id
                        ? "border-slate-900 bg-slate-100"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    disabled={busy}
                    onClick={() => onLoadExportedExam(ex)}
                  >
                    <span className="font-medium text-slate-900">
                      {ex.export_label || ex.name || ex.exam_id}
                    </span>
                    {(taggedItems[ex.exam_id]?.length ?? 0) > 0 ? (
                      <TagChips tags={taggedItems[ex.exam_id]!} />
                    ) : null}
                    {ex.subject ? (
                      <span className="mt-0.5 block text-[10px] text-slate-500">{ex.subject}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                    disabled={busy}
                    title={t("compose:deleteExportedExam")}
                    aria-label={t("compose:deleteExportedExam")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteExam(ex.exam_id, { exported: true });
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
