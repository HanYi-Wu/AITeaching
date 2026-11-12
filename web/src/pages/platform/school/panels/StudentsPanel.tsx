import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, KeyRound, Plus, Save, UserCheck, UserX } from "lucide-react";
import {
  bulkUpdateStudents,
  resetStudentPassword,
  updateStudent,
  type ClassRecord,
  type StudentClassTransferResult,
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
import { StudentTransferDialog } from "./StudentTransferDialog";
import "../../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../../components/ui/select";
import { useManagementCapability } from "../../../../platform/useManagementOptions";

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
      aria-label="全选当前页学生"
      data-testid="students-select-all"
      className="h-4 w-4 rounded accent-or-primary focus:ring-or-focus"
      checked={checked}
      disabled={disabled || visibleIds.length === 0}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

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
  canTransfer: boolean;
  transferScopeKey: string;
  onTransferred: (
    result: StudentClassTransferResult,
    isCurrent: () => boolean,
  ) => Promise<void>;
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
  canTransfer,
  transferScopeKey,
  onTransferred,
}: StudentsMainProps) {
  const canWrite = useManagementCapability("school.students.manage");
  const [transferSelection, setTransferSelection] = useState<{ student: StudentRecord; scopeKey: string } | null>(null);
  const transferStudent = transferSelection?.scopeKey === transferScopeKey ? transferSelection.student : null;
  const visibleStudentIds = students.map((student) => student.id);
  const selectedVisibleStudentIds = visibleStudentIds.filter((id) => selectedStudentIds.includes(id));

  useEffect(() => {
    setTransferSelection((current) => current?.scopeKey === transferScopeKey ? current : null);
  }, [transferScopeKey]);

  return (
    <>
      <ManagementSection
        title="学生账号"
        count={studentMeta.total}
        controls={
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
            <Toolbar
              query={studentQuery}
              onQueryChange={(patch) => setStudentQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
              status
              bulk={
                canWrite && selectedVisibleStudentIds.length ? (
                  <BulkActions
                    disabled={busy}
                    count={selectedVisibleStudentIds.length}
                    onEnable={() =>
                      void run(async () => {
                        await bulkUpdateStudents({ ids: selectedVisibleStudentIds, status: "active" });
                        setSelectedStudentIds([]);
                      })
                    }
                    onDisable={() =>
                      void run(async () => {
                        await bulkUpdateStudents({ ids: selectedVisibleStudentIds, status: "disabled" });
                        setSelectedStudentIds([]);
                      })
                    }
                  />
                ) : null
              }
            />
            <AppSelect
              className="or-g53-select py-1.5 text-sm w-full sm:w-auto"
              value={studentClassFilter}
              onValueChange={(value) => {
                setStudentClassFilter(value);
                setStudentQuery((current) => ({ ...current, page: 1 }));
              }}
            >
              <option value="">全部班级</option>
              {classChoices.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </AppSelect>
          </div>
        }
      >
        <div className="or-g53-table-container">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="border-b border-or-outline bg-or-block text-xs font-semibold text-or-muted">
              <tr>
                <th className="w-10 px-3.5 py-2.5">
                  <CurrentPageSelectAll
                    disabled={!canWrite || busy}
                    visibleIds={visibleStudentIds}
                    selectedIds={selectedStudentIds}
                    onChange={(checked) => {
                      const pageIds = new Set(visibleStudentIds);
                      setSelectedStudentIds((current) => checked
                        ? [...new Set([...current, ...visibleStudentIds])]
                        : current.filter((id) => !pageIds.has(id)));
                    }}
                  />
                </th>
                <th className="px-3.5 py-2.5">学号</th>
                <th className="px-3.5 py-2.5">姓名</th>
                <th className="px-3.5 py-2.5">邮箱</th>
                <th className="px-3.5 py-2.5">班级</th>
                <th className="px-3.5 py-2.5">登录名</th>
                <th className="px-3.5 py-2.5">初始密码</th>
                <th className="px-3.5 py-2.5">状态</th>
                <th className="px-3.5 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--or-outline)]">
              {students.map((student) => {
                const draft = studentDrafts[student.id] || {
                  student_no: student.student_no,
                  display_name: student.display_name,
                  email: optionalText(student.email),
                };
                return (
                  <tr key={student.id} className="transition-colors hover:bg-or-block/50 align-middle">
                    <td className="px-3.5 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-or-primary focus:ring-or-focus"
                        checked={selectedStudentIds.includes(student.id)}
                        disabled={busy || !canWrite}
                        aria-label={"选择学生 " + student.student_no}
                        onChange={() => toggleStudent(student.id)}
                      />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <input
                        className="or-g53-input w-28 py-1 text-sm font-medium"
                        value={draft.student_no}
                        readOnly={!canWrite}
                        onChange={(event) =>
                          setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, student_no: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <input
                        className="or-g53-input w-32 py-1 text-sm font-medium"
                        value={draft.display_name}
                        readOnly={!canWrite}
                        onChange={(event) =>
                          setStudentDrafts((prev) => ({
                            ...prev,
                            [student.id]: { ...draft, display_name: event.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <input
                        className="or-g53-input w-40 py-1 text-sm font-medium"
                        value={draft.email}
                        readOnly={!canWrite}
                        onChange={(event) =>
                          setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, email: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5 text-or-text">
                      {student.class_count !== undefined && student.class_count > 1 ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="or-g53-pill or-g53-pill-warning text-xs font-medium">班级归属需核对</span>
                          {student.class_names ? <span className="text-xs text-or-muted">{student.class_names}</span> : null}
                        </div>
                      ) : (
                        student.class_names || "-"
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-xs font-medium text-or-muted">{student.account_username || "-"}</td>
                    <td className="px-3.5 py-2.5 font-mono text-xs font-medium text-or-muted">{student.initial_password || "-"}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={student.status} />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex justify-end gap-2">
                        <IconButton
                          label="保存学生"
                          disabled={busy || !canWrite}
                          onClick={() =>
                            void run(async () => {
                              await updateStudent(student.id, draft);
                            })
                          }
                          icon={<Save className="h-4 w-4" />}
                        />
                        <IconButton
                          label="重置密码"
                          disabled={busy || !canWrite}
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
                          disabled={busy || !canWrite}
                          onClick={() =>
                            void run(async () => {
                              await updateStudent(student.id, { status: student.status === "active" ? "disabled" : "active" });
                            })
                          }
                          icon={student.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        />
                        {canTransfer && canWrite ? (
                          <IconButton
                            label="转班"
                            disabled={busy}
                            onClick={() => setTransferSelection({ student, scopeKey: transferScopeKey })}
                            icon={<ArrowRightLeft className="h-4 w-4" />}
                          />
                        ) : null}
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
      {canTransfer && canWrite && transferStudent ? (
        <StudentTransferDialog
          student={transferStudent}
          scopeKey={transferScopeKey}
          onClose={() => setTransferSelection(null)}
          onTransferred={onTransferred}
        />
      ) : null}
    </>
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
      <section className="or-g53-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-or-text">录入学生</h2>
        <p className="mt-1 text-xs leading-5 text-or-muted">
          学生只能归属一个当前班级；同班导入更新资料，跨班请使用“转班”。
        </p>
        <form className="mt-3 space-y-3" onSubmit={submitStudent}>
          <AppSelect
            className="or-g53-select w-full text-sm"
            value={studentClassId}
            onValueChange={(value) => setStudentClassId(value)}
          >
            <option value="">未指定班级</option>
            {classChoices.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </AppSelect>
          <input
            className="or-g53-input w-full text-sm"
            placeholder="学号，如 S001"
            value={studentNo}
            onChange={(e) => setStudentNo(e.target.value)}
            required
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="姓名"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            required
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="邮箱（可选）"
            type="email"
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="or-g53-btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4 shrink-0" />
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
