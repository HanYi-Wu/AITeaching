import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { Link2, Trash2 } from "lucide-react";
import {
  removeTeacherClassAssignment,
  type ClassRecord,
  type TeacherClassAssignmentRecord,
  type TeacherRecord,
} from "../../../../platform/auth";
import {
  IconButton,
  ImportActions,
  ManagementSection,
  Pager,
  StatusBadge,
  Toolbar,
  type PageMeta,
  type PageQuery,
} from "../SchoolControls";
import "../../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../../components/ui/select";
import { useManagementCapability } from "../../../../platform/useManagementOptions";

type AssignmentsMainProps = {
  assignments: TeacherClassAssignmentRecord[];
  assignmentMeta: PageMeta;
  assignmentQuery: PageQuery;
  setAssignmentQuery: Dispatch<SetStateAction<PageQuery>>;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function AssignmentsMainPanel({
  assignments,
  assignmentMeta,
  assignmentQuery,
  setAssignmentQuery,
  busy,
  run,
}: AssignmentsMainProps) {
  const canWrite = useManagementCapability("school.assignments.manage");
  return (
    <ManagementSection
      title="教师班级分配"
      count={assignmentMeta.total}
      controls={
        <Toolbar
          query={assignmentQuery}
          onQueryChange={(patch) => setAssignmentQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
        />
      }
    >
      <div className="or-g53-table-container">
        <table className="min-w-[680px] w-full text-left text-sm">
          <thead className="border-b border-or-outline bg-or-block text-xs font-semibold text-or-muted">
            <tr>
              <th className="px-3.5 py-2.5">教师</th>
              <th className="px-3.5 py-2.5">班级</th>
              <th className="px-3.5 py-2.5">状态</th>
              <th className="px-3.5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--or-outline)]">
            {assignments.map((assignment) => (
              <tr key={`${assignment.teacher_id}:${assignment.class_id}:${assignment.subject || ""}`} className="transition-colors hover:bg-or-block/50 align-middle">
                <td className="px-3.5 py-2.5">
                  <span className="font-semibold text-or-text">{assignment.teacher_name || assignment.teacher_username}</span>
                  <span className="ml-2 font-mono text-xs font-medium text-or-muted">{assignment.teacher_username}</span>
                </td>
                <td className="px-3.5 py-2.5 font-medium text-or-text">
                  {[assignment.class_grade, assignment.class_name].filter(Boolean).join(" · ")}
                </td>
                <td className="px-3.5 py-2.5">
                  <StatusBadge status={assignment.teacher_status} />
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <IconButton
                    label="移除分配"
                    disabled={busy || !canWrite}
                    onClick={() =>
                      void run(async () => {
                        await removeTeacherClassAssignment({
                          teacher_id: assignment.teacher_id,
                          class_id: assignment.class_id,
                          subject: assignment.subject || null,
                        });
                      })
                    }
                    icon={<Trash2 className="h-4 w-4" />}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager meta={assignmentMeta} onPage={(page) => setAssignmentQuery((current) => ({ ...current, page }))} />
    </ManagementSection>
  );
}

type AssignmentsAsideProps = {
  busy: boolean;
  submitAssignment: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  assignTeacherId: string;
  setAssignTeacherId: Dispatch<SetStateAction<string>>;
  assignClassId: string;
  setAssignClassId: Dispatch<SetStateAction<string>>;
  teacherOptions: TeacherRecord[];
  classChoices: ClassRecord[];
  downloadTemplate: (kind: "assignments") => Promise<void>;
  handleFile: (event: ChangeEvent<HTMLInputElement>, kind: "assignments") => Promise<void>;
};

export function AssignmentsAsidePanel({
  busy,
  submitAssignment,
  assignTeacherId,
  setAssignTeacherId,
  assignClassId,
  setAssignClassId,
  teacherOptions,
  classChoices,
  downloadTemplate,
  handleFile,
}: AssignmentsAsideProps) {
  return (
    <aside className="min-w-0 space-y-6">
      <section className="or-g53-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-or-text">分配任课教师</h2>
        <form className="mt-3 space-y-3" onSubmit={submitAssignment}>
          <AppSelect
            className="or-g53-select w-full text-sm"
            value={assignTeacherId}
            onValueChange={(value) => setAssignTeacherId(value)}
            required
          >
            <option value="">选择教师</option>
            {teacherOptions.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.display_name || teacher.username}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            className="or-g53-select w-full text-sm"
            value={assignClassId}
            onValueChange={(value) => setAssignClassId(value)}
            required
          >
            <option value="">选择班级</option>
            {classChoices.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </AppSelect>
          <button
            type="submit"
            disabled={busy || !assignTeacherId || !assignClassId}
            data-testid="assign-teacher-class"
            className="or-g53-btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 className="h-4 w-4 shrink-0" />
            分配班级
          </button>
        </form>
      </section>
      <ImportActions
        kind="assignments"
        label="导入教师班级分配 JSON / Excel"
        testId="assignments-import-file"
        onTemplate={() => void downloadTemplate("assignments")}
        onChange={(event) => void handleFile(event, "assignments")}
      />
    </aside>
  );
}
