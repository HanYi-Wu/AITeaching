import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

import { ContentWithPrimeBrush as KatexText } from "../../../components/ContentWithPrimeBrush";
import { useAgentContext } from "../../../contexts/AgentContext";
import { SelectionIndicator } from "../../../design-system/SelectionIndicator";
import { cn } from "../../../lib/utils";
import {
  getTeacherStudentProfile,
  listTeacherAssignedClasses,
  listTeacherClassStudents,
  type TeacherClassRecord,
  type TeacherClassStudentRecord,
  type TeacherStudentProfile,
} from "../../../platform/auth";
import { G52StatCard, G52Pill } from "../../../ui-redesign/g52/G52UIComponents";
import "../../../ui-redesign/g52/g52-design-tokens.css";
import { Select as AppSelect } from "../../../components/ui/select";

type Props = {
  onError?: (message: string | null) => void;
  onOpenPaper?: (target: { paperId: string; attemptId: string; title: string }) => void;
  onAssignStudent?: (target: { classId: string; studentId: string; name: string }) => void;
};
type ListedStudent = TeacherClassStudentRecord & { class_id: string; class_name: string };

function formatSeconds(seconds?: number | null): string {
  if (seconds == null) return "暂无";
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)} 分钟/题` : `${Number(seconds).toFixed(1)} 秒/题`;
}

function classLabel(name: string, grade?: string | null): string {
  return grade && !name.includes(grade) ? `${name} · ${grade}` : name;
}

export function TeacherStudentInsightsWorkspace({ onError, onOpenPaper, onAssignStudent }: Props) {
  const [classes, setClasses] = useState<TeacherClassRecord[]>([]);
  const [students, setStudents] = useState<ListedStudent[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentKey, setSelectedStudentKey] = useState("");
  const [mobileTab, setMobileTab] = useState<"list" | "profile">("list");
  const mobileSegmentRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<TeacherStudentProfile | null>(null);
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [weakModalOpen, setWeakModalOpen] = useState(false);
  const [weakPaperId, setWeakPaperId] = useState("all");
  const [loading, setLoading] = useState(true);
  const studentListRequestIdRef = useRef(0);
  const profileRequestIdRef = useRef(0);
  const { setPageContext } = useAgentContext();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listTeacherAssignedClasses()
      .then((result) => active && setClasses(result.classes))
      .catch((error) => active && onError?.(error instanceof Error ? error.message : String(error)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [onError]);

  useEffect(() => {
    const requestId = ++studentListRequestIdRef.current;
    profileRequestIdRef.current += 1;
    setSelectedStudentKey("");
    setProfile(null);
    setLoading(true);
    const targets = selectedClassId ? classes.filter((item) => item.id === selectedClassId) : classes;
    void Promise.all(
      targets.map(async (klass) => {
        const result = await listTeacherClassStudents(klass.id);
        return result.students.map((student) => ({ ...student, class_id: klass.id, class_name: klass.name }));
      }),
    )
      .then((groups) => {
        if (studentListRequestIdRef.current !== requestId) return;
        const unique = new Map<string, ListedStudent>();
        groups.flat().forEach((student) => unique.set(`${student.class_id}:${student.id}`, student));
        setStudents(Array.from(unique.values()));
      })
      .catch((error) => {
        if (studentListRequestIdRef.current === requestId) onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => studentListRequestIdRef.current === requestId && setLoading(false));
  }, [classes, selectedClassId, onError]);

  const selectedStudent = students.find((student) => `${student.class_id}:${student.id}` === selectedStudentKey) ?? null;
  useEffect(() => {
    if (!selectedStudent) {
      setProfile(null);
      return;
    }
    const requestId = ++profileRequestIdRef.current;
    setProfile(null);
    setLoading(true);
    void getTeacherStudentProfile(selectedStudent.class_id, selectedStudent.id, dateFrom, dateTo)
      .then((result) => {
        if (profileRequestIdRef.current === requestId) setProfile(result.profile);
      })
      .catch((error) => {
        if (profileRequestIdRef.current === requestId) onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => profileRequestIdRef.current === requestId && setLoading(false));
  }, [selectedStudent?.class_id, selectedStudent?.id, dateFrom, dateTo, onError]);

  useEffect(() => {
    setPageContext(
      profile
        ? {
            current_page: "student_profile",
            selected_resource_type: "student",
            selected_resource_id: profile.student.id,
            summary: `学生分析：${profile.student.display_name}，完成率 ${profile.summary.completion_rate}%，平均得分率 ${profile.summary.average_score_percent ?? "暂无"}%`,
          }
        : { current_page: "student_profile", summary: "教师学生分析：可按班级、姓名和日期查看" },
    );
    return () => setPageContext(null);
  }, [profile, setPageContext]);

  const visibleStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter(
      (student) =>
        !needle ||
        [student.student_no, student.display_name, student.account_username, student.class_name].some((value) =>
          String(value || "").toLowerCase().includes(needle),
        ),
    );
  }, [query, students]);

  const weakPapers = useMemo(
    () => Array.from(new Map((profile?.weak_questions ?? []).map((item) => [item.paper_id, item.paper_title])).entries()),
    [profile],
  );

  const weakQuestions = useMemo(
    () =>
      (profile?.weak_questions ?? [])
        .filter((item) => weakPaperId === "all" || item.paper_id === weakPaperId)
        .sort((a, b) => b.wrong_count - a.wrong_count || b.attempt_count - a.attempt_count)
        .slice(0, 5),
    [profile, weakPaperId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] text-[var(--or-text)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3 sm:gap-3.5">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-2xs">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--or-text)]">学生详细分析</h1>
          </div>
        </div>
        {loading ? <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-[var(--or-muted)]" /> : null}
      </header>

      {/* Mobile View Switcher */}
      <div className="flex lg:hidden shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2">
        <div ref={mobileSegmentRef} className="or-g52-mobile-segmented or-g52-mobile-segmented-indicator relative isolate w-full">
          <SelectionIndicator rootRef={mobileSegmentRef} selector={'[data-state="active"]'} />
          <button
            type="button"
            aria-pressed={mobileTab === "list"}
            data-state={mobileTab === "list" ? "active" : "inactive"}
            onClick={() => setMobileTab("list")}
            className={cn("or-g52-mobile-segmented-btn", mobileTab === "list" && "or-g52-mobile-segmented-btn-active")}
          >
            学生列表
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "profile"}
            data-state={mobileTab === "profile" ? "active" : "inactive"}
            onClick={() => setMobileTab("profile")}
            className={cn("or-g52-mobile-segmented-btn", mobileTab === "profile" && "or-g52-mobile-segmented-btn-active")}
          >
            详细分析
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        <aside
          className={cn(
            "min-h-0 flex-col border-r border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5",
            mobileTab === "list" ? "flex flex-1 w-full" : "hidden lg:flex lg:w-[300px]",
          )}
        >
          <div className="mb-3 shrink-0 space-y-2 border-b border-[var(--or-outline)] pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--or-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索姓名、学号、账号"
                className="w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] py-1.5 pl-8 pr-3 text-xs text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none"
              />
            </div>
            <AppSelect
              value={selectedClassId}
              onValueChange={(value) => {
                profileRequestIdRef.current += 1;
                setSelectedStudentKey("");
                setProfile(null);
                setSelectedClassId(value);
              }}
              className="w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
            >
              <option value="">全部班级</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {classLabel(klass.name, klass.grade)}
                </option>
              ))}
            </AppSelect>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-0.5">
            {visibleStudents.map((student) => {
              const isSelected = selectedStudentKey === `${student.class_id}:${student.id}`;
              return (
                <button
                  key={`${student.class_id}:${student.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedStudentKey(`${student.class_id}:${student.id}`);
                    setMobileTab("profile");
                  }}
                  className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                    isSelected ? "bg-[var(--or-primary-container)] text-[var(--or-on-container)] border border-[var(--or-outline)] font-semibold shadow-2xs" : "hover:bg-[var(--or-block)] text-[var(--or-muted)]"
                  }`}
                >
                  <span className="block font-medium text-[var(--or-text)]">{student.display_name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--or-muted)]">
                    {student.student_no} · {student.class_name}
                  </span>
                </button>
              );
            })}
            {!loading && visibleStudents.length === 0 ? (
              <p className="p-4 text-center text-xs text-[var(--or-muted)]">没有匹配的学生</p>
            ) : null}
          </div>
        </aside>

        <main
          className={cn(
            "min-h-0 overflow-auto p-4 sm:p-6 space-y-5",
            mobileTab === "profile" ? "flex flex-1 flex-col w-full" : "hidden lg:flex lg:flex-1 lg:flex-col",
          )}
        >
          <section className="flex flex-wrap items-end gap-3.5 or-g52-surface-card p-4">
            <CalendarDays className="mb-2 h-5 w-5 text-[var(--or-on-container)] shrink-0" />
            <label className="text-xs font-medium text-[var(--or-muted)]">
              开始日期
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
              />
            </label>
            <label className="text-xs font-medium text-[var(--or-muted)]">
              结束日期
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 block rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
            >
              全部时间
            </button>
          </section>

          {profile ? (
            <div className="mx-auto max-w-6xl space-y-6">
              <button
                type="button"
                onClick={() => setMobileTab("list")}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--or-on-container)] hover:text-[var(--or-on-container)] lg:hidden"
              >
                ← 返回学生列表
              </button>
              <section className="flex flex-wrap items-center justify-between gap-3 or-g52-surface-card p-5">
                <div>
                  <h2 className="text-xl font-bold text-[var(--or-text)] tracking-tight">{profile.student.display_name}</h2>
                  <p className="mt-1 text-xs text-[var(--or-muted)]">
                    {profile.student.student_no} · {selectedStudent?.class_name}
                  </p>
                </div>
                {selectedStudent && onAssignStudent ? (
                  <button
                    type="button"
                    onClick={() =>
                      onAssignStudent({
                        classId: selectedStudent.class_id,
                        studentId: selectedStudent.id,
                        name: selectedStudent.display_name,
                      })
                    }
                    className="inline-flex items-center justify-center rounded-lg bg-[var(--or-primary)] px-4 py-2 text-xs font-medium text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] transition-colors shadow-2xs"
                  >
                    布置练习
                  </button>
                ) : null}
              </section>

              {/* 4 Core Stat Cards - Strictly static, no hover lift */}
              <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                <G52StatCard
                  label="考试完成率"
                  value={`${profile.summary.completion_rate}%`}
                  icon={<BookOpen className="h-5 w-5 text-[var(--or-on-container)]" />}
                  valueClassName="text-[var(--or-on-container)]"
                />
                <G52StatCard
                  label="已发布成绩平均得分率"
                  value={profile.summary.average_score_percent == null ? "暂无" : `${profile.summary.average_score_percent}%`}
                  icon={<TrendingUp className="h-5 w-5 text-[var(--or-on-success)]" />}
                  valueClassName="text-[var(--or-on-success)]"
                />
                <G52StatCard
                  label="平均每题答题时间"
                  value={formatSeconds(profile.summary.average_time_per_question_seconds)}
                  icon={<Clock3 className="h-5 w-5 text-[var(--or-on-warning)]" />}
                  valueClassName="text-[var(--or-on-warning)]"
                />
                <G52StatCard
                  label="考试行为事件（平均每场）"
                  value={profile.summary.behavior_event_average_per_exam.toFixed(1)}
                  icon={<ShieldAlert className={`h-5 w-5 ${profile.summary.behavior_event_average_per_exam ? "text-[var(--or-on-error)]" : "text-[var(--or-muted)]"}`} />}
                  valueClassName={profile.summary.behavior_event_average_per_exam ? "text-[var(--or-on-error)]" : "text-[var(--or-muted)]"}
                />
              </section>

              <section className="or-g52-surface-card p-5">
                <h3 className="font-semibold text-[var(--or-text)] text-sm tracking-tight">个人分析维度</h3>
                <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {(profile.radar ?? []).map((axis) => (
                    <div key={axis.id} className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3">
                      <div className="flex justify-between text-xs font-medium text-[var(--or-muted)]">
                        <span>{axis.label}</span>
                        <b className="font-mono text-[var(--or-text)]">{axis.value}%</b>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--or-inset)]">
                        <div
                          className="h-full rounded-full bg-[var(--or-primary)]"
                          style={{ width: `${Math.max(0, Math.min(100, axis.value))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="or-g52-surface-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--or-outline)] pb-3.5">
                  <h3 className="font-semibold text-[var(--or-text)] text-sm tracking-tight">考试记录</h3>
                  <button
                    type="button"
                    onClick={() => setWeakModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--or-error-container)] border border-[var(--or-error)] px-3 py-1.5 text-xs font-medium text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] transition-colors"
                  >
                    查看薄弱题排名
                  </button>
                </div>
                <div className="mt-3.5 overflow-x-auto">
                  <table className="w-full or-g52-table text-left">
                    <thead>
                      <tr>
                        <th className="font-semibold">考试</th>
                        <th className="font-semibold">类型</th>
                        <th className="font-semibold">状态</th>
                        <th className="font-semibold text-right">得分率</th>
                        <th className="font-semibold text-right">行为事件</th>
                        <th className="font-semibold text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.recent_exams.map((exam) => (
                        <tr key={exam.attempt_id}>
                          <td className="font-semibold text-[var(--or-text)]">{exam.title}</td>
                          <td className="text-[var(--or-muted)]">
                            {exam.submission_mode === "offline_scan" ? "线下照片" : "在线答题"}
                          </td>
                          <td>
                            <G52Pill
                              variant={
                                exam.status === "submitted"
                                  ? "success"
                                  : exam.status === "in_progress"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {{ submitted: "已提交", in_progress: "答题中", not_started: "未开始" }[exam.status] ??
                                exam.status}
                            </G52Pill>
                          </td>
                          <td className="text-right font-mono text-[var(--or-muted)]">
                            {exam.score_percent == null ? "待教师发布" : `${exam.score_percent}%`}
                          </td>
                          <td className="text-right font-mono text-[var(--or-muted)]">{exam.integrity_event_count || 0}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              disabled={!onOpenPaper}
                              className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                              onClick={() =>
                                onOpenPaper?.({
                                  paperId: exam.paper_id,
                                  attemptId: exam.attempt_id,
                                  title: exam.title,
                                })
                              }
                            >
                              查看与批改
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {profile.recent_exams.length === 0 ? (
                    <p className="py-8 text-center text-xs text-[var(--or-muted)]">所选时间内暂无记录</p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--or-muted)]">
              请从左侧选择学生
            </div>
          )}
        </main>
      </div>

      {weakModalOpen && profile ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-2xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="薄弱题目分析"
        >
          <section className="flex h-full w-full sm:h-[85vh] sm:w-[85vw] max-w-5xl flex-col overflow-hidden rounded-none sm:rounded-2xl border-0 sm:border border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl">
            <header className="flex items-center justify-between border-b border-[var(--or-outline)] px-4 py-3 sm:px-6 sm:py-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--or-text)] tracking-tight">
                  {profile.student.display_name} · 易错题前 5
                </h2>
                <p className="text-xs text-[var(--or-muted)]">按真实错误次数排序，可按试卷筛选</p>
              </div>
              <button
                type="button"
                aria-label="关闭薄弱题目"
                onClick={() => setWeakModalOpen(false)}
                className="rounded-lg p-1.5 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-muted)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 space-y-4">
              <AppSelect
                value={weakPaperId}
                onValueChange={(value) => setWeakPaperId(value)}
                className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
              >
                <option value="all">全部试卷</option>
                {weakPapers.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </AppSelect>
              <div className="space-y-3.5">
                {weakQuestions.map((item, index) => (
                  <article
                    key={`${item.paper_id}:${item.question_id}:${item.question_version ?? "unknown"}`}
                    className="rounded-xl border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_40%,transparent)] p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="or-g52-pill or-g52-pill-error font-bold text-xs !bg-rose-600 !text-white">
                        TOP {index + 1}
                      </span>
                      <b className="text-sm text-[var(--or-text)]">
                        {item.paper_title} · {item.header || item.question_id}
                      </b>
                      {item.question_version_label ? (
                        <span className="or-g52-pill or-g52-pill-neutral !text-xs">
                          {item.question_version_label}
                        </span>
                      ) : null}
                      {(item.tags ?? []).map((tag) => (
                        <span key={tag} className="or-g52-pill or-g52-pill-warning !text-xs">
                          易错：{tag}
                        </span>
                      ))}
                    </div>
                    {item.content ? (
                      <KatexText text={item.content} className="mt-2 text-sm text-[var(--or-muted)]" />
                    ) : null}
                    <p className="text-xs font-medium text-[var(--or-on-error)]">
                      错误 {item.wrong_count} 次 · 出现 {item.attempt_count} 次
                      {item.average_score_percent == null ? "" : ` · 平均得分率 ${item.average_score_percent}%`}
                    </p>
                  </article>
                ))}
                {weakQuestions.length === 0 ? (
                  <p className="py-12 text-center text-xs text-[var(--or-muted)]">暂无已确认错题</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
