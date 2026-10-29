import { memo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { BankFolderExplorer, type BankFolders } from "../../components/BankFolderExplorer";
import { QuestionHoverDetails } from "../../components/QuestionHoverDetails";
import { KatexPlainPreview } from "../../components/KatexText";
import { TagChips } from "../../components/ContentTags";
import type { ContentTag } from "../../platform/auth";
import { toggleSingleSelection } from "./bankOperationModel";
import type { BankListItem } from "./bankModel";

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

  return (
    <section className="flex w-full shrink-0 flex-col border-slate-200 bg-white md:w-[min(100%,300px)] md:border-r">
      <div className="border-b border-slate-100 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("title")}
        </h2>
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
          return (
            <li
              key={it.qualified_id}
              className={cn(
                "relative mb-1 rounded-lg border px-2 py-2 transition-colors",
                selectedId === it.qualified_id
                  ? "border-slate-900 bg-slate-100"
                  : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white",
              )}
            >
              <input
                type="checkbox"
                aria-label={`选择导出 ${it.qualified_id}`}
                checked={selectedExportIds.includes(it.qualified_id)}
                onChange={() =>
                  onSelectExportIds(toggleSingleSelection(selectedExportIds, it.qualified_id))
                }
                className="absolute right-7 top-2 h-4 w-4"
              />
              <button
                type="button"
                className="w-full min-w-0 pr-5 text-left text-sm"
                onClick={() => onOpenItem(it.qualified_id)}
              >
                <div className="flex w-full min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <span className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-medium text-slate-700">
                    {t(`lib:questionTypes.${it.type}`, { defaultValue: it.type })}
                  </span>
                  <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-slate-800">
                    {it.qualified_id}
                  </span>
                </div>
                <div className="mt-0.5 block w-full min-w-0">
                  <QuestionHoverDetails id={it.qualified_id}>
                    <KatexPlainPreview
                      text={it.content_preview}
                      className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                    />
                  </QuestionHoverDetails>
                </div>
                {it.answer_relation_needs_review ? (
                  <p className="mt-1 text-xs text-amber-700">
                    旧答案可能含且/或关系，请让助手AI检查并适配。
                  </p>
                ) : null}
                {Object.keys(it.metadata ?? {}).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(it.metadata).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-600"
                      >
                        {k}:{String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </button>
              {(taggedItems[it.qualified_id]?.length ?? 0) > 0 ? (
                <div className="mt-1">
                  <TagChips tags={taggedItems[it.qualified_id]} />
                </div>
              ) : null}
              {graphNodes.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-200/80 pt-1.5">
                  <span className="w-full text-[10px] font-medium text-slate-500">
                    {t("knowledgePoints")}
                  </span>
                  {graphNodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-900 hover:bg-sky-200"
                      onClick={() => onOpenGraphNode?.(n.id)}
                    >
                      {n.canonical_name}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className="absolute right-1 top-1 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
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
