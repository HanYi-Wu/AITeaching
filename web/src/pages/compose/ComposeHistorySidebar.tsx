import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ContentFolders } from "../../components/ContentFolders";
import { ContentSelectionControls } from "../../components/ContentSelectionControls";
import { TagChips } from "../../components/ContentTags";
import { cn } from "../../lib/utils";
import type { ContentFolder, ContentTag, FolderDeleteResult } from "../../platform/auth";
import type { ExamWorkspaceSummary } from "../../types/compose";
import { setContentItemDragData } from "../../lib/contentSelection";
import { applySelectionDelta, isShiftSpace, rangeSelection } from "../../lib/rangeSelection";

export type ComposeHistorySidebarProps = {
  hideTitle?: boolean;
  selectPortalContainer?: HTMLElement | null;
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
  hideTitle = false,
  selectPortalContainer,
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
  const draftSelectionAnchor = useRef<string | null>(null);
  const exportedSelectionAnchor = useRef<string | null>(null);
  const draftVisibleIds = draftExamRows.map((exam) => exam.exam_id);
  const exportedVisibleIds = exportedExamRows.map((exam) => exam.exam_id);

  const selectComposeRange = (
    itemId: string,
    visibleIds: string[],
    anchor: { current: string | null },
  ) => {
    const next = rangeSelection(selectedComposeItemIds, visibleIds, anchor.current, itemId);
    applySelectionDelta(selectedComposeItemIds, next, onToggleComposeItem);
    anchor.current = itemId;
  };

  return (
    <aside className="or-g49-compose-history-content flex min-h-0 w-full min-w-0 shrink-0 flex-col border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]">
      <div className="shrink-0 p-2.5">
        <ContentFolders
          scope="compose"
          portalContainer={selectPortalContainer}
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
      {!hideTitle ? (
        <div className="shrink-0 border-b border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3.5 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase leading-tight tracking-wider text-[var(--or-muted)]">
            {t("compose:historySidebarTitle")}
          </h2>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-2.5">
        <ContentSelectionControls
          scope="compose"
          portalContainer={selectPortalContainer}
          folders={composeFolders}
          visibleItemIds={visibleComposeItemIds}
          selectedItemIds={selectedComposeItemIds}
          busy={busy || movingComposeItems}
          onSelectVisible={() => onToggleVisibleComposeItems(visibleComposeItemIds)}
          onClearSelection={onClearComposeItems}
          onMoveSelected={onMoveComposeItemsToFolder}
        />
        <div>
          <p className="mb-1.5 px-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--or-muted)]">
            {t("compose:draftsGroup")}
          </p>
          {draftExamRows.length === 0 ? (
            <p className="px-1.5 text-sm text-[var(--or-muted)]">{t("compose:historyDraftEmpty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {draftExamRows.map((d) => (
                <li key={d.exam_id} className="flex min-w-0 items-stretch gap-1">
                  <label className="flex w-6 shrink-0 items-start justify-center pt-2 cursor-pointer" title="选择这份草稿">
                    <input
                      type="checkbox"
                      aria-label={`选择草稿 ${d.name || d.exam_id}`}
                      checked={selectedComposeItemIds.includes(d.exam_id)}
                      disabled={busy || movingComposeItems}
                      onKeyDown={(event) => {
                        if (isShiftSpace(event)) {
                          event.preventDefault();
                          selectComposeRange(d.exam_id, draftVisibleIds, draftSelectionAnchor);
                        }
                      }}
                      onChange={(event) => {
                        if ((event.nativeEvent as MouseEvent).shiftKey) {
                          selectComposeRange(d.exam_id, draftVisibleIds, draftSelectionAnchor);
                          return;
                        }
                        draftSelectionAnchor.current = d.exam_id;
                        onToggleComposeItem(d.exam_id);
                      }}
                      className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                    />
                  </label>
                  <button
                    type="button"
                    draggable={!busy && !movingComposeItems}
                    onDragStart={(event) => setContentItemDragData(event.dataTransfer, "compose", d.exam_id, selectedComposeItemIds)}
                    className={cn(
                      "min-w-0 flex-1 rounded-xl border p-2 text-left text-sm transition-all duration-150 [overflow-wrap:anywhere]",
                      currentExamId === d.exam_id
                        ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
                        : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]",
                    )}
                    disabled={busy || movingComposeItems}
                    onClick={() => onLoadDraftExam(d.exam_id)}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-[var(--or-text)]">{d.name || d.exam_id}</span>
                      <span className="or-g49-pill bg-[var(--or-warning-container)] text-[var(--or-on-warning)] text-xs px-1.5 py-0.5 font-medium">
                        临时
                      </span>
                    </div>
                    {(taggedItems[d.exam_id]?.length ?? 0) > 0 ? (
                      <div className="mt-1">
                        <TagChips tags={taggedItems[d.exam_id]!} />
                      </div>
                    ) : null}
                    <span className="mt-1 block text-xs text-[var(--or-muted)]">
                      {t("compose:examStatusEditing")}
                    </span>
                    {d.export_label ? (
                      <span className="mt-0.5 block text-xs font-medium text-[var(--or-muted)]">
                        {d.export_label}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-6 shrink-0 items-center justify-center self-stretch rounded-lg text-base leading-none text-[var(--or-muted)] hover:bg-[var(--or-inset)] hover:text-[var(--or-muted)] disabled:opacity-40 transition-colors"
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
          <p className="mb-1.5 px-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--or-muted)]">
            {t("compose:historyGroup")}
          </p>
          {exportedExamRows.length === 0 ? (
            <p className="px-1.5 text-sm text-[var(--or-muted)]">{t("compose:historyExamEmpty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {exportedExamRows.map((ex) => (
                <li key={ex.exam_id} className="flex min-w-0 items-stretch gap-1">
                  <label className="flex w-6 shrink-0 items-start justify-center pt-2 cursor-pointer" title="选择这份试卷">
                    <input
                      type="checkbox"
                      aria-label={`选择试卷 ${ex.export_label || ex.name || ex.exam_id}`}
                      checked={selectedComposeItemIds.includes(ex.exam_id)}
                      disabled={busy || movingComposeItems}
                      onKeyDown={(event) => {
                        if (isShiftSpace(event)) {
                          event.preventDefault();
                          selectComposeRange(ex.exam_id, exportedVisibleIds, exportedSelectionAnchor);
                        }
                      }}
                      onChange={(event) => {
                        if ((event.nativeEvent as MouseEvent).shiftKey) {
                          selectComposeRange(ex.exam_id, exportedVisibleIds, exportedSelectionAnchor);
                          return;
                        }
                        exportedSelectionAnchor.current = ex.exam_id;
                        onToggleComposeItem(ex.exam_id);
                      }}
                      className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                    />
                  </label>
                  <button
                    type="button"
                    draggable={!busy && !movingComposeItems}
                    onDragStart={(event) => setContentItemDragData(event.dataTransfer, "compose", ex.exam_id, selectedComposeItemIds)}
                    className={cn(
                      "min-w-0 flex-1 rounded-xl border p-2 text-left text-sm transition-all duration-150 [overflow-wrap:anywhere]",
                      currentExamId === ex.exam_id
                        ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
                        : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]",
                    )}
                    disabled={busy || movingComposeItems}
                    onClick={() => onLoadExportedExam(ex)}
                  >
                    <span className="font-semibold text-[var(--or-text)]">
                      {ex.export_label || ex.name || ex.exam_id}
                    </span>
                    {(taggedItems[ex.exam_id]?.length ?? 0) > 0 ? (
                      <div className="mt-1">
                        <TagChips tags={taggedItems[ex.exam_id]!} />
                      </div>
                    ) : null}
                    {ex.subject ? (
                      <span className="mt-1 block text-xs font-medium text-[var(--or-muted)]">{ex.subject}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="flex w-6 shrink-0 items-center justify-center self-stretch rounded-lg text-base leading-none text-[var(--or-muted)] hover:bg-[var(--or-inset)] hover:text-[var(--or-muted)] disabled:opacity-40 transition-colors"
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
