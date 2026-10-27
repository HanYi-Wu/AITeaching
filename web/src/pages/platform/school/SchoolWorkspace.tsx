import { Download, RefreshCw } from "lucide-react";
import {
  exportStudentAccounts,
  type PlatformUser,
  type StudentClassTransferResult,
} from "../../../platform/auth";
import { PlatformShell } from "../PlatformShell";
import { Metric } from "./SchoolControls";
import {
  downloadBlob,
  useSchoolWorkspaceData,
  type SchoolPage,
} from "./hooks/useSchoolWorkspaceData";
import { AssignmentsAsidePanel, AssignmentsMainPanel } from "./panels/AssignmentsPanel";
import { ClassesAsidePanel, ClassesMainPanel } from "./panels/ClassesPanel";
import { OverviewPanel } from "./panels/OverviewPanel";
import { SchoolAiPanel } from "./panels/SchoolAiPanel";
import { StudentsAsidePanel, StudentsMainPanel } from "./panels/StudentsPanel";
import { TeachersAsidePanel, TeachersMainPanel } from "./panels/TeachersPanel";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

export function SchoolWorkspace({ user, onLogout, onError }: Props) {
  const data = useSchoolWorkspaceData(user, onError);
  const studentTransferScopeKey = JSON.stringify([
    user.id,
    user.school_id ?? "",
    data.studentClassFilter,
    data.studentQuery.q,
    data.studentQuery.status,
    data.studentQuery.page,
    data.studentQuery.pageSize,
  ]);

  const pages: Array<{ id: SchoolPage; label: string; description: string }> = [
    { id: "overview", label: "总览", description: "学校数据概览" },
    { id: "teachers", label: "教师", description: "教师账号和学科" },
    { id: "classes", label: "班级", description: "班级导入和管理" },
    { id: "students", label: "学生", description: "学生账号和导出" },
    { id: "assignments", label: "分配", description: "教师班级分配" },
    { id: "ai", label: "AI", description: "学校端 AI 能力" },
  ];

  const actions = (
    <>
      <button
        type="button"
        onClick={() => void data.refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)))}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <RefreshCw className="h-4 w-4" />
        刷新
      </button>
      <button
        type="button"
        data-testid="students-export-link"
        onClick={() =>
          void data.run(async () => {
            const blob = await exportStudentAccounts();
            downloadBlob(blob, "student_accounts.xlsx");
          })
        }
        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        <Download className="h-4 w-4" />
        导出学生账号
      </button>
    </>
  );

  return (
    <PlatformShell
      roleLabel="学校端"
      title={user.display_name || user.username}
      subtitle="管理教师、教师学科、班级、学生账号和班级分配。"
      userName={user.username}
      actions={actions}
      onLogout={onLogout}
    >
      <div className={data.activePage === "overview" || data.activePage === "ai" ? "space-y-6" : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"}>
        <section className="min-w-0 space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="教师" value={data.teacherMeta.total} />
            <Metric label="班级" value={data.classMeta.total} />
            <Metric label="学生" value={data.studentMeta.total} />
            <Metric label="分配" value={data.assignmentMeta.total} />
          </div>

          <nav className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            {pages.map((page) => {
              const selected = data.activePage === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  data-testid={`school-page-${page.id}`}
                  onClick={() => data.setActivePage(page.id)}
                  className={`rounded-lg border px-3 py-3 text-left shadow-sm transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  <span className="block text-sm font-semibold">{page.label}</span>
                  <span className={`mt-1 block text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>
                    {page.description}
                  </span>
                </button>
              );
            })}
          </nav>

          {data.activePage === "overview" ? (
            <OverviewPanel
              teacherMeta={data.teacherMeta}
              classMeta={data.classMeta}
              studentMeta={data.studentMeta}
              assignmentMeta={data.assignmentMeta}
              aiSettings={data.aiSettings}
              onNavigate={data.setActivePage}
            />
          ) : null}

          {data.activePage === "teachers" ? (
            <TeachersMainPanel
              teachers={data.teachers}
              teacherMeta={data.teacherMeta}
              teacherQuery={data.teacherQuery}
              setTeacherQuery={data.setTeacherQuery}
              selectedTeacherIds={data.selectedTeacherIds}
              setSelectedTeacherIds={data.setSelectedTeacherIds}
              toggleTeacher={data.toggleTeacher}
              teacherDrafts={data.teacherDrafts}
              setTeacherDrafts={data.setTeacherDrafts}
              busy={data.busy}
              run={(action) => data.run(action, ["teachers"])}
              setNotice={data.setNotice}
            />
          ) : null}

          {data.activePage === "classes" ? (
            <ClassesMainPanel
              classes={data.classes}
              classMeta={data.classMeta}
              classQuery={data.classQuery}
              setClassQuery={data.setClassQuery}
              classDrafts={data.classDrafts}
              setClassDrafts={data.setClassDrafts}
              busy={data.busy}
              run={(action) => data.run(action, ["classes"])}
            />
          ) : null}

          {data.activePage === "students" ? (
            <StudentsMainPanel
              students={data.students}
              studentMeta={data.studentMeta}
              studentQuery={data.studentQuery}
              setStudentQuery={data.setStudentQuery}
              selectedStudentIds={data.selectedStudentIds}
              setSelectedStudentIds={data.setSelectedStudentIds}
              toggleStudent={data.toggleStudent}
              studentDrafts={data.studentDrafts}
              setStudentDrafts={data.setStudentDrafts}
              classChoices={data.classChoices}
              studentClassFilter={data.studentClassFilter}
              setStudentClassFilter={data.setStudentClassFilter}
              busy={data.busy}
              run={(action) => data.run(action, ["students"])}
              setNotice={data.setNotice}
              canTransfer={user.role === "school"}
              transferScopeKey={studentTransferScopeKey}
              onTransferred={async (result: StudentClassTransferResult, isCurrent: () => boolean) => {
                try {
                  const refreshed = await data.refreshTargets(["students", "classes"]);
                  if (!isCurrent()) return;
                  data.setNotice(refreshed
                    ? `学生转班完成，保留 ${result.retained_attempt_count} 份考试记录。`
                    : "转班已完成，但学生或班级列表刷新失败，请点击“刷新”重新加载。",
                  );
                } catch {
                  if (!isCurrent()) return;
                  data.setNotice("转班已完成，但学生或班级列表刷新失败，请点击“刷新”重新加载。");
                }
              }}
            />
          ) : null}

          {data.activePage === "assignments" ? (
            <AssignmentsMainPanel
              assignments={data.assignments}
              assignmentMeta={data.assignmentMeta}
              assignmentQuery={data.assignmentQuery}
              setAssignmentQuery={data.setAssignmentQuery}
              busy={data.busy}
              run={(action) => data.run(action, ["assignments"])}
            />
          ) : null}

          {data.activePage === "ai" ? (
            <SchoolAiPanel
              aiSettings={data.aiSettings}
              schoolAiMessages={data.schoolAiMessages}
              schoolAiInput={data.schoolAiInput}
              setSchoolAiInput={data.setSchoolAiInput}
              schoolAiBusy={data.schoolAiBusy}
              submitSchoolAi={data.submitSchoolAi}
              busy={data.busy}
              setSchoolAiEnabled={data.setSchoolAiEnabled}
              schoolAiImportKind={data.schoolAiImportKind}
              setSchoolAiImportKind={data.setSchoolAiImportKind}
              studentClassId={data.studentClassId}
              setStudentClassId={data.setStudentClassId}
              classChoices={data.classChoices}
              schoolAiImportFile={data.schoolAiImportFile}
              setSchoolAiImportFile={data.setSchoolAiImportFile}
              pendingSchoolAiImport={data.pendingSchoolAiImport}
              setPendingSchoolAiImport={data.setPendingSchoolAiImport}
              downloadTemplate={data.downloadTemplate}
              confirmSchoolAiImport={data.confirmSchoolAiImport}
              runSchoolAiImport={data.runSchoolAiImport}
            />
          ) : null}

          {data.notice ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {data.notice}
            </div>
          ) : null}
        </section>

        {data.activePage === "teachers" ? (
          <TeachersAsidePanel
            busy={data.busy}
            submitTeacher={data.submitTeacher}
            teacherUsername={data.teacherUsername}
            setTeacherUsername={data.setTeacherUsername}
            teacherPassword={data.teacherPassword}
            setTeacherPassword={data.setTeacherPassword}
            teacherName={data.teacherName}
            setTeacherName={data.setTeacherName}
            teacherEmail={data.teacherEmail}
            setTeacherEmail={data.setTeacherEmail}
            teacherSubjects={data.teacherSubjects}
            setTeacherSubjects={data.setTeacherSubjects}
            downloadTemplate={data.downloadTemplate}
            handleFile={data.handleFile}
          />
        ) : null}

        {data.activePage === "classes" ? (
          <ClassesAsidePanel
            busy={data.busy}
            submitClass={data.submitClass}
            className={data.className}
            setClassName={data.setClassName}
            grade={data.grade}
            setGrade={data.setGrade}
            downloadTemplate={data.downloadTemplate}
            handleFile={data.handleFile}
          />
        ) : null}

        {data.activePage === "students" ? (
          <StudentsAsidePanel
            busy={data.busy}
            submitStudent={data.submitStudent}
            classChoices={data.classChoices}
            studentClassId={data.studentClassId}
            setStudentClassId={data.setStudentClassId}
            studentNo={data.studentNo}
            setStudentNo={data.setStudentNo}
            studentName={data.studentName}
            setStudentName={data.setStudentName}
            studentEmail={data.studentEmail}
            setStudentEmail={data.setStudentEmail}
            downloadTemplate={data.downloadTemplate}
            handleFile={data.handleFile}
          />
        ) : null}

        {data.activePage === "assignments" ? (
          <AssignmentsAsidePanel
            busy={data.busy}
            submitAssignment={data.submitAssignment}
            assignTeacherId={data.assignTeacherId}
            setAssignTeacherId={data.setAssignTeacherId}
            assignClassId={data.assignClassId}
            setAssignClassId={data.setAssignClassId}
            teacherOptions={data.teacherOptions}
            classChoices={data.classChoices}
            downloadTemplate={data.downloadTemplate}
            handleFile={data.handleFile}
          />
        ) : null}
      </div>
    </PlatformShell>
  );
}
