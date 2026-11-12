import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  type PlatformUser,
  type StudentClassTransferResult,
} from "../../../platform/auth";
import { PlatformShell } from "../PlatformShell";
import { Metric } from "./SchoolControls";
import {
  useSchoolWorkspaceData,
  type SchoolPage,
} from "./hooks/useSchoolWorkspaceData";
import { AssignmentsAsidePanel, AssignmentsMainPanel } from "./panels/AssignmentsPanel";
import { ClassesAsidePanel, ClassesMainPanel } from "./panels/ClassesPanel";
import { OverviewPanel } from "./panels/OverviewPanel";
import { SchoolAiPanel } from "./panels/SchoolAiPanel";
import { StudentsAsidePanel, StudentsMainPanel } from "./panels/StudentsPanel";
import { TeachersAsidePanel, TeachersMainPanel } from "./panels/TeachersPanel";
import { SchoolExportDialog } from "./panels/SchoolExportDialog";
import { ActivityPanel } from "../management/ActivityPanel";
import { AccessPanel } from "../management/AccessPanel";
import { AuditPanel } from "../management/AuditPanel";
import { ManagementSettingsPanel } from "../management/ManagementSettingsPanel";
import { ManagementOptionsProvider, useManagementOptions } from "../../../platform/useManagementOptions";
import { canManage } from "../../../platform/managementAccess";
import type { ManagementHelpLink } from "../../../platform/managementHelpApi";
import "../../../ui-redesign/g53/g53.css";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
  onProfileUpdated?: (user: PlatformUser) => void;
};

export function SchoolWorkspace({ user, onLogout, onError, onProfileUpdated }: Props) {
  const managementOptions = useManagementOptions(user);
  const data = useSchoolWorkspaceData(user, onError, managementOptions);
  const [exportKind, setExportKind] = useState<"accounts" | "analysis" | null>(null);
  const [permissionHelpTarget, setPermissionHelpTarget] = useState<ManagementHelpLink | null>(null);
  const [permissionNavigation, setPermissionNavigation] = useState(0);
  useEffect(() => {
    setPermissionHelpTarget(null);
    setPermissionNavigation(0);
  }, [user.id, user.school_id]);
  const studentTransferScopeKey = JSON.stringify([
    user.id,
    user.school_id ?? "",
    data.studentClassFilter,
    data.studentQuery.q,
    data.studentQuery.status,
    data.studentQuery.page,
    data.studentQuery.pageSize,
  ]);

  const pageOptions: Array<{ id: SchoolPage; label: string; permission: string }> = [
    { id: "overview", label: "总览", permission: "school.overview.read" },
    { id: "teachers", label: "教师", permission: "school.teachers.read" },
    { id: "classes", label: "班级", permission: "school.classes.read" },
    { id: "students", label: "学生", permission: "school.students.read" },
    { id: "assignments", label: "分配", permission: "school.assignments.read" },
    { id: "ai", label: "AI", permission: "school.ai.read" },
    { id: "audit", label: "操作日志", permission: "school.audit.read" },
    { id: "access", label: "权限管理", permission: "school.access.read" },
    { id: "settings", label: "参数字典", permission: "school.settings.read" },
    { id: "activity", label: "管理活动", permission: "school.activity.read" },
  ];
  const pages = pageOptions.filter((page) => canManage(user, page.permission));
  const activePageVisible = pages.some((page) => page.id === data.activePage);
  useEffect(() => {
    if (!activePageVisible) data.setActivePage("overview");
  }, [activePageVisible, data.activePage, data.setActivePage]);
  const managementPage = ["audit", "access", "settings", "activity"].includes(data.activePage);
  const hasAside = (
    (data.activePage === "teachers" && canManage(user, "school.teachers.manage")) ||
    (data.activePage === "classes" && canManage(user, "school.classes.manage")) ||
    (data.activePage === "students" && canManage(user, "school.students.manage")) ||
    (data.activePage === "assignments" && canManage(user, "school.assignments.manage"))
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {!managementPage ? <button
        type="button"
        onClick={() => void data.refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)))}
        className="or-g53-btn-tonal px-3.5 py-2 text-sm"
      >
        <RefreshCw className="h-4 w-4 shrink-0 text-or-muted" />
        刷新
      </button> : null}
      {canManage(user, "school.students.export") ? <button
        type="button"
        data-testid="students-export-link"
        onClick={() => setExportKind("accounts")}
        className="or-g53-btn-primary px-4 py-2 text-sm"
      >
        <Download className="h-4 w-4 shrink-0" />
        导出学生账号
      </button> : null}
      {canManage(user, "school.reports.export") ? <button type="button" onClick={() => setExportKind("analysis")} className="or-g53-btn-tonal px-4 py-2 text-sm">
        <Download className="h-4 w-4 shrink-0" />导出成绩分析
      </button> : null}
    </div>
  );

  return (
    <ManagementOptionsProvider user={user} value={managementOptions}>
    <div className="or-g53-root contents">
      {exportKind ? <SchoolExportDialog key={`${user.id}:${user.school_id}:${exportKind}`} kind={exportKind} onClose={() => setExportKind(null)} /> : null}
      <PlatformShell
        roleLabel="学校端"
        title={user.display_name || user.username}
        userName={user.username}
        accountUser={user}
        onProfileUpdated={onProfileUpdated}
        helpContext={{ section: data.activePage, school_id: user.school_id ?? undefined }}
        onHelpNavigate={(link) => {
          const target = pages.find((page) => page.id === link.section);
          if (!target) return;
          if (target.id === "access") {
            setPermissionHelpTarget(link);
            setPermissionNavigation((value) => value + 1);
          }
          data.setActivePage(target.id);
        }}
        actions={actions}
        onLogout={onLogout}
      >
        <div className={`or-workspace-content ${!hasAside ? "space-y-6" : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"}`}>
          <section className="or-workspace-content min-w-0 space-y-6">
            {!managementPage ? <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4">
              <Metric label="教师" value={data.schoolStats?.teachers ?? data.teacherMeta.total} />
              <Metric label="班级" value={data.schoolStats?.classes ?? data.classMeta.total} />
              <Metric label="学生" value={data.schoolStats?.students ?? data.studentMeta.total} />
              <Metric label="分配" value={data.schoolStats?.assignments ?? data.assignmentMeta.total} />
            </div> : null}

            <nav className="management-section-nav grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="学校管理页面导航">
              {pages.map((page) => {
                const selected = data.activePage === page.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    data-testid={`school-page-${page.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => data.setActivePage(page.id)}
                    className={`rounded-2xl border px-3 sm:px-3.5 py-3 text-left transition-all ${
                      selected
                        ? "border-or-primary bg-or-primary text-or-on-primary shadow-sm"
                        : "border-or-outline bg-or-card text-or-text hover:border-or-outline hover:bg-or-block"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{page.label}</span>
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
                schoolStats={data.schoolStats}
                aiSettings={data.aiSettings}
                onNavigate={data.setActivePage}
              />
            ) : null}

            {data.activePage === "teachers" ? (
              <TeachersMainPanel
                key={`${user.id}:${user.school_id ?? ""}`}
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
                key={`${user.id}:${user.school_id ?? ""}`}
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

            {data.activePage === "audit" ? <AuditPanel key={`${user.id}:${user.school_id ?? ""}:school`} user={user} scope="school" /> : null}
            {data.activePage === "access" ? <AccessPanel key={`${user.id}:${user.school_id ?? ""}:school:${permissionNavigation}`} user={user} scope="school" requestedView={permissionHelpTarget?.view} requestedTrace={permissionHelpTarget?.trace} onNavigateSection={(section) => {
              const target = pages.find((page) => page.id === section);
              if (target) data.setActivePage(target.id);
            }} /> : null}
            {data.activePage === "settings" ? <ManagementSettingsPanel key={`${user.id}:${user.school_id ?? ""}:school`} user={user} scope="school" /> : null}
            {data.activePage === "activity" ? <ActivityPanel key={`${user.id}:${user.school_id ?? ""}:school`} user={user} scope="school" /> : null}

            {data.notice ? (
              <div className="or-g53-warning-surface rounded-xl px-4 py-3 text-sm font-medium shadow-sm">
                {data.notice}
              </div>
            ) : null}
          </section>

          {data.activePage === "teachers" && canManage(user, "school.teachers.manage") ? (
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

          {data.activePage === "classes" && canManage(user, "school.classes.manage") ? (
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

          {data.activePage === "students" && canManage(user, "school.students.manage") ? (
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

          {data.activePage === "assignments" && canManage(user, "school.assignments.manage") ? (
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
    </div>
    </ManagementOptionsProvider>
  );
}
