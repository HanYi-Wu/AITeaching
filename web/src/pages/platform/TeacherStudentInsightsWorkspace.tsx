import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Clock3, RefreshCw, Search, ShieldAlert, TrendingUp, Users } from "lucide-react";

import { useAgentContext } from "../../contexts/AgentContext";
import {
  getTeacherStudentProfile,
  listTeacherAssignedClasses,
  listTeacherClassStudents,
  type TeacherClassRecord,
  type TeacherClassStudentRecord,
  type TeacherStudentProfile,
} from "../../platform/auth";

type Props = { onError?: (message: string | null) => void };

function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "暂无";
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}

export function TeacherStudentInsightsWorkspace({ onError }: Props) {
  const [classes, setClasses] = useState<TeacherClassRecord[]>([]);
  const [students, setStudents] = useState<TeacherClassStudentRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [profile, setProfile] = useState<TeacherStudentProfile | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const studentListRequestIdRef = useRef(0);
  const profileRequestIdRef = useRef(0);
  const { setPageContext } = useAgentContext();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listTeacherAssignedClasses()
      .then((result) => {
        if (!active) return;
        setClasses(result.classes);
        setSelectedClassId((current) => current || result.classes[0]?.id || "");
      })
      .catch((error) => onError?.(error instanceof Error ? error.message : String(error)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [onError]);

  useEffect(() => {
    if (!selectedClassId) {
      setStudents([]);
      setSelectedStudentId("");
      return;
    }
    const requestId = ++studentListRequestIdRef.current;
    profileRequestIdRef.current += 1;
    setSelectedStudentId("");
    setProfile(null);
    setLoading(true);
    void listTeacherClassStudents(selectedClassId)
      .then((result) => {
        if (studentListRequestIdRef.current !== requestId) return;
        setStudents(result.students);
        setSelectedStudentId((current) =>
          result.students.some((student) => student.id === current) ? current : result.students[0]?.id || "",
        );
      })
      .catch((error) => onError?.(error instanceof Error ? error.message : String(error)))
      .finally(() => studentListRequestIdRef.current === requestId && setLoading(false));
  }, [selectedClassId, onError]);

  useEffect(() => {
    if (!selectedClassId || !selectedStudentId) {
      setProfile(null);
      return;
    }
    const requestId = ++profileRequestIdRef.current;
    setProfile(null);
    setLoading(true);
    void getTeacherStudentProfile(selectedClassId, selectedStudentId)
      .then((result) => {
        if (profileRequestIdRef.current === requestId) setProfile(result.profile);
      })
      .catch((error) => onError?.(error instanceof Error ? error.message : String(error)))
      .finally(() => profileRequestIdRef.current === requestId && setLoading(false));
  }, [selectedClassId, selectedStudentId, onError]);

  useEffect(() => {
    if (profile) {
      setPageContext({
        current_page: "student_profile",
        selected_resource_type: "student",
        selected_resource_id: profile.student.id,
        summary: `学生画像：${profile.student.display_name}（${profile.student.student_no}），完成率 ${profile.summary.completion_rate}%，平均得分率 ${profile.summary.average_score_percent ?? "暂无"}%`,
      });
    } else {
      setPageContext({ current_page: "student_profile", summary: "教师学生画像：请选择班级和学生" });
    }
    return () => setPageContext(null);
  }, [profile, setPageContext]);

  const visibleStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) =>
      [student.student_no, student.display_name, student.account_username].some((value) =>
        String(value || "").toLowerCase().includes(needle),
      ),
    );
  }, [query, students]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-950">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"><Users className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold">学生画像与分析</h1>
            <p className="text-sm text-slate-500">统一查看完成情况、得分趋势、薄弱题目和诚信状态</p>
          </div>
        </div>
        {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-400" /> : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-white p-4">
          <label className="text-xs font-semibold text-slate-600">班级</label>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={selectedClassId}
            onChange={(event) => setSelectedClassId(event.target.value)}
          >
            {classes.map((klass) => <option key={klass.id} value={klass.id}>{klass.name} {klass.grade ? `· ${klass.grade}` : ""}</option>)}
          </select>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按姓名、学号或账号搜索"
              className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <div className="mt-3 space-y-1">
            {visibleStudents.map((student) => (
              <button
                key={student.id}
                type="button"
                onClick={() => setSelectedStudentId(student.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedStudentId === student.id ? "bg-blue-50 text-blue-800" : "hover:bg-slate-100"}`}
              >
                <span className="block font-medium">{student.display_name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{student.student_no}{student.account_username ? ` · ${student.account_username}` : ""}</span>
              </button>
            ))}
            {!loading && visibleStudents.length === 0 ? <p className="p-4 text-center text-sm text-slate-400">该班暂无学生</p> : null}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto p-6">
          {profile ? (
            <div className="mx-auto max-w-6xl space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">{profile.student.display_name}</h2>
                <p className="mt-1 text-sm text-slate-500">{profile.student.student_no}{profile.student.account_username ? ` · ${profile.student.account_username}` : ""}</p>
              </section>
              <section className="grid gap-4 md:grid-cols-4">
                {[
                  { label: "考试完成率", value: `${profile.summary.completion_rate}%`, icon: BookOpen, color: "text-blue-600" },
                  { label: "平均得分率", value: profile.summary.average_score_percent == null ? "暂无" : `${profile.summary.average_score_percent}%`, icon: TrendingUp, color: "text-emerald-600" },
                  { label: "平均答题时长", value: formatDuration(profile.summary.average_time_seconds), icon: Clock3, color: "text-amber-600" },
                  { label: "诚信事件", value: String(profile.summary.integrity_event_count), icon: ShieldAlert, color: profile.summary.integrity_event_count ? "text-rose-600" : "text-slate-500" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <Icon className={`h-5 w-5 ${color}`} />
                    <p className="mt-3 text-2xl font-bold">{value}</p>
                    <p className="mt-1 text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </section>
              <section className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold">最近考试</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-slate-500"><tr><th className="py-2">考试</th><th>类型</th><th>状态</th><th>得分率</th><th>诚信</th></tr></thead>
                      <tbody>
                        {profile.recent_exams.map((exam) => (
                          <tr key={exam.attempt_id} className="border-t border-slate-100">
                            <td className="py-3 font-medium">{exam.title}</td>
                            <td>{exam.submission_mode === "offline_scan" ? "线下照片" : "在线答题"}</td>
                            <td>{{ submitted: "已提交", in_progress: "答题中", not_started: "未开始" }[exam.status] ?? exam.status}</td>
                            <td>{exam.score_percent == null ? "待批改" : `${exam.score_percent}%`}</td>
                            <td>{exam.integrity_event_count || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {profile.recent_exams.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">暂无考试记录</p> : null}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold">薄弱题目</h3>
                  <div className="mt-3 space-y-2">
                    {profile.weak_questions.map((item) => (
                      <div key={`${item.paper_id}:${item.question_id}`} className="rounded-md bg-rose-50 px-3 py-2 text-sm">
                        <p className="font-medium text-rose-800">{item.paper_title} · {item.question_id}</p>
                        <p className="mt-1 text-xs text-rose-600">
                          错误 {item.wrong_count} 次 · 出现 {item.attempt_count} 次
                          {item.average_score_percent == null ? "" : ` · 平均得分率 ${item.average_score_percent}%`}
                        </p>
                      </div>
                    ))}
                    {profile.weak_questions.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">暂无明确薄弱题目</p> : null}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">请选择班级和学生查看详细画像</div>
          )}
        </main>
      </div>
    </div>
  );
}
