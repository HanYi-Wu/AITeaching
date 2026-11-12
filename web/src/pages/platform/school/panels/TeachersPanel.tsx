import { useEffect, useId, useRef, useState } from "react";
import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { Download, KeyRound, LoaderCircle, Plus, Save, UserCheck, UserX } from "lucide-react";
import {
  bulkUpdateTeachers,
  exportTeachers,
  resetTeacherPassword,
  updateTeacher,
  type ListQuery,
  type TeacherRecord,
} from "../../../../platform/auth";
import { loadSessionToken } from "../../../../platform/session";
import { useManagementCapability, useManagementDictionary } from "../../../../platform/useManagementOptions";
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
import { downloadBlob } from "../hooks/useSchoolWorkspaceData";
import "../../../../ui-redesign/g53/g53.css";

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

function CurrentPageSelectAll({
  visibleIds,
  selectedIds,
  onChange,
  disabled = false,
}: {
  visibleIds: string[];
  selectedIds: string[];
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const indeterminate = selectedVisibleCount > 0 && !checked;

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      aria-label="全选当前页教师"
      data-testid="teachers-select-all"
      className="h-4 w-4 rounded accent-or-primary focus:ring-or-focus"
      checked={checked}
      disabled={disabled || visibleIds.length === 0}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

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
  const canWrite = useManagementCapability("school.teachers.manage");
  const canExport = useManagementCapability("school.teachers.export");
  const canExportRef = useRef(canExport);
  canExportRef.current = canExport;
  const [exportBusy, setExportBusy] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function exportFilteredTeachers() {
    if (exportBusy || busy || !canExport) return;
    const sessionToken = loadSessionToken();
    const isCurrentExport = () => mountedRef.current && canExportRef.current && loadSessionToken() === sessionToken;
    setExportBusy(true);
    setNotice(null);
    try {
      const params: ListQuery = {
        q: teacherQuery.q,
        status: teacherQuery.status ?? "all",
      };
      const blob = await exportTeachers(params);
      if (!isCurrentExport()) return;
      downloadBlob(blob, "教师名单.xlsx");
      setNotice("教师名单已导出。");
    } catch (error) {
      if (isCurrentExport()) {
        setNotice(`教师名单导出失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (mountedRef.current) setExportBusy(false);
    }
  }

  const visibleTeacherIds = teachers.map((teacher) => teacher.id);
  const selectedVisibleTeacherIds = visibleTeacherIds.filter((id) => selectedTeacherIds.includes(id));

  return (
    <ManagementSection
      title="教师管理"
      count={teacherMeta.total}
      controls={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-2.5">
          <Toolbar
            query={teacherQuery}
            onQueryChange={(patch) => setTeacherQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
            status
            bulk={
              canWrite && selectedVisibleTeacherIds.length ? (
                <BulkActions
                  disabled={busy}
                  count={selectedVisibleTeacherIds.length}
                  onEnable={() =>
                    void run(async () => {
                      await bulkUpdateTeachers({ ids: selectedVisibleTeacherIds, status: "active" });
                      setSelectedTeacherIds([]);
                    })
                  }
                  onDisable={() =>
                    void run(async () => {
                      await bulkUpdateTeachers({ ids: selectedVisibleTeacherIds, status: "disabled" });
                      setSelectedTeacherIds([]);
                    })
                  }
                />
              ) : null
            }
          />
          <button
            type="button"
            data-testid="teachers-export"
            disabled={busy || exportBusy || !canExport}
            onClick={() => void exportFilteredTeachers()}
            className="or-g53-btn-tonal shrink-0 px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportBusy ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
            导出教师
          </button>
        </div>
      }
    >
      <div className="or-g53-table-container">
        <table className="min-w-[860px] w-full text-left text-sm">
          <thead className="border-b border-or-outline bg-or-block text-xs font-semibold text-or-muted">
            <tr>
              <th className="w-10 px-3.5 py-2.5">
                <CurrentPageSelectAll
                  disabled={!canWrite || busy}
                  visibleIds={visibleTeacherIds}
                  selectedIds={selectedTeacherIds}
                  onChange={(checked) => {
                    const pageIds = new Set(visibleTeacherIds);
                    setSelectedTeacherIds((current) => checked
                      ? [...new Set([...current, ...visibleTeacherIds])]
                      : current.filter((id) => !pageIds.has(id)));
                  }}
                />
              </th>
              <th className="px-3.5 py-2.5">账号</th>
              <th className="px-3.5 py-2.5">姓名</th>
              <th className="px-3.5 py-2.5">邮箱</th>
              <th className="px-3.5 py-2.5">教师学科</th>
              <th className="px-3.5 py-2.5">状态</th>
              <th className="px-3.5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--or-outline)]">
            {teachers.map((teacher) => {
              const draft = teacherDrafts[teacher.id] || {
                display_name: teacher.display_name,
                email: optionalText(teacher.email),
                subjects: teacher.subjects.join(", "),
              };
              return (
                <tr key={teacher.id} className="transition-colors hover:bg-or-block/50 align-middle">
                  <td className="px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded accent-or-primary focus:ring-or-focus"
                      checked={selectedTeacherIds.includes(teacher.id)}
                      aria-label={"选择教师 " + teacher.username}
                      disabled={!canWrite || busy}
                      onChange={() => toggleTeacher(teacher.id)}
                    />
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-xs font-medium text-or-muted">{teacher.username}</td>
                  <td className="px-3.5 py-2.5">
                    <input
                      className="or-g53-input w-36 py-1 text-sm font-medium"
                      value={draft.display_name}
                      readOnly={!canWrite}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({
                          ...prev,
                          [teacher.id]: { ...draft, display_name: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <input
                      className="or-g53-input w-44 py-1 text-sm font-medium"
                      value={draft.email}
                      readOnly={!canWrite}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, email: event.target.value } }))
                      }
                    />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <input
                      className="or-g53-input w-44 py-1 text-sm font-medium"
                      value={draft.subjects}
                      readOnly={!canWrite}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({
                          ...prev,
                          [teacher.id]: { ...draft, subjects: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <StatusBadge status={teacher.status} />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex justify-end gap-2">
                      <IconButton
                        label="保存教师"
                        disabled={busy || !canWrite}
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
                        disabled={busy || !canWrite}
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
                        disabled={busy || !canWrite}
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
  const dictionary = useManagementDictionary();
  const subjectListId = useId();
  return (
    <aside className="min-w-0 space-y-6">
      <section className="or-g53-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-or-text">创建教师账号</h2>
        <form className="mt-3 space-y-3" onSubmit={submitTeacher}>
          <input
            className="or-g53-input w-full text-sm"
            placeholder="登录用户名"
            value={teacherUsername}
            onChange={(e) => setTeacherUsername(e.target.value)}
            required
          />
          <input
            className="or-g53-input w-full text-sm"
            type="password"
            placeholder="初始密码"
            value={teacherPassword}
            onChange={(e) => setTeacherPassword(e.target.value)}
            required
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="教师姓名"
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="邮箱"
            type="email"
            value={teacherEmail}
            onChange={(e) => setTeacherEmail(e.target.value)}
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="任教学科（逗号分隔）"
            list={subjectListId}
            value={teacherSubjects}
            onChange={(e) => setTeacherSubjects(e.target.value)}
          />
          <datalist id={subjectListId}>
            {dictionary?.subjects.map((item) => <option key={item.id} value={item.value}>{item.label}</option>)}
          </datalist>
          <button
            type="submit"
            disabled={busy}
            className="or-g53-btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4 shrink-0" />
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
