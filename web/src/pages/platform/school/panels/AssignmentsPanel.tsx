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
      <div className="overflow-x-auto">
        <table className="min-w-[680px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-2">教师</th>
              <th className="px-3 py-2">班级</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => (
              <tr key={`${assignment.teacher_id}:${assignment.class_id}:${assignment.subject || ""}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <span className="font-medium">{assignment.teacher_name || assignment.teacher_username}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{assignment.teacher_username}</span>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {[assignment.class_grade, assignment.class_name].filter(Boolean).join(" · ")}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={assignment.teacher_status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <IconButton
                    label="移除分配"
                    disabled={busy}
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
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">分配任课教师</h2>
        <p className="mt-1 text-sm text-slate-500">将教师绑定到对应班级，绑定后教师可查看班级学生并发布作业。</p>
        <form className="mt-4 space-y-3" onSubmit={submitAssignment}>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={assignTeacherId}
            onChange={(e) => setAssignTeacherId(e.target.value)}
            required
          >
            <option value="">选择教师</option>
            {teacherOptions.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.display_name || teacher.username}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={assignClassId}
            onChange={(e) => setAssignClassId(e.target.value)}
            required
          >
            <option value="">选择班级</option>
            {classChoices.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !assignTeacherId || !assignClassId}
            data-testid="assign-teacher-class"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" />
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
