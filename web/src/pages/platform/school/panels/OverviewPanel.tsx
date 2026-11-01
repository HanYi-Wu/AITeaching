import { GettingStartedChecklist } from "../../GettingStartedChecklist";
import { SummaryTile, type PageMeta } from "../SchoolControls";
import type { SchoolAiSettings } from "../../../../platform/auth";
import type { SchoolPage } from "../hooks/useSchoolWorkspaceData";
import "../../../../ui-redesign/g53/g53.css";

type OverviewPanelProps = {
  teacherMeta: PageMeta;
  classMeta: PageMeta;
  studentMeta: PageMeta;
  assignmentMeta: PageMeta;
  aiSettings: SchoolAiSettings | null;
  onNavigate: (page: SchoolPage) => void;
};

export function OverviewPanel({
  teacherMeta,
  classMeta,
  studentMeta,
  assignmentMeta,
  aiSettings,
  onNavigate,
}: OverviewPanelProps) {
  return (
    <div className="space-y-6">
      <GettingStartedChecklist
        description="按顺序完成教师、班级、学生和任课分配"
        steps={[
          { label: "创建教师账号", complete: teacherMeta.total > 0, actionLabel: "创建教师", onAction: () => onNavigate("teachers") },
          { label: "创建班级", complete: classMeta.total > 0, actionLabel: "创建班级", onAction: () => onNavigate("classes") },
          { label: "创建或导入学生", complete: studentMeta.total > 0, actionLabel: "创建学生", onAction: () => onNavigate("students") },
          { label: "分配任课教师", complete: assignmentMeta.total > 0, actionLabel: "分配任课教师", onAction: () => onNavigate("assignments") },
        ]}
      />
      <section className="or-g53-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-or-text">学校管理总览</h2>
        <p className="mt-1.5 text-sm text-or-muted">
          集中管理本校教师学科、班级结构、学生账号与任课分配关系。
        </p>
        <div className="mt-4 grid gap-2.5 sm:gap-3 grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="AI 状态" value={aiSettings?.ai_enabled ? "已开启" : aiSettings?.ai_available ? "可开启" : "未配置"} />
          <SummaryTile label="教师账号" value={`${teacherMeta.total} 个`} />
          <SummaryTile label="班级" value={`${classMeta.total} 个`} />
          <SummaryTile label="学生账号" value={`${studentMeta.total} 个`} />
        </div>
      </section>
    </div>
  );
}
