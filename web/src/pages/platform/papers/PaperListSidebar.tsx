import { Search } from "lucide-react";
import { ContentFolders } from "../../../components/ContentFolders";
import { TagChips } from "../../../components/ContentTags";
import type { ContentFolder, ContentTag, PlatformPaperRecord } from "../../../platform/auth";
import { deliveryLabel } from "./paperHelpers";
import type { PageMeta, PaperQuery } from "./paperHelpers";

type Props = {
  papers: PlatformPaperRecord[];
  selectedPaper: PlatformPaperRecord | null;
  loading: boolean;
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
  onError: (error: unknown) => void;
  onAnalyzeFolder: (folderId: string) => void;
  onSearchChange: (value: string) => void;
  onDeliveryModeChange: (value: PaperQuery["deliveryMode"]) => void;
  onStatusChange: (value: string) => void;
  onSelectPaper: (paper: PlatformPaperRecord) => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
};

export function PaperListSidebar({
  papers,
  selectedPaper,
  loading,
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
  onError,
  onAnalyzeFolder,
  onSearchChange,
  onDeliveryModeChange,
  onStatusChange,
  onSelectPaper,
  onPage,
  onPageSize,
}: Props) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white p-3">
      <ContentFolders
        scope="paper"
        folders={folders}
        selectedId={selectedFolderId}
        onSelect={onSelectFolder}
        onCreated={onFolderCreated}
        onUpdated={onFolderUpdated}
        onDeleted={onFolderDeleted}
        onDropItem={onDropItem}
        onError={onError}
        allowPaperFolder
      />
      {selectedFolderId ? <div className="my-2 flex gap-2 text-xs"><button type="button" onClick={() => onAnalyzeFolder(selectedFolderId)} className="rounded border px-2 py-1 hover:bg-slate-50">分析此文件夹</button></div> : null}
      <div className="mb-3 shrink-0 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm"
            placeholder="搜索试卷"
            value={query.q}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
            value={query.deliveryMode}
            onChange={(event) => onDeliveryModeChange(event.target.value as PaperQuery["deliveryMode"])}
          >
            <option value="all">全部</option>
            <option value="online">线上</option>
            <option value="offline">线下</option>
          </select>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
            value={query.status}
            onChange={(event) => onStatusChange(event.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {papers.map((paper) => (
          <button
            key={paper.paper_id}
            type="button"
            draggable
            onDragStart={(event) => event.dataTransfer.setData("application/x-or-content-item", JSON.stringify({ scope: "paper", id: paper.paper_id }))}
            onClick={() => onSelectPaper(paper)}
            className={`w-full rounded-lg border p-3 text-left transition ${
              selectedPaper?.paper_id === paper.paper_id
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">
                {paper.title}
                {paper.subject ? ` · ${paper.subject}` : ""}
              </p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  paper.delivery_mode === "online"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {deliveryLabel(paper.delivery_mode)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {(taggedItems[paper.paper_id]?.length ?? 0) > 0 ? <TagChips tags={taggedItems[paper.paper_id]} /> : null}
              <span>{paper.subject}</span>
              <span>{paper.question_count} 题</span>
              <span>{paper.submitted_student_count ?? 0} 份已提交</span>
              <span>{paper.published_student_count ?? paper.graded_student_count ?? 0} 份批改并发布</span>
              {paper.score_batch_count > 0 ? <span>{paper.score_batch_count} 批线下成绩</span> : null}
              <span>{paper.publication_count} 次发布</span>
            </div>
          </button>
        ))}
        {!loading && papers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            暂无已导出的试卷
          </div>
        ) : null}
      </div>
      <Pager meta={meta} onPage={onPage} onPageSize={onPageSize} />
    </aside>
  );
}

function Pager({ meta, onPage, onPageSize }: { meta: PageMeta; onPage: (page: number) => void; onPageSize: (pageSize: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
      <span>
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex gap-2">
        <select aria-label="每页条数" className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" value={meta.pageSize} onChange={(event) => onPageSize(Number(event.target.value))}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option></select>
        <button type="button" disabled={meta.page <= 1} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50" onClick={() => onPage(meta.page - 1)}>上一页</button>
        <button type="button" disabled={meta.page >= meta.totalPages} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50" onClick={() => onPage(meta.page + 1)}>下一页</button>
      </div>
    </div>
  );
}
