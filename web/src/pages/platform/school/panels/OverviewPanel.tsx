import { GettingStartedChecklist } from "../../GettingStartedChecklist";
import { SummaryTile, type PageMeta } from "../SchoolControls";
import type { SchoolAiSettings } from "../../../../platform/auth";
import type { SchoolPage } from "../hooks/useSchoolWorkspaceData";

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
    <>
      <GettingStartedChecklist
        description="按顺序完成教师、班级、学生和任课分配"
        steps={[
          { label: "创建教师账号", complete: teacherMeta.total > 0, actionLabel: "创建教师", onAction: () => onNavigate("teachers") },
          { label: "创建班级", complete: classMeta.total > 0, actionLabel: "创建班级", onAction: () => onNavigate("classes") },
          { label: "创建或导入学生", complete: studentMeta.total > 0, actionLabel: "创建学生", onAction: () => onNavigate("students") },
          { label: "分配任课教师", complete: assignmentMeta.total > 0, actionLabel: "分配任课教师", onAction: () => onNavigate("assignments") },
        ]}
      />
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">学校管理总览</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          教师、学生、班级和分配已经拆到单独页面。学生初始账号可以在学生页面查看和导出，教师分配到班级后才能向对应班级发布试卷。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="AI 状态" value={aiSettings?.ai_enabled ? "已开启" : aiSettings?.ai_available ? "可开启" : "未配置"} />
          <SummaryTile label="教师账号" value={`${teacherMeta.total} 个`} />
          <SummaryTile label="班级" value={`${classMeta.total} 个`} />
          <SummaryTile label="学生账号" value={`${studentMeta.total} 个`} />
        </div>
      </section>
    </>
  );
}
