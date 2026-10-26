import { History, PauseCircle, PlayCircle, Trash2, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import type { PaperPublicationRecord } from "../../../platform/auth";
import { publicationWindowLabel } from "./paperHelpers";

type Props = {
  publishPanel: ReactNode;
  publications: PaperPublicationRecord[];
  clock: number;
  busy: string | null;
  onTogglePause: (publication: PaperPublicationRecord) => void | Promise<void>;
  onRevoke: (publication: PaperPublicationRecord) => void | Promise<void>;
};

export function PaperPublishingSidebar({ publishPanel, publications, clock, busy, onTogglePause, onRevoke }: Props) {
  return (
    <section className="space-y-5">
      <Panel title="发布试卷" icon={<Wifi className="h-5 w-5 text-slate-600" />}>
        {publishPanel}
      </Panel>
      <Panel title="发布记录" icon={<History className="h-5 w-5 text-slate-600" />}>
        <div className="space-y-3">
          {publications.map((publication) => (
            <article key={publication.id} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-all text-sm font-semibold">{publication.title}</h3>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs">{publicationWindowLabel(publication, clock)}</span>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <div className="break-all">{publication.recipient_scope === "student" ? "指定学生" : "班级"}：{((publication.recipient_scope === "student" ? publication.student_names : publication.class_names) ?? []).join("、") || "-"}</div>
                <div>提交进度：<span>{publication.submitted_count ?? 0}/{publication.attempt_count ?? 0}</span></div>
                <div>允许切屏：{publication.max_screen_switches ?? 0} 次</div>
                <div>限时 {publication.time_limit_minutes ? `${publication.time_limit_minutes} 分钟` : "不限"}</div>
                <div className="break-all sm:col-span-2">{publication.start_at || "未设置"} - {publication.end_at || "未设置"}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  aria-label={publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                  disabled={busy === `pause:${publication.id}` || publication.status === "revoked" || publication.status === "closed"}
                  onClick={() => void onTogglePause(publication)}
                  className="inline-flex min-h-10 items-center gap-1 rounded border border-slate-300 px-3 py-2 text-xs disabled:opacity-50"
                >
                  {publication.status === "paused" ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                  {publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                </button>
                <button
                  type="button"
                  aria-label="撤回发布"
                  disabled={busy === `revoke:${publication.id}` || publication.status === "revoked"}
                  onClick={() => void onRevoke(publication)}
                  className="inline-flex min-h-10 items-center gap-1 rounded border border-red-200 px-3 py-2 text-xs text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />取消发布
                </button>
              </div>
            </article>
          ))}
        </div>
        {publications.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            暂无发布记录
          </p>
        ) : null}
      </Panel>
    </section>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}
