import { memo, useCallback, useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, Folder, Search } from "lucide-react";
import { ContentFolders } from "../../../components/ContentFolders";
import { ContentSelectionControls } from "../../../components/ContentSelectionControls";
import { TagChips } from "../../../components/ContentTags";
import type { ContentFolder, ContentTag, PlatformPaperRecord } from "../../../platform/auth";
import { deliveryLabel } from "./paperHelpers";
import type { PageMeta, PaperQuery } from "./paperHelpers";
import { setContentItemDragData } from "../../../lib/contentSelection";
import { applySelectionDelta, isShiftSpace, rangeSelection } from "../../../lib/rangeSelection";
import { G51Pill, G51EmptyState } from "../../../ui-redesign/g51/PaperUiComponents";
import { formatSubjectLabel } from "../../../lib/subjectLabels";
import { Select as AppSelect } from "../../../components/ui/select";
import { useAfterWorkspaceTransition } from "../../../lib/workspaceWorkScheduler";

type Props = {
  scopeKey: string;
  papers: PlatformPaperRecord[];
  selectedPaper: PlatformPaperRecord | null;
  loading: boolean;
  workspaceStatus?: string | null;
  query: PaperQuery;
  meta: PageMeta;
  folders: ContentFolder[];
  selectedFolderId: string | null;
  taggedItems: Record<string, ContentTag[]>;
  onSelectFolder: (id: string | null) => void;
  onFolderCreated: (folder: ContentFolder) => void;
  onFolderUpdated: (folder: ContentFolder) => void;
  onFolderDeleted: (result: { folders: ContentFolder[] }) => void;
  onDropItem: (id: string, folderId: string) => void;
  onDropItems: (ids: string[], folderId: string) => void | Promise<void>;
  selectedPaperIds: string[];
  movingSelectedPapers: boolean;
  onTogglePaper: (paperId: string) => void;
  onToggleVisiblePapers: (visibleIds: string[]) => void;
  onClearSelectedPapers: () => void;
  onMoveSelectedPapers: (ids: string[], folderId: string | null) => void | Promise<void>;
  onError: (error: unknown) => void;
  onAnalyzeFolder: (folderId: string) => void;
  onSearchChange: (value: string) => void;
  onDeliveryModeChange: (value: PaperQuery["deliveryMode"]) => void;
  onStatusChange: (value: string) => void;
  onSelectPaper: (paper: PlatformPaperRecord) => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
};

function paperHasPublicationHistory(paper: PlatformPaperRecord): boolean {
  return paper.publication_count > 0 || paper.has_publication_history === true;
}

function PaperFoldersPlaceholder({
  folders,
  selectedFolderId,
  selectedFolder,
}: {
  folders: ContentFolder[];
  selectedFolderId: string | null;
  selectedFolder: ContentFolder | undefined;
}) {
  return (
    <div className="border-b border-[var(--or-outline)] pb-3" aria-hidden="true">
      <div className="flex items-center justify-between px-1 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--or-muted)]">文件夹</span>
        <span className="h-6 w-6 rounded-md bg-[var(--or-block)]" />
      </div>
      <div className="w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs sm:text-[13px] text-[var(--or-text)]">全部内容</div>
      <div className="max-h-56 overflow-auto py-1 lg:min-h-10">
        {folders.filter((folder) => folder.parent_id == null).map((folder) => (
          <div key={folder.id} className="flex items-center rounded-md">
            <span className="p-1 text-[var(--or-muted)]">
              <span className="inline-block h-3.5 w-3.5" />
            </span>
            <span className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-xs sm:text-[13px] ${selectedFolderId === folder.id ? "bg-[var(--or-primary-container)] font-semibold text-[var(--or-on-container)]" : "text-[var(--or-text)]"}`}>
              <span className="h-3.5 w-3.5 shrink-0 rounded bg-[var(--or-block)]" />
              <span className="h-3.5 w-24 max-w-[65%] rounded bg-[var(--or-block)]" />
              {folder.kind === "paper" ? <span className="h-4 w-8 shrink-0 rounded-full bg-[var(--or-block)]" /> : null}
            </span>
          </div>
        ))}
      </div>
      {selectedFolder ? (
        <div className="mt-2 space-y-1.5 rounded-[10px] bg-[var(--or-block)] p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="or-button or-button-outline rounded-[6px] px-2 py-1 text-xs font-medium">重命名</span>
            <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--or-error)] bg-[var(--or-error-container)] px-2 py-1 text-xs font-medium text-[var(--or-on-error)]">
              <span className="h-3 w-3 rounded-sm bg-[var(--or-block)]" />删除
            </span>
            <span className="or-select-trigger or-select min-w-0 flex-1 rounded-[6px] border border-[var(--or-outline)] bg-[var(--or-card)] px-1.5 py-1 text-xs" aria-hidden="true">
              <span className="or-select-balance" />
              <span className="min-w-0 truncate">移动到…</span>
              <ChevronDown className="or-select-arrow h-4 w-4" />
            </span>
          </div>
        </div>
      ) : null}
      <div className="mt-2.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-block)] p-2.5 text-xs leading-relaxed text-[var(--or-muted)] sm:text-[13px]">
        <div className="flex w-full items-center justify-between gap-2 text-left font-medium text-[var(--or-text)]">
          <span className="min-w-0 flex-1">归类文件夹与试卷文件夹说明</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function PaperSelectionPlaceholder({ allLabel, selectedCount, allVisibleSelected }: {
  allLabel: string;
  selectedCount: number;
  allVisibleSelected: boolean;
}) {
  return (
    <div className="space-y-2.5 rounded-[12px] border border-[var(--or-outline)] bg-[var(--or-card)] p-3 text-xs shadow-sm sm:text-[13px]" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 font-medium text-[var(--or-text)]">
          <input type="checkbox" aria-label={allLabel} checked={allVisibleSelected} disabled readOnly className="accent-[var(--or-primary)] rounded" />
          {allLabel}
        </label>
        <div className="flex items-center gap-2">
          <span className="or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary-container)] text-[var(--or-on-container)] px-2 py-0.5 text-xs font-semibold leading-none">
            已选 {selectedCount} 项
          </span>
          <button type="button" disabled className="or-button or-button-tonal px-2.5 py-1 text-sm disabled:opacity-40">
            清空选择
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <span className="or-select-trigger or-select min-w-0 flex-1 rounded-[8px] border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs sm:text-[13px]" aria-hidden="true">
          <span className="or-select-balance" />
          <span className="min-w-0 truncate">移动到…</span>
          <ChevronDown className="or-select-arrow h-4 w-4" />
        </span>
        <button type="button" disabled className="or-button or-button-primary shrink-0 rounded-[8px] px-3 py-1.5 text-xs sm:text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          移动所选
        </button>
      </div>
    </div>
  );
}

export const PaperListSidebar = memo(function PaperListSidebar({
  scopeKey,
  papers,
  selectedPaper,
  loading,
  workspaceStatus,
  query,
  meta,
  folders,
  selectedFolderId,
  taggedItems,
  onSelectFolder,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
  onDropItem,
  onDropItems,
  selectedPaperIds,
  movingSelectedPapers,
  onTogglePaper,
  onToggleVisiblePapers,
  onClearSelectedPapers,
  onMoveSelectedPapers,
  onError,
  onAnalyzeFolder,
  onSearchChange,
  onDeliveryModeChange,
  onStatusChange,
  onSelectPaper,
  onPage,
  onPageSize,
}: Props) {
  const [foldersOpen, setFoldersOpen] = useState(false);
  const folderPanelId = useId();
  const movablePaperIds = papers.filter((paper) => !paperHasPublicationHistory(paper)).map((paper) => paper.paper_id);
  const selectionAnchor = useRef<string | null>(null);
  const selectedPaperIdsRef = useRef(selectedPaperIds);
  selectedPaperIdsRef.current = selectedPaperIds;
  const movablePaperIdsRef = useRef(movablePaperIds);
  movablePaperIdsRef.current = movablePaperIds;
  const scopeGenerationRef = useRef({ scopeKey, generation: 0 });
  if (scopeGenerationRef.current.scopeKey !== scopeKey) {
    scopeGenerationRef.current = { scopeKey, generation: scopeGenerationRef.current.generation + 1 };
  }
  const scopeToken = `${scopeKey}\u0000${scopeGenerationRef.current.generation}`;
  const { ready: workspaceReady, schedule } = useAfterWorkspaceTransition(scopeToken);
  const [toolStages, setToolStages] = useState<{ scopeToken: string; folders: boolean; bulkControls: boolean }>({
    scopeToken: "",
    folders: false,
    bulkControls: false,
  });
  const showFolderTools = toolStages.scopeToken === scopeToken && toolStages.folders;
  const showBulkControls = toolStages.scopeToken === scopeToken && toolStages.bulkControls;

  useEffect(() => {
    if (!workspaceReady) return;
    const cancelFolderTools = schedule(() => setToolStages({ scopeToken, folders: true, bulkControls: false }));
    const cancelBulkControls = schedule(() => setToolStages((current) => ({
      scopeToken,
      folders: current.scopeToken === scopeToken && current.folders,
      bulkControls: true,
    })));
    return () => {
      cancelFolderTools();
      cancelBulkControls();
    };
  }, [schedule, scopeToken, workspaceReady]);

  const selectPaperRange = useCallback((paperId: string) => {
    const current = selectedPaperIdsRef.current;
    const next = rangeSelection(current, movablePaperIdsRef.current, selectionAnchor.current, paperId);
    applySelectionDelta(current, next, onTogglePaper);
    selectionAnchor.current = paperId;
  }, [onTogglePaper]);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-[var(--or-outline)] bg-[var(--or-card)] p-3.5">
      <button type="button" className="or-button or-button-tonal mb-3 grid grid-cols-[16px_1fr_16px] lg:hidden" aria-expanded={foldersOpen} aria-controls={folderPanelId} onClick={() => setFoldersOpen(!foldersOpen)}>
        <Folder size={16} /><span>文件夹 · {folders.find((folder) => folder.id === selectedFolderId)?.name ?? "全部内容"}</span><ChevronDown size={16} className={foldersOpen ? "rotate-180" : ""} />
      </button>
      <div id={folderPanelId} className={`or-g51-folders-panel ${foldersOpen ? "is-open" : ""}`}>
        {showFolderTools ? (
          <>
            <ContentFolders
              key={scopeKey}
              scope="paper"
              folders={folders}
              selectedId={selectedFolderId}
              onSelect={onSelectFolder}
              onCreated={onFolderCreated}
              onUpdated={onFolderUpdated}
              onDeleted={onFolderDeleted}
              onDropItem={onDropItem}
              onDropItems={onDropItems}
              dropItemsBusy={movingSelectedPapers}
              onError={onError}
              allowPaperFolder
            />
            {selectedFolderId ? (
              <div className="my-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAnalyzeFolder(selectedFolderId)}
                  className="or-g51-btn or-g51-btn-tonal text-[13px] py-1 px-3 rounded-full"
                >
                  分析此文件夹
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <PaperFoldersPlaceholder
              folders={folders}
              selectedFolderId={selectedFolderId}
              selectedFolder={folders.find((folder) => folder.id === selectedFolderId)}
            />
            {selectedFolderId ? (
              <div className="my-2.5 flex gap-2">
                <button type="button" disabled className="or-g51-btn or-g51-btn-tonal text-[13px] py-1 px-3 rounded-full">
                  分析此文件夹
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className={`mb-3 shrink-0 ${movablePaperIds.length === 0 ? "hidden lg:block" : ""}`}>
        {showBulkControls ? (
          <ContentSelectionControls
            scope="paper"
            folders={folders}
            visibleItemIds={movablePaperIds}
            selectedItemIds={selectedPaperIds}
            busy={loading || movingSelectedPapers}
            allLabel="全选当前可移动试卷"
            onSelectVisible={() => onToggleVisiblePapers(movablePaperIds)}
            onClearSelection={onClearSelectedPapers}
            onMoveSelected={onMoveSelectedPapers}
          />
        ) : <PaperSelectionPlaceholder
          allLabel="全选当前可移动试卷"
          selectedCount={selectedPaperIds.length}
          allVisibleSelected={movablePaperIds.length > 0 && movablePaperIds.every((id) => selectedPaperIds.includes(id))}
        />}
      </div>
      <div className="mb-3 shrink-0 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--or-muted)]" />
          <input
            className="w-full rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] py-2 pl-9 pr-3 text-sm text-[var(--or-text)] outline-none transition focus:border-[var(--or-primary)] focus:bg-[var(--or-card)] focus:ring-2 focus:ring-sky-100"
            placeholder="搜索试卷"
            value={query.q}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <AppSelect
            className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-2 text-sm text-[var(--or-text)] outline-none transition focus:border-[var(--or-primary)] focus:ring-2 focus:ring-sky-100"
            value={query.deliveryMode}
            onValueChange={(value) => onDeliveryModeChange(value as PaperQuery["deliveryMode"])}
          >
            <option value="all">全部交付模式</option>
            <option value="online">线上答题</option>
            <option value="offline">线下答卷</option>
          </AppSelect>
          <AppSelect
            className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-2 text-sm text-[var(--or-text)] outline-none transition focus:border-[var(--or-primary)] focus:ring-2 focus:ring-sky-100"
            value={query.status}
            onValueChange={(value) => onStatusChange(value)}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </AppSelect>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto pr-0.5">
        {workspaceStatus ? (
          <p className="py-5 text-center text-sm text-[var(--or-muted)]" role="status">
            {workspaceStatus}
          </p>
        ) : null}
        {papers.map((paper) => {
          const isPublished = paperHasPublicationHistory(paper);
          const isSelected = selectedPaper?.paper_id === paper.paper_id;
          return (
            <div key={paper.paper_id} className="flex min-w-0 items-stretch gap-1.5">
              <PaperListRow
                paper={paper}
                tags={taggedItems[paper.paper_id] ?? EMPTY_TAGS}
                isSelected={isSelected}
                isPublished={isPublished}
                checked={selectedPaperIds.includes(paper.paper_id)}
                loading={loading}
                movingSelectedPapers={movingSelectedPapers}
                selectedPaperIdsRef={selectedPaperIdsRef}
                selectionAnchor={selectionAnchor}
                onSelectPaper={onSelectPaper}
                onTogglePaper={onTogglePaper}
                onSelectRange={selectPaperRange}
              />
            </div>
          );
        })}
        {!loading && papers.length === 0 ? (
          <G51EmptyState message="暂无已导出的试卷" />
        ) : null}
      </div>
      <Pager meta={meta} onPage={onPage} onPageSize={onPageSize} />
    </aside>
  );
});

const EMPTY_TAGS: ContentTag[] = [];

type PaperListRowProps = {
  paper: PlatformPaperRecord;
  tags: ContentTag[];
  isSelected: boolean;
  isPublished: boolean;
  checked: boolean;
  loading: boolean;
  movingSelectedPapers: boolean;
  selectedPaperIdsRef: MutableRefObject<string[]>;
  selectionAnchor: MutableRefObject<string | null>;
  onSelectPaper: (paper: PlatformPaperRecord) => void;
  onTogglePaper: (paperId: string) => void;
  onSelectRange: (paperId: string) => void;
};

const PaperListRow = memo(function PaperListRow({
  paper,
  tags,
  isSelected,
  isPublished,
  checked,
  loading,
  movingSelectedPapers,
  selectedPaperIdsRef,
  selectionAnchor,
  onSelectPaper,
  onTogglePaper,
  onSelectRange,
}: PaperListRowProps) {
  return (
    <>
      <label
        className="flex w-6 shrink-0 items-start justify-center pt-3"
        title={isPublished ? "已有发布记录的试卷不能单独移动；请移动整个文件夹" : "选择这份试卷"}
      >
        <input
          type="checkbox"
          aria-label={`选择试卷 ${paper.title}`}
          checked={checked}
          disabled={isPublished || loading || movingSelectedPapers}
          onKeyDown={(event) => {
            if (isShiftSpace(event)) {
              event.preventDefault();
              onSelectRange(paper.paper_id);
            }
          }}
          onChange={(event) => {
            if ((event.nativeEvent as MouseEvent).shiftKey) {
              onSelectRange(paper.paper_id);
            } else {
              selectionAnchor.current = paper.paper_id;
              onTogglePaper(paper.paper_id);
            }
          }}
          className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)] disabled:opacity-40"
        />
      </label>
      <button
        type="button"
        data-testid={`paper-list-item-${paper.paper_id}`}
        draggable={!isPublished && !loading && !movingSelectedPapers}
        title={isPublished ? "已有发布记录的试卷不能单独移动；请移动整个文件夹" : undefined}
        onDragStart={(event) => setContentItemDragData(event.dataTransfer, "paper", paper.paper_id, selectedPaperIdsRef.current)}
        onClick={() => onSelectPaper(paper)}
        className={`min-w-0 flex-1 rounded-xl border p-3 text-left transition ${
          isSelected
            ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)]"
            : "border-[var(--or-outline)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)]"
        }`}
      >
        <div className="flex items-center justify-between gap-2.5">
          <p className="min-w-0 truncate text-sm font-semibold text-[var(--or-text)]">
            {paper.title}
            {paper.subject ? ` · ${formatSubjectLabel(paper.subject)}` : ""}
          </p>
          <G51Pill variant={paper.delivery_mode === "online" ? "success" : "neutral"} className="shrink-0">
            {deliveryLabel(paper.delivery_mode)}
          </G51Pill>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--or-muted)]">
          {tags.length > 0 ? <TagChips tags={tags} /> : null}
          {paper.subject ? <span>{formatSubjectLabel(paper.subject)}</span> : null}
          <span>{paper.question_count} 题</span>
          <span>{paper.submitted_student_count ?? 0} 份已交</span>
          <span>{paper.published_student_count ?? paper.graded_student_count ?? 0} 份已批</span>
          {paper.score_batch_count > 0 ? <span>{paper.score_batch_count} 批线下</span> : null}
          <span>{paper.publication_count} 次发布</span>
        </div>
      </button>
    </>
  );
});

function Pager({ meta, onPage, onPageSize }: { meta: PageMeta; onPage: (page: number) => void; onPageSize: (pageSize: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--or-outline)] pt-3 text-sm text-[var(--or-muted)]">
      <span className="text-xs sm:text-sm">
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex items-center gap-1.5">
        <AppSelect
          aria-label="每页条数"
          className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1 text-xs sm:text-sm text-[var(--or-muted)] outline-none focus:border-[var(--or-primary)]"
          value={meta.pageSize}
          onValueChange={(value) => onPageSize(Number(value))}
        >
          <option value={10}>10 条/页</option>
          <option value={20}>20 条/页</option>
          <option value={50}>50 条/页</option>
        </AppSelect>
        <button
          type="button"
          disabled={meta.page <= 1}
          className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs sm:text-sm font-medium text-[var(--or-muted)] transition hover:bg-[var(--or-page)] disabled:opacity-40"
          onClick={() => onPage(meta.page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs sm:text-sm font-medium text-[var(--or-muted)] transition hover:bg-[var(--or-page)] disabled:opacity-40"
          onClick={() => onPage(meta.page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
