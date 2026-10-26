import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { KeyRound, Plus, Save, UserCheck, UserX } from "lucide-react";
import {
  bulkUpdateStudents,
  resetStudentPassword,
  updateStudent,
  type ClassRecord,
  type StudentRecord,
} from "../../../../platform/auth";
import {
  BulkActions,
  IconButton,
  ImportActions,
  ManagementSection,
  Pager,
  StatusBadge,
  Toolbar,
  type PageMeta,
  type PageQuery,
} from "../SchoolControls";
import {
  optionalText,
  type StudentDraft,
} from "../hooks/useSchoolWorkspaceData";

type StudentsMainProps = {
  students: StudentRecord[];
  studentMeta: PageMeta;
  studentQuery: PageQuery;
  setStudentQuery: Dispatch<SetStateAction<PageQuery>>;
  selectedStudentIds: string[];
  setSelectedStudentIds: Dispatch<SetStateAction<string[]>>;
  toggleStudent: (id: string) => void;
  studentDrafts: Record<string, StudentDraft>;
  setStudentDrafts: Dispatch<SetStateAction<Record<string, StudentDraft>>>;
  classChoices: ClassRecord[];
  studentClassFilter: string;
  setStudentClassFilter: Dispatch<SetStateAction<string>>;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: Dispatch<SetStateAction<string | null>>;
};

export function StudentsMainPanel({
  students,
  studentMeta,
  studentQuery,
  setStudentQuery,
  selectedStudentIds,
  setSelectedStudentIds,
  toggleStudent,
  studentDrafts,
  setStudentDrafts,
  classChoices,
  studentClassFilter,
  setStudentClassFilter,
  busy,
  run,
  setNotice,
}: StudentsMainProps) {
  return (
    <ManagementSection
      title="学生账号"
      count={studentMeta.total}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Toolbar
            query={studentQuery}
            onQueryChange={(patch) => setStudentQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
            status
            bulk={
              selectedStudentIds.length ? (
                <BulkActions
                  disabled={busy}
                  count={selectedStudentIds.length}
                  onEnable={() =>
                    void run(async () => {
                      await bulkUpdateStudents({ ids: selectedStudentIds, status: "active" });
                      setSelectedStudentIds([]);
                    })
                  }
                  onDisable={() =>
                    void run(async () => {
                      await bulkUpdateStudents({ ids: selectedStudentIds, status: "disabled" });
                      setSelectedStudentIds([]);
                    })
                  }
                />
              ) : null
            }
          />
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
            value={studentClassFilter}
            onChange={(event) => {
              setStudentClassFilter(event.target.value);
              setStudentQuery((current) => ({ ...current, page: 1 }));
            }}
          >
            <option value="">全部班级</option>
            {classChoices.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">学号</th>
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">邮箱</th>
              <th className="px-3 py-2">班级</th>
              <th className="px-3 py-2">登录名</th>
              <th className="px-3 py-2">初始密码</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const draft = studentDrafts[student.id] || {
                student_no: student.student_no,
                display_name: student.display_name,
                email: optionalText(student.email),
              };
              return (
                <tr key={student.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.student_no}
                      onChange={(event) =>
                        setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, student_no: event.target.value } }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.display_name}
                      onChange={(event) =>
                        setStudentDrafts((prev) => ({
                          ...prev,
                          [student.id]: { ...draft, display_name: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.email}
                      onChange={(event) =>
                        setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, email: event.target.value } }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{student.class_names || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{student.account_username || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{student.initial_password || "-"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={student.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <IconButton
                        label="保存学生"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await updateStudent(student.id, draft);
                          })
                        }
                        icon={<Save className="h-4 w-4" />}
                      />
                      <IconButton
                        label="重置密码"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await resetStudentPassword(student.id);
                            setNotice(`${student.account_username || student.student_no} 新密码：${result.password}`);
                          })
                        }
                        icon={<KeyRound className="h-4 w-4" />}
                      />
                      <IconButton
                        label={student.status === "active" ? "停用学生" : "启用学生"}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await updateStudent(student.id, { status: student.status === "active" ? "disabled" : "active" });
                          })
                        }
                        icon={student.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager meta={studentMeta} onPage={(page) => setStudentQuery((current) => ({ ...current, page }))} />
    </ManagementSection>
  );
}

type StudentsAsideProps = {
  busy: boolean;
  submitStudent: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  classChoices: ClassRecord[];
  studentClassId: string;
  setStudentClassId: Dispatch<SetStateAction<string>>;
  studentNo: string;
  setStudentNo: Dispatch<SetStateAction<string>>;
  studentName: string;
  setStudentName: Dispatch<SetStateAction<string>>;
  studentEmail: string;
  setStudentEmail: Dispatch<SetStateAction<string>>;
  downloadTemplate: (kind: "students") => Promise<void>;
  handleFile: (event: ChangeEvent<HTMLInputElement>, kind: "students") => Promise<void>;
};

export function StudentsAsidePanel({
  busy,
  submitStudent,
  classChoices,
  studentClassId,
  setStudentClassId,
  studentNo,
  setStudentNo,
  studentName,
  setStudentName,
  studentEmail,
  setStudentEmail,
  downloadTemplate,
  handleFile,
}: StudentsAsideProps) {
  return (
    <aside className="min-w-0 space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">录入学生</h2>
        <p className="mt-1 text-sm text-slate-500">单个录入会自动生成学生登录名与初始密码，也可以使用模板批量导入。</p>
        <form className="mt-4 space-y-3" onSubmit={submitStudent}>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={studentClassId}
            onChange={(e) => setStudentClassId(e.target.value)}
          >
            <option value="">未指定班级</option>
            {classChoices.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="学号，如 S001"
            value={studentNo}
            onChange={(e) => setStudentNo(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="姓名"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="邮箱（可选）"
            type="email"
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            录入学生
          </button>
        </form>
      </section>
      <ImportActions
        kind="students"
        label="导入学生 JSON / Excel"
        testId="students-import-file"
        onTemplate={() => void downloadTemplate("students")}
        onChange={(event) => void handleFile(event, "students")}
      />
    </aside>
  );
}
