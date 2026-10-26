import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { KeyRound, Plus, Save, UserCheck, UserX } from "lucide-react";
import {
  bulkUpdateTeachers,
  resetTeacherPassword,
  updateTeacher,
  type TeacherRecord,
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
  splitSubjects,
  type TeacherDraft,
} from "../hooks/useSchoolWorkspaceData";

type TeachersMainProps = {
  teachers: TeacherRecord[];
  teacherMeta: PageMeta;
  teacherQuery: PageQuery;
  setTeacherQuery: Dispatch<SetStateAction<PageQuery>>;
  selectedTeacherIds: string[];
  setSelectedTeacherIds: Dispatch<SetStateAction<string[]>>;
  toggleTeacher: (id: string) => void;
  teacherDrafts: Record<string, TeacherDraft>;
  setTeacherDrafts: Dispatch<SetStateAction<Record<string, TeacherDraft>>>;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: Dispatch<SetStateAction<string | null>>;
};

export function TeachersMainPanel({
  teachers,
  teacherMeta,
  teacherQuery,
  setTeacherQuery,
  selectedTeacherIds,
  setSelectedTeacherIds,
  toggleTeacher,
  teacherDrafts,
  setTeacherDrafts,
  busy,
  run,
  setNotice,
}: TeachersMainProps) {
  return (
    <ManagementSection
      title="教师管理"
      count={teacherMeta.total}
      controls={
        <Toolbar
          query={teacherQuery}
          onQueryChange={(patch) => setTeacherQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
          status
          bulk={
            selectedTeacherIds.length ? (
              <BulkActions
                disabled={busy}
                count={selectedTeacherIds.length}
                onEnable={() =>
                  void run(async () => {
                    await bulkUpdateTeachers({ ids: selectedTeacherIds, status: "active" });
                    setSelectedTeacherIds([]);
                  })
                }
                onDisable={() =>
                  void run(async () => {
                    await bulkUpdateTeachers({ ids: selectedTeacherIds, status: "disabled" });
                    setSelectedTeacherIds([]);
                  })
                }
              />
            ) : null
          }
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-[860px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">账号</th>
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">邮箱</th>
              <th className="px-3 py-2">教师学科</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((teacher) => {
              const draft = teacherDrafts[teacher.id] || {
                display_name: teacher.display_name,
                email: optionalText(teacher.email),
                subjects: teacher.subjects.join(", "),
              };
              return (
                <tr key={teacher.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selectedTeacherIds.includes(teacher.id)} onChange={() => toggleTeacher(teacher.id)} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{teacher.username}</td>
                  <td className="px-3 py-2">
                    <input
                      className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.display_name}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({
                          ...prev,
                          [teacher.id]: { ...draft, display_name: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.email}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, email: event.target.value } }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={draft.subjects}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({
                          ...prev,
                          [teacher.id]: { ...draft, subjects: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={teacher.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <IconButton
                        label="保存教师"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await updateTeacher(teacher.id, {
                              display_name: draft.display_name,
                              email: draft.email || null,
                              subjects: splitSubjects(draft.subjects),
                            });
                          })
                        }
                        icon={<Save className="h-4 w-4" />}
                      />
                      <IconButton
                        label="重置密码"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await resetTeacherPassword(teacher.id);
                            setNotice(`${teacher.username} 新密码：${result.password}`);
                          })
                        }
                        icon={<KeyRound className="h-4 w-4" />}
                      />
                      <IconButton
                        label={teacher.status === "active" ? "停用教师" : "启用教师"}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await updateTeacher(teacher.id, { status: teacher.status === "active" ? "disabled" : "active" });
                          })
                        }
                        icon={teacher.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager meta={teacherMeta} onPage={(page) => setTeacherQuery((current) => ({ ...current, page }))} />
    </ManagementSection>
  );
}

type TeachersAsideProps = {
  busy: boolean;
  submitTeacher: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  teacherUsername: string;
  setTeacherUsername: Dispatch<SetStateAction<string>>;
  teacherPassword: string;
  setTeacherPassword: Dispatch<SetStateAction<string>>;
  teacherName: string;
  setTeacherName: Dispatch<SetStateAction<string>>;
  teacherEmail: string;
  setTeacherEmail: Dispatch<SetStateAction<string>>;
  teacherSubjects: string;
  setTeacherSubjects: Dispatch<SetStateAction<string>>;
  downloadTemplate: (kind: "teachers") => Promise<void>;
  handleFile: (event: ChangeEvent<HTMLInputElement>, kind: "teachers") => Promise<void>;
};

export function TeachersAsidePanel({
  busy,
  submitTeacher,
  teacherUsername,
  setTeacherUsername,
  teacherPassword,
  setTeacherPassword,
  teacherName,
  setTeacherName,
  teacherEmail,
  setTeacherEmail,
  teacherSubjects,
  setTeacherSubjects,
  downloadTemplate,
  handleFile,
}: TeachersAsideProps) {
  return (
    <aside className="min-w-0 space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">创建教师账号</h2>
        <p className="mt-1 text-sm text-slate-500">教师创建后可指定所教学科，也可以由教师登录后在个人设置中维护。</p>
        <form className="mt-4 space-y-3" onSubmit={submitTeacher}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="登录用户名"
            value={teacherUsername}
            onChange={(e) => setTeacherUsername(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="password"
            placeholder="初始密码"
            value={teacherPassword}
            onChange={(e) => setTeacherPassword(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="教师姓名"
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="邮箱"
            type="email"
            value={teacherEmail}
            onChange={(e) => setTeacherEmail(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="任教学科（逗号分隔）"
            value={teacherSubjects}
            onChange={(e) => setTeacherSubjects(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            创建教师
          </button>
        </form>
      </section>
      <ImportActions
        kind="teachers"
        label="导入教师 JSON / Excel"
        testId="teachers-import-file"
        onTemplate={() => void downloadTemplate("teachers")}
        onChange={(event) => void handleFile(event, "teachers")}
      />
    </aside>
  );
}
