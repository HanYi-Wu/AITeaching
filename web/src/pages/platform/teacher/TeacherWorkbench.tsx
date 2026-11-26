import { useEffect, useState } from "react";
import { formatLocaleDateTime } from "../../../lib/locale";
import { platformRequest } from "../../../platform/platformRequest";

type QueueItem = { paper_id: string; title: string; attempt_id: string; submitted_at: string | null; pending_count: number };
type Workbench = { pending_total: number; paper_total: number; outstanding_attempts: number; queue: QueueItem[] };

export function TeacherWorkbench({ onOpenGrading, onOpenPapers, onOpenStudents }: {
  onOpenGrading: (target: { paperId: string; attemptId: string; title: string }) => void;
  onOpenPapers: () => void; onOpenStudents: () => void;
}) {
  const [data, setData] = useState<Workbench | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void platformRequest<Workbench>("/api/teacher/workbench", { signal: abort.signal })
      .then((value) => { if (!abort.signal.aborted) { setData(value); setError(false); } })
      .catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [refresh]);

  return <section aria-label="教师工作台" className="h-full overflow-auto p-4 sm:p-6">
    <div className="mx-auto grid max-w-4xl gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">教师工作台</h1><p className="mt-1 text-sm text-or-muted">先处理已提交的答卷，再跟进仍未提交的学生。</p></div>
        <button className="or-button or-button-outline px-3 py-2 text-sm" onClick={() => setRefresh((value) => value + 1)}>刷新</button>
      </header>
      {error && <p role="alert" className="text-sm text-or-error">暂时无法读取工作台，请刷新重试。</p>}
      {!data && !error && <p role="status" className="text-sm text-or-muted">正在载入待办…</p>}
      {data && <>
        <section aria-label="作业概况" className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4"><p className="text-sm text-or-muted">待批改或发布成绩</p><strong className="text-2xl">{data.pending_total}</strong> 份答卷</div>
          <button type="button" className="rounded-xl border p-4 text-left hover:bg-or-block" onClick={onOpenPapers}>
            <span className="block text-sm text-or-muted">开放中 · 未提交</span><strong className="text-2xl">{data.outstanding_attempts}</strong> 份作答
          </button>
        </section>
        <section aria-labelledby="workbench-pending" className="rounded-xl border bg-or-card p-4">
          <h2 id="workbench-pending" className="font-semibold">待处理试卷</h2>
          {data.queue.length ? <ol className="mt-2 divide-y divide-or-outline">
            {data.queue.map((item) => <li key={item.paper_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0"><p className="break-words font-medium">{item.title}</p><p className="text-xs text-or-muted">
                {item.pending_count} 份待处理{item.submitted_at ? ` · 最早提交 ${formatLocaleDateTime(item.submitted_at)}` : ""}
              </p></div>
              <button className="or-button or-button-outline px-3 py-2 text-sm" aria-label={`批改 ${item.title}`} onClick={() =>
                onOpenGrading({ paperId: item.paper_id, attemptId: item.attempt_id, title: item.title })}>进入批改</button>
            </li>)}
          </ol> : <p className="mt-2 text-sm text-or-muted">暂无待批改或待发布成绩的答卷。</p>}
          {data.paper_total > data.queue.length && <button className="mt-2 text-sm text-or-primary" onClick={onOpenPapers}>查看全部试卷</button>}
        </section>
      </>}
      <button className="or-button or-button-outline justify-self-start px-3 py-2 text-sm" onClick={onOpenStudents}>查看学生与布置练习</button>
    </div>
  </section>;
}
