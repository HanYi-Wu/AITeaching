import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, Clock3, RefreshCw, Search, ShieldAlert, TrendingUp, Users, X } from "lucide-react";

import { ContentWithPrimeBrush as KatexText } from "../../components/ContentWithPrimeBrush";
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
type ListedStudent = TeacherClassStudentRecord & { class_id: string; class_name: string };

function formatSeconds(seconds?: number | null): string {
  if (seconds == null) return "暂无";
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)} 分钟/题` : `${Number(seconds).toFixed(1)} 秒/题`;
}

function classLabel(name: string, grade?: string | null): string {
  return grade && !name.includes(grade) ? `${name} · ${grade}` : name;
}

export function TeacherStudentInsightsWorkspace({ onError }: Props) {
  const [classes, setClasses] = useState<TeacherClassRecord[]>([]);
  const [students, setStudents] = useState<ListedStudent[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentKey, setSelectedStudentKey] = useState("");
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
    return () => { active = false; };
  }, [onError]);

  useEffect(() => {
    const requestId = ++studentListRequestIdRef.current;
    profileRequestIdRef.current += 1;
    setSelectedStudentKey("");
    setProfile(null);
    setLoading(true);
    const targets = selectedClassId ? classes.filter((item) => item.id === selectedClassId) : classes;
    void Promise.all(targets.map(async (klass) => {
      const result = await listTeacherClassStudents(klass.id);
      return result.students.map((student) => ({ ...student, class_id: klass.id, class_name: klass.name }));
    }))
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
    setPageContext(profile ? {
      current_page: "student_profile",
      selected_resource_type: "student",
      selected_resource_id: profile.student.id,
      summary: `学生分析：${profile.student.display_name}，完成率 ${profile.summary.completion_rate}%，平均得分率 ${profile.summary.average_score_percent ?? "暂无"}%`,
    } : { current_page: "student_profile", summary: "教师学生分析：可按班级、姓名和日期查看" });
    return () => setPageContext(null);
  }, [profile, setPageContext]);

  const visibleStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter((student) => !needle || [student.student_no, student.display_name, student.account_username, student.class_name]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [query, students]);
  const weakPapers = useMemo(() => Array.from(new Map((profile?.weak_questions ?? []).map((item) => [item.paper_id, item.paper_title])).entries()), [profile]);
  const weakQuestions = useMemo(() => (profile?.weak_questions ?? [])
    .filter((item) => weakPaperId === "all" || item.paper_id === weakPaperId)
    .sort((a, b) => b.wrong_count - a.wrong_count || b.attempt_count - a.attempt_count)
    .slice(0, 5), [profile, weakPaperId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-950">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"><Users className="h-5 w-5" /></div>
          <div><h1 className="text-xl font-semibold">学生详细分析</h1><p className="text-sm text-slate-500">成绩、完成度、每题用时、考试行为与薄弱模块均来自真实答卷记录</p></div>
        </div>
        {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-400" /> : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white p-4">
          <div className="min-h-0 flex-1 space-y-1 overflow-auto">
            {visibleStudents.map((student) => (
              <button key={`${student.class_id}:${student.id}`} type="button" onClick={() => setSelectedStudentKey(`${student.class_id}:${student.id}`)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedStudentKey === `${student.class_id}:${student.id}` ? "bg-blue-50 text-blue-800" : "hover:bg-slate-100"}`}>
                <span className="block font-medium">{student.display_name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{student.student_no} · {student.class_name}</span>
              </button>
            ))}
            {!loading && visibleStudents.length === 0 ? <p className="p-4 text-center text-sm text-slate-400">没有匹配的学生</p> : null}
          </div>
          <div className="mt-3 shrink-0 space-y-2 border-t border-slate-200 pt-3">
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名、学号、账号" className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm" /></div>
            <select value={selectedClassId} onChange={(e) => { profileRequestIdRef.current += 1; setSelectedStudentKey(""); setProfile(null); setSelectedClassId(e.target.value); }} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">全部班级</option>
              {classes.map((klass) => <option key={klass.id} value={klass.id}>{classLabel(klass.name, klass.grade)}</option>)}
            </select>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto p-6">
          <section className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <CalendarDays className="mb-2 h-5 w-5 text-slate-500" />
            <label className="text-xs text-slate-600">开始日期<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs text-slate-600">结束日期<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
            <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">全部时间</button>
          </section>
          {profile ? (
            <div className="mx-auto max-w-6xl space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">{profile.student.display_name}</h2><p className="mt-1 text-sm text-slate-500">{profile.student.student_no} · {selectedStudent?.class_name}</p></section>
              <section className="grid gap-4 md:grid-cols-4">
                {[
                  { label: "考试完成率", value: `${profile.summary.completion_rate}%`, icon: BookOpen, color: "text-blue-600" },
                  { label: "已发布成绩平均得分率", value: profile.summary.average_score_percent == null ? "暂无" : `${profile.summary.average_score_percent}%`, icon: TrendingUp, color: "text-emerald-600" },
                  { label: "平均每题答题时间", value: formatSeconds(profile.summary.average_time_per_question_seconds), icon: Clock3, color: "text-amber-600" },
                  { label: "考试行为事件（平均每场）", value: profile.summary.behavior_event_average_per_exam.toFixed(1), icon: ShieldAlert, color: profile.summary.behavior_event_average_per_exam ? "text-rose-600" : "text-slate-500" },
                ].map(({ label, value, icon: Icon, color }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Icon className={`h-5 w-5 ${color}`} /><p className="mt-3 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold">个人分析维度</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-5">{(profile.radar ?? []).map((axis) => <div key={axis.id}><div className="flex justify-between text-xs"><span>{axis.label}</span><b>{axis.value}%</b></div><div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, axis.value))}%` }} /></div></div>)}</div>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between"><h3 className="font-semibold">考试记录</h3><button type="button" onClick={() => setWeakModalOpen(true)} className="rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">查看薄弱题排名</button></div>
                <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-2">考试</th><th>类型</th><th>状态</th><th>得分率</th><th>行为事件</th></tr></thead><tbody>{profile.recent_exams.map((exam) => <tr key={exam.attempt_id} className="border-t border-slate-100"><td className="py-3 font-medium">{exam.title}</td><td>{exam.submission_mode === "offline_scan" ? "线下照片" : "在线答题"}</td><td>{{ submitted: "已提交", in_progress: "答题中", not_started: "未开始" }[exam.status] ?? exam.status}</td><td>{exam.score_percent == null ? "待教师发布" : `${exam.score_percent}%`}</td><td>{exam.integrity_event_count || 0}</td></tr>)}</tbody></table>{profile.recent_exams.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">所选时间内暂无记录</p> : null}</div>
              </section>
            </div>
          ) : <div className="flex h-64 items-center justify-center text-sm text-slate-400">请从左侧选择学生</div>}
        </main>
      </div>

      {weakModalOpen && profile ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="薄弱题目分析"><section className="flex h-[85vh] w-[85vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-slate-200 px-6 py-4"><div><h2 className="text-lg font-semibold">{profile.student.display_name} · 易错题前 5</h2><p className="text-sm text-slate-500">按真实错误次数排序，可按试卷筛选</p></div><button type="button" aria-label="关闭薄弱题目" onClick={() => setWeakModalOpen(false)} className="rounded p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 overflow-auto p-6"><select value={weakPaperId} onChange={(e) => setWeakPaperId(e.target.value)} className="mb-4 rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="all">全部试卷</option>{weakPapers.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><div className="space-y-3">{weakQuestions.map((item, index) => <article key={`${item.paper_id}:${item.question_id}`} className="rounded-xl border border-rose-100 bg-rose-50/40 p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-rose-600 px-2 py-1 text-xs font-bold text-white">TOP {index + 1}</span><b>{item.paper_title} · {item.header || item.question_id}</b>{(item.tags ?? []).map((tag) => <span key={tag} className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">易错：{tag}</span>)}</div>{item.content ? <KatexText text={item.content} className="mt-3 text-sm text-slate-700" /> : null}<p className="mt-3 text-sm text-rose-700">错误 {item.wrong_count} 次 · 出现 {item.attempt_count} 次{item.average_score_percent == null ? "" : ` · 平均得分率 ${item.average_score_percent}%`}</p></article>)}{weakQuestions.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">暂无已确认错题</p> : null}</div></div></section></div> : null}
    </div>
  );
}
