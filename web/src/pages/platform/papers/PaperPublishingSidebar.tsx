import { History, PauseCircle, PlayCircle, Trash2, Wifi } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { PaperPublicationRecord } from "../../../platform/auth";
import { publicationWindowLabel } from "./paperHelpers";
import { G51Pill, G51EmptyState, G51Panel } from "../../../ui-redesign/g51/PaperUiComponents";

type Props = {
  publishPanel: ReactNode;
  showPublishPanel?: boolean;
  showRecords?: boolean;
  publications: PaperPublicationRecord[];
  clock?: number;
  busy: string | null;
  onTogglePause: (publication: PaperPublicationRecord) => void | Promise<void>;
  onRevoke: (publication: PaperPublicationRecord) => void | Promise<void>;
};

type WindowLabel = ReturnType<typeof publicationWindowLabel>;
type BadgeVariant = "success" | "neutral" | "warning";

function publicationWindowVariant(label: WindowLabel): BadgeVariant {
  return label === "进行中" ? "success" : label === "已截止" ? "neutral" : "warning";
}

function labelsAt(publications: PaperPublicationRecord[], clock: number): Map<string, WindowLabel> {
  return new Map(publications.map((publication) => [publication.id, publicationWindowLabel(publication, clock)]));
}

function labelsEqual(left: Map<string, WindowLabel>, right: Map<string, WindowLabel>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, label] of left) {
    if (right.get(id) !== label) return false;
  }
  return true;
}

const PublicationWindowBadge = memo(function PublicationWindowBadge({ label, variant }: {
  label: WindowLabel;
  variant: BadgeVariant;
}) {
  return <G51Pill variant={variant}>{label}</G51Pill>;
});

const PublicationCard = memo(function PublicationCard({
  publication,
  label,
  pauseBusy,
  revokeBusy,
  onTogglePause,
  onRevoke,
}: {
  publication: PaperPublicationRecord;
  label: WindowLabel;
  pauseBusy: boolean;
  revokeBusy: boolean;
  onTogglePause: (publication: PaperPublicationRecord) => void;
  onRevoke: (publication: PaperPublicationRecord) => void;
}) {
  return (
    <article
      className="or-g51-static-card rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4 transition"
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <h4 className="min-w-0 break-all text-sm font-semibold text-[var(--or-text)]">
          {publication.title}
        </h4>
        <PublicationWindowBadge label={label} variant={publicationWindowVariant(label)} />
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
          disabled={pauseBusy || publication.status === "revoked" || publication.status === "closed"}
          onClick={() => onTogglePause(publication)}
          className="or-g51-btn or-g51-btn-outline text-xs py-1.5 px-3 flex-1 sm:flex-initial"
        >
          {publication.status === "paused" ? <PlayCircle className="h-3.5 w-3.5 mr-1" /> : <PauseCircle className="h-3.5 w-3.5 mr-1" />}
          {publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
        </button>
        <button
          type="button"
          aria-label="撤回发布"
          disabled={revokeBusy || publication.status === "revoked"}
          onClick={() => onRevoke(publication)}
          className="or-g51-btn or-g51-btn-danger text-xs py-1.5 px-3 flex-1 sm:flex-initial"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          取消发布
        </button>
      </div>
    </article>
  );
});

function PublicationRecords({ publications, clock, busy, onTogglePause, onRevoke }: Pick<Props, "publications" | "clock" | "busy" | "onTogglePause" | "onRevoke">) {
  const [internalClock, setInternalClock] = useState(() => Date.now());
  const now = clock ?? internalClock;
  const labels = labelsAt(publications, now);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const publicationsRef = useRef(publications);
  publicationsRef.current = publications;
  const onTogglePauseRef = useRef(onTogglePause);
  onTogglePauseRef.current = onTogglePause;
  const onRevokeRef = useRef(onRevoke);
  onRevokeRef.current = onRevoke;
  const dispatchTogglePause = useCallback((publication: PaperPublicationRecord) => onTogglePauseRef.current(publication), []);
  const dispatchRevoke = useCallback((publication: PaperPublicationRecord) => onRevokeRef.current(publication), []);

  useEffect(() => {
    if (clock !== undefined || publications.length === 0) return;

    const checkWindowLabels = () => {
      const currentTime = Date.now();
      const current = labelsAt(publicationsRef.current, currentTime);
      if (labelsEqual(labelsRef.current, current)) return;
      labelsRef.current = current;
      setInternalClock(currentTime);
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkWindowLabels();
    };

    checkWindowLabels();
    const timer = window.setInterval(checkWindowLabels, 1000);
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
    };
  }, [clock, publications]);

  return (
    <div className="space-y-3.5">
      {publications.map((publication) => (
        <PublicationCard
          key={publication.id}
          publication={publication}
          label={labels.get(publication.id) ?? publicationWindowLabel(publication, now)}
          pauseBusy={busy === `pause:${publication.id}`}
          revokeBusy={busy === `revoke:${publication.id}`}
          onTogglePause={dispatchTogglePause}
          onRevoke={dispatchRevoke}
        />
      ))}
      {publications.length === 0 ? <G51EmptyState message="暂无发布记录" /> : null}
    </div>
  );
}

export function PaperPublishingSidebar({
  publishPanel,
  showPublishPanel = true,
  showRecords = true,
  publications,
  clock,
  busy,
  onTogglePause,
  onRevoke,
}: Props) {
  return (
    <section className="space-y-6">
      {showPublishPanel ? (
        <G51Panel title="发布试卷" icon={<Wifi className="h-5 w-5 text-[var(--or-on-container)]" />}>
          {publishPanel}
        </G51Panel>
      ) : null}

      {showRecords ? (
        <G51Panel title="发布记录" icon={<History className="h-5 w-5 text-[var(--or-on-container)]" />}>
          <PublicationRecords publications={publications} clock={clock} busy={busy} onTogglePause={onTogglePause} onRevoke={onRevoke} />
        </G51Panel>
      ) : null}
    </section>
  );
}
