import { History, PauseCircle, PlayCircle, Trash2, Wifi } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { PaperPublicationRecord } from "../../../platform/auth";
import { publicationWindowLabel } from "./paperHelpers";
import { G51Pill, G51EmptyState, G51Panel } from "../../../ui-redesign/g51/PaperUiComponents";

type Props = {
  publishPanel: ReactNode;
  publications: PaperPublicationRecord[];
  clock?: number;
  busy: string | null;
  onTogglePause: (publication: PaperPublicationRecord) => void | Promise<void>;
  onRevoke: (publication: PaperPublicationRecord) => void | Promise<void>;
};

function PublicationWindowBadge({ publication, clock: externalClock }: { publication: PaperPublicationRecord; clock?: number }) {
  const [internalClock, setInternalClock] = useState(() => externalClock ?? Date.now());
  useEffect(() => {
    if (externalClock !== undefined) return;
    const timer = window.setInterval(() => setInternalClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [externalClock]);
  const clock = externalClock ?? internalClock;
  const label = publicationWindowLabel(publication, clock);
  const variant = label === "进行中" ? "success" : label === "已截止" ? "neutral" : "warning";

  return <G51Pill variant={variant}>{label}</G51Pill>;
}

export function PaperPublishingSidebar({ publishPanel, publications, clock, busy, onTogglePause, onRevoke }: Props) {
  return (
    <section className="space-y-6">
      <G51Panel title="发布试卷" icon={<Wifi className="h-5 w-5 text-[var(--or-on-container)]" />}>
        {publishPanel}
      </G51Panel>

      <G51Panel title="发布记录" icon={<History className="h-5 w-5 text-[var(--or-on-container)]" />}>
        <div className="space-y-3.5">
          {publications.map((publication) => (
            <article
              key={publication.id}
              className="or-g51-static-card rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4 transition"
            >
              <div className="flex flex-wrap items-start justify-between gap-2.5">
                <h4 className="min-w-0 break-all text-sm font-semibold text-[var(--or-text)]">
                  {publication.title}
                </h4>
                <PublicationWindowBadge publication={publication} clock={clock} />
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:text-[13px] text-[var(--or-muted)] sm:grid-cols-2">
                <div className="break-all">
                  {publication.recipient_scope === "student" ? "指定学生" : "班级"}：
                  {((publication.recipient_scope === "student" ? publication.student_names : publication.class_names) ?? []).join("、") || "-"}
                </div>
                <div>
                  提交进度：<span>{publication.submitted_count ?? 0}/{publication.attempt_count ?? 0}</span>
                </div>
                <div>允许切屏：{publication.max_screen_switches ?? 0} 次</div>
                <div>限时 {publication.time_limit_minutes ? `${publication.time_limit_minutes} 分钟` : "不限"}</div>
                <div className="break-all sm:col-span-2 text-[var(--or-muted)]">
                  {publication.start_at || "未设置"} - {publication.end_at || "未设置"}
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2 border-t border-[color-mix(in_srgb,var(--or-outline)_70%,transparent)] pt-3">
                <button
                  type="button"
                  aria-label={publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                  disabled={busy === `pause:${publication.id}` || publication.status === "revoked" || publication.status === "closed"}
                  onClick={() => void onTogglePause(publication)}
                  className="or-g51-btn or-g51-btn-outline text-xs py-1.5 px-3 flex-1 sm:flex-initial"
                >
                  {publication.status === "paused" ? <PlayCircle className="h-3.5 w-3.5 mr-1" /> : <PauseCircle className="h-3.5 w-3.5 mr-1" />}
                  {publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                </button>
                <button
                  type="button"
                  aria-label="撤回发布"
                  disabled={busy === `revoke:${publication.id}` || publication.status === "revoked"}
                  onClick={() => void onRevoke(publication)}
                  className="or-g51-btn or-g51-btn-danger text-xs py-1.5 px-3 flex-1 sm:flex-initial"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  取消发布
                </button>
              </div>
            </article>
          ))}
        </div>
        {publications.length === 0 ? (
          <G51EmptyState message="暂无发布记录" />
        ) : null}
      </G51Panel>
    </section>
  );
}
