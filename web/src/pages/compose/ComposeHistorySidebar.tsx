import { useTranslation } from "react-i18next";
import { ContentFolders } from "../../components/ContentFolders";
import { ContentSelectionControls } from "../../components/ContentSelectionControls";
import { TagChips } from "../../components/ContentTags";
import { cn } from "../../lib/utils";
import type { ContentFolder, ContentTag, FolderDeleteResult } from "../../platform/auth";
import type { ExamWorkspaceSummary } from "../../types/compose";
import { setContentItemDragData } from "../../lib/contentSelection";

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
  selectedComposeItemIds: string[];
  movingComposeItems: boolean;
  onToggleComposeItem: (itemId: string) => void;
  onToggleVisibleComposeItems: (visibleIds: string[]) => void;
  onClearComposeItems: () => void;
  onMoveComposeItemsToFolder: (itemIds: string[], folderId: string | null) => void | Promise<void>;
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
  selectedComposeItemIds,
  movingComposeItems,
  onToggleComposeItem,
  onToggleVisibleComposeItems,
  onClearComposeItems,
  onMoveComposeItemsToFolder,
  draftExamRows,
  exportedExamRows,
  taggedItems,
  onLoadDraftExam,
  onLoadExportedExam,
  onDeleteExam,
  onError,
}: ComposeHistorySidebarProps) {
  const { t } = useTranslation(["compose", "common"]);
  const visibleComposeItemIds = [...draftExamRows, ...exportedExamRows].map((exam) => exam.exam_id);

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
          onDropItems={onMoveComposeItemsToFolder}
          dropItemsBusy={movingComposeItems}
          onError={onError}
        />
      </div>
      <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-2">
        <h2 className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          {t("compose:historySidebarTitle")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        <ContentSelectionControls
          scope="compose"
          folders={composeFolders}
          visibleItemIds={visibleComposeItemIds}
          selectedItemIds={selectedComposeItemIds}
          busy={busy || movingComposeItems}
          onSelectVisible={() => onToggleVisibleComposeItems(visibleComposeItemIds)}
          onClearSelection={onClearComposeItems}
          onMoveSelected={onMoveComposeItemsToFolder}
        />
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
                  <label className="flex w-6 shrink-0 items-center justify-center" title="选择这份草稿">
                    <input type="checkbox" aria-label={`选择草稿 ${d.name || d.exam_id}`} checked={selectedComposeItemIds.includes(d.exam_id)} disabled={busy || movingComposeItems} onChange={() => onToggleComposeItem(d.exam_id)} />
                  </label>
                  <button
                    type="button"
                    draggable={!busy && !movingComposeItems}
                    onDragStart={(event) => setContentItemDragData(event.dataTransfer, "compose", d.exam_id, selectedComposeItemIds)}
                    className={cn(
                      "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs [overflow-wrap:anywhere]",
                      currentExamId === d.exam_id
                        ? "border-slate-900 bg-slate-100"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    disabled={busy || movingComposeItems}
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
                    disabled={busy || movingComposeItems}
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
                  <label className="flex w-6 shrink-0 items-center justify-center" title="选择这份试卷">
                    <input type="checkbox" aria-label={`选择试卷 ${ex.export_label || ex.name || ex.exam_id}`} checked={selectedComposeItemIds.includes(ex.exam_id)} disabled={busy || movingComposeItems} onChange={() => onToggleComposeItem(ex.exam_id)} />
                  </label>
                  <button
                    type="button"
                    draggable={!busy && !movingComposeItems}
                    onDragStart={(event) => setContentItemDragData(event.dataTransfer, "compose", ex.exam_id, selectedComposeItemIds)}
                    className={cn(
                      "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs [overflow-wrap:anywhere]",
                      currentExamId === ex.exam_id
                        ? "border-slate-900 bg-slate-100"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    disabled={busy || movingComposeItems}
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
                    disabled={busy || movingComposeItems}
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
