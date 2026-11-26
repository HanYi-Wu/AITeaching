import { GettingStartedChecklist } from "../../GettingStartedChecklist";
import type { PageMeta } from "../SchoolControls";
import type { SchoolAiResponse, SchoolAiSettings } from "../../../../platform/auth";
import type { SchoolPage } from "../hooks/useSchoolWorkspaceData";
import "../../../../ui-redesign/g53/g53.css";
import { useManagementCapability } from "../../../../platform/useManagementOptions";

type OverviewPanelProps = {
  teacherMeta: PageMeta;
  classMeta: PageMeta;
  studentMeta: PageMeta;
  assignmentMeta: PageMeta;
  schoolStats: SchoolAiResponse["stats"] | null;
  aiSettings: SchoolAiSettings | null;
  onNavigate: (page: SchoolPage) => void;
};

export function OverviewPanel({
  teacherMeta,
  classMeta,
  studentMeta,
  assignmentMeta,
  schoolStats,
  aiSettings,
  onNavigate,
}: OverviewPanelProps) {
  const teacherWrite = useManagementCapability("school.teachers.manage");
  const classWrite = useManagementCapability("school.classes.manage");
  const studentWrite = useManagementCapability("school.students.manage");
  const assignmentWrite = useManagementCapability("school.assignments.manage");
  const teachers = schoolStats?.teachers ?? teacherMeta.total;
  const classes = schoolStats?.classes ?? classMeta.total;
  const students = schoolStats?.students ?? studentMeta.total;
  const assignments = schoolStats?.assignments ?? assignmentMeta.total;

  return (
    <div className="space-y-4">
      <div className="or-g53-card flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-base font-semibold text-or-text">学校管理总览</h2>
        <span className="rounded-full border border-or-outline bg-or-primary-container px-3 py-1 text-xs font-semibold text-or-on-container">
          AI {aiSettings?.ai_enabled ? "已开启" : aiSettings?.ai_available ? "可开启" : "未配置"}
        </span>
      </div>
      <GettingStartedChecklist
        steps={[
          { label: "创建教师账号", complete: teachers > 0, actionLabel: teacherWrite ? "创建教师" : undefined, onAction: teacherWrite ? () => onNavigate("teachers") : undefined },
          { label: "创建班级", complete: classes > 0, actionLabel: classWrite ? "创建班级" : undefined, onAction: classWrite ? () => onNavigate("classes") : undefined },
          { label: "创建或导入学生", complete: students > 0, actionLabel: studentWrite ? "创建学生" : undefined, onAction: studentWrite ? () => onNavigate("students") : undefined },
          { label: "分配任课教师", complete: assignments > 0, actionLabel: assignmentWrite ? "分配任课教师" : undefined, onAction: assignmentWrite ? () => onNavigate("assignments") : undefined },
        ]}
      />
    </div>
  );
}
