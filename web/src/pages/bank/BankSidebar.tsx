import { memo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { BankFolderExplorer, type BankFolders } from "../../components/BankFolderExplorer";
import { QuestionHoverDetails } from "../../components/QuestionHoverDetails";
import { KatexPlainPreview } from "../../components/KatexText";
import { TagChips } from "../../components/ContentTags";
import type { ContentTag } from "../../platform/auth";
import { toggleSingleSelection } from "./bankOperationModel";
import { isShiftSpace, rangeSelection } from "../../lib/rangeSelection";
import { buildBankFolderIndex, type BankListItem } from "./bankModel";
import "../../ui-redesign/g48/g48-bank.css";

export interface BankSidebarProps {
  folders: BankFolders;
  setFolders: (data: BankFolders) => void;
  filteredItems: BankListItem[];
  allItems: BankListItem[];
  selectedExportIds: string[];
  onSelectExportIds: (ids: string[]) => void;
  selectedId: string | null;
  onOpenItem: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string | null) => void;
  busy: boolean;
  graphLinkIndex: Record<string, { id: string; canonical_name: string; node_kind: string }[]>;
  taggedItems: Record<string, ContentTag[]>;
  onOpenGraphNode?: (nodeId: string) => void;
  onRequestDelete: (item: BankListItem) => void;
}

const MemoizedKatexPlainPreview = memo(KatexPlainPreview);

export const BankSidebar = memo(function BankSidebar({
  folders,
  setFolders,
  filteredItems,
  allItems,
  selectedExportIds,
  onSelectExportIds,
  selectedId,
  onOpenItem,
  onRefresh,
  onError,
  busy,
  graphLinkIndex,
  taggedItems,
  onOpenGraphNode,
  onRequestDelete,
}: BankSidebarProps) {
  const { t } = useTranslation(["bank", "lib", "common"]);
  const selectionAnchors = useRef(new Map<string, string>());

  const toggleExportItem = (itemId: string, folder: string) => {
    selectionAnchors.current.set(folder, itemId);
    onSelectExportIds(toggleSingleSelection(selectedExportIds, itemId));
  };

  const selectExportRange = (itemId: string, folder: string) => {
    const visibleIds = (buildBankFolderIndex(folders, filteredItems).questions.get(folder) ?? [])
      .map((item) => item.qualified_id);
    const next = rangeSelection(
      selectedExportIds,
      visibleIds,
      selectionAnchors.current.get(folder),
      itemId,
    );
    selectionAnchors.current.set(folder, itemId);
    onSelectExportIds(next);
  };

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden border-b border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--or-outline)] px-3.5 py-2.5 sm:px-4 sm:py-3">
        <h2 className="text-[15px] font-semibold tracking-wide text-[var(--or-text)]">
          {t("title")}
        </h2>
        <span className="or-pill rounded-full bg-[var(--or-block)] px-2.5 py-0.5 text-[13px] font-medium text-[var(--or-muted)]">
          {filteredItems.length} 题
        </span>
      </div>
      <BankFolderExplorer
        data={folders}
        items={filteredItems}
        allItems={allItems}
        selectedIds={selectedExportIds}
        onOpenItem={onOpenItem}
        onRefresh={onRefresh}
        onSelectIds={onSelectExportIds}
        onChange={setFolders}
        onError={onError}
        renderItem={(it) => {
          const graphNodes = graphLinkIndex[it.qualified_id] ?? [];
          const isSelected = selectedId === it.qualified_id;
          const folder = folders.folders.includes(folders.assignments[it.qualified_id] ?? "")
            ? folders.assignments[it.qualified_id]!
            : "";
          return (
            <li
              key={it.qualified_id}
              className={cn(
                "group relative mb-1.5 rounded-2xl border p-3 transition-colors duration-150",
                isSelected
                  ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)]"
                  : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]",
              )}
            >
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  aria-label={`选择导出 ${it.qualified_id}`}
                  checked={selectedExportIds.includes(it.qualified_id)}
                  onKeyDown={(event) => {
                    if (isShiftSpace(event)) {
                      event.preventDefault();
                      selectExportRange(it.qualified_id, folder);
                    }
                  }}
                  onChange={(event) => {
                    if ((event.nativeEvent as MouseEvent).shiftKey) {
                      selectExportRange(it.qualified_id, folder);
                    } else {
                      toggleExportItem(it.qualified_id, folder);
                    }
                  }}
                  className="mt-1 h-4 w-4 shrink-0 rounded accent-[var(--or-primary)]"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="w-full min-w-0 pr-6 text-left text-sm"
                    onClick={() => onOpenItem(it.qualified_id)}
                  >
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                      <span className="or-pill shrink-0 rounded-full bg-[var(--or-block)] px-2.5 py-0.5 text-[13px] font-semibold text-[var(--or-muted)]">
                        {t(`lib:questionTypes.${it.type}`, { defaultValue: it.type })}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-normal leading-snug text-[var(--or-muted)]">
                        {it.qualified_id}
                      </span>
                    </div>
                    <div className="mt-1.5 block w-full min-w-0">
                      <QuestionHoverDetails id={it.qualified_id}>
                        <MemoizedKatexPlainPreview
                          text={it.content_preview}
                          className="line-clamp-3 text-[15px] leading-relaxed text-[var(--or-text)] [&_.katex]:text-[0.95em]"
                        />
                      </QuestionHoverDetails>
                    </div>
                    {it.answer_relation_needs_review ? (
                      <p className="mt-1 text-[13px] font-medium text-[var(--or-on-warning)]">
                        旧答案可能含且/或关系，请让助手AI检查并适配。
                      </p>
                    ) : null}
                    {Object.keys(it.metadata ?? {}).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {Object.entries(it.metadata).map(([k, v]) => (
                          <span
                            key={k}
                            className="or-pill rounded-full bg-[var(--or-block)] px-2 py-0.5 text-[13px] text-[var(--or-muted)]"
                          >
                            {k}:{String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  {(taggedItems[it.qualified_id]?.length ?? 0) > 0 ? (
                    <div className="mt-1.5">
                      <TagChips tags={taggedItems[it.qualified_id]} />
                    </div>
                  ) : null}
                  {graphNodes.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--or-outline)] pt-2">
                      <span className="w-full text-[13px] font-medium text-[var(--or-muted)]">
                        {t("knowledgePoints")}
                      </span>
                      {graphNodes.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary-container)] px-2.5 py-1 text-sm font-medium text-[var(--or-on-container)] border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] hover:bg-[var(--or-primary-container)] transition-colors"
                          onClick={() => onOpenGraphNode?.(n.id)}
                        >
                          {n.canonical_name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="or-icon-button absolute right-1.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm text-[var(--or-muted)] hover:bg-[var(--or-error-container)] hover:text-[var(--or-on-error)] transition-colors disabled:opacity-50"
                disabled={busy}
                aria-label={t("remove")}
                title={t("remove")}
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete(it);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          );
        }}
      />
    </section>
  );
});
