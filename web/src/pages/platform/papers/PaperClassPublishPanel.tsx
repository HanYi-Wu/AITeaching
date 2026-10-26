import { CheckCircle2 } from "lucide-react";
import { ContentFolderHelp } from "../../../components/ContentFolders";
import type { ContentFolder, PlatformPaperRecord, PaperSubmissionMode, TeacherClassRecord, TeacherClassStudentRecord } from "../../../platform/auth";

export type PaperClassPublishPanelProps = {
  selectedPaper: PlatformPaperRecord;
  folders: ContentFolder[];
  publishFolderId: string;
  newFolderName: string;
  recipientScope: "class" | "student";
  selectedClassIds: string[];
  selectedStudentIds: string[];
  studentSearch: string;
  classStudents: TeacherClassStudentRecord[];
  teacherSubjects: string[];
  selectedSubject: string;
  classes: TeacherClassRecord[];
  alreadyPublishedClassIds: Set<string>;
  submissionMode: PaperSubmissionMode;
  maxScreenSwitches: number;
  publishStartAt: string;
  publishEndAt: string;
  timeLimitMinutes: number;
  canPublish: boolean;
  onRecipientScopeChange: (scope: "class" | "student") => void;
  onFolderChange: (folderId: string) => void;
  onConvertFolder: () => void;
  onNewFolderNameChange: (name: string) => void;
  onCreateFolder: () => void;
  onSubjectChange: (subject: string) => void;
  onToggleClass: (classId: string) => void;
  onStudentSearchChange: (value: string) => void;
  onToggleStudent: (studentId: string) => void;
  onSubmissionModeChange: (mode: PaperSubmissionMode) => void;
  onMaxScreenSwitchesChange: (value: number) => void;
  onPublishStartAtChange: (value: string) => void;
  onPublishEndAtChange: (value: string) => void;
  onTimeLimitMinutesChange: (value: number) => void;
  onPublish: () => void;
};

export function PaperClassPublishPanel({
  selectedPaper,
  folders,
  publishFolderId,
  newFolderName,
  recipientScope,
  selectedClassIds,
  selectedStudentIds,
  studentSearch,
  classStudents,
  teacherSubjects,
  selectedSubject,
  classes,
  alreadyPublishedClassIds,
  submissionMode,
  maxScreenSwitches,
  publishStartAt,
  publishEndAt,
  timeLimitMinutes,
  canPublish,
  onRecipientScopeChange,
  onFolderChange,
  onConvertFolder,
  onNewFolderNameChange,
  onCreateFolder,
  onSubjectChange,
  onToggleClass,
  onStudentSearchChange,
  onToggleStudent,
  onSubmissionModeChange,
  onMaxScreenSwitchesChange,
  onPublishStartAtChange,
  onPublishEndAtChange,
  onTimeLimitMinutesChange,
  onPublish,
}: PaperClassPublishPanelProps) {
  return (
    <>
      <div className="mb-4 flex gap-2"><button type="button" onClick={() => onRecipientScopeChange("class")} className={`rounded border px-3 py-1.5 text-sm ${recipientScope === "class" ? "bg-slate-900 text-white" : "bg-white"}`}>发布到班级</button><button type="button" onClick={() => onRecipientScopeChange("student")} className={`rounded border px-3 py-1.5 text-sm ${recipientScope === "student" ? "bg-slate-900 text-white" : "bg-white"}`}>指定学生</button></div>
      <ContentFolderHelp paper />
      <label className="mb-3 block text-sm">试卷归类（必选）<select aria-label="发布文件夹" value={publishFolderId} onChange={(event) => onFolderChange(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">请选择文件夹</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}</option>)}</select></label>
      {recipientScope === "student" && publishFolderId && folders.find((folder) => folder.id === publishFolderId)?.kind === "category" ? <button type="button" className="mb-3 rounded border border-violet-300 px-2 py-1 text-xs text-violet-700" onClick={onConvertFolder}>将空文件夹转为试卷文件夹</button> : null}
      <div className="mb-4 flex gap-2"><input aria-label="新文件夹名称" value={newFolderName} onChange={(event) => onNewFolderNameChange(event.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" placeholder="新建文件夹名称" /><button type="button" disabled={!newFolderName.trim()} className="rounded border px-2 py-1 text-xs disabled:opacity-50" onClick={onCreateFolder}>新建并选择</button></div>
      <label className="mb-4 block text-sm font-medium text-slate-700">
        发布学科
        <select
          data-testid="paper-publish-subject"
          value={selectedSubject || (teacherSubjects.length === 1 ? teacherSubjects[0] : "")}
          onChange={(event) => onSubjectChange(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {teacherSubjects.length > 1 ? <option value="">请选择学科</option> : null}
          {teacherSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
          {teacherSubjects.length === 0 ? <option value={selectedPaper.subject}>{selectedPaper.subject || "通用"}</option> : null}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {classes.map((klass) => {
          const alreadyPublished = recipientScope === "class" && alreadyPublishedClassIds.has(klass.id);
          return (
            <label
              key={klass.id}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                alreadyPublished
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                  : "cursor-pointer border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                data-testid={`paper-class-${klass.id}`}
                type={recipientScope === "student" ? "radio" : "checkbox"}
                name={recipientScope === "student" ? "personal-publish-class" : undefined}
                disabled={alreadyPublished}
                checked={selectedClassIds.includes(klass.id)}
                onChange={() => onToggleClass(klass.id)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{klass.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {alreadyPublished
                    ? "已发布到该班"
                    : [klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
        {classes.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            暂无可发布班级
          </div>
        ) : null}
      </div>
      {recipientScope === "student" && selectedClassIds.length === 1 ? <div className="mt-3 rounded-lg border border-slate-200 p-3"><input aria-label="搜索指定学生" value={studentSearch} onChange={(event) => onStudentSearchChange(event.target.value)} placeholder="按姓名或学号搜索" className="mb-2 w-full rounded border px-2 py-1.5 text-sm" /><div className="max-h-40 space-y-1 overflow-auto">{classStudents.filter((student) => `${student.display_name} ${student.student_no}`.toLowerCase().includes(studentSearch.toLowerCase())).map((student) => <label key={student.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-slate-50"><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => onToggleStudent(student.id)} />{student.display_name} · {student.student_no}</label>)}</div><p className="mt-1 text-xs text-slate-500">已选 {selectedStudentIds.length} 人；每人在所选试卷文件夹内最多收到一份。</p></div> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          ["online", "网页答题"],
          ["image_manual", "图片人工批改"],
          ["image_ai", "图片 OCR+AI"],
        ].map(([mode, label]) => (
          <label
            key={mode}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              submissionMode === mode ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
            }`}
          >
            <input
              data-testid={`paper-submission-${mode.replace("_", "-")}`}
              type="radio"
              name="paper-submission-mode"
              value={mode}
              checked={submissionMode === mode}
              onChange={() => onSubmissionModeChange(mode as PaperSubmissionMode)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <label className="mt-4 block text-sm font-medium text-slate-700">
        允许切屏次数
        <input
          type="number"
          min={0}
          max={999}
          value={maxScreenSwitches}
          onChange={(event) => onMaxScreenSwitchesChange(Math.max(0, Number(event.target.value || 0)))}
          className="mt-1 w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
        />
      </label>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          开始时间
          <input
            type="datetime-local"
            value={publishStartAt}
            onChange={(event) => onPublishStartAtChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          结束时间
          <input
            type="datetime-local"
            value={publishEndAt}
            onChange={(event) => onPublishEndAtChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          做题时长（分钟）
          <input
            data-testid="paper-time-limit"
            type="number"
            min={0}
            max={1440}
            value={timeLimitMinutes}
            onChange={(event) => onTimeLimitMinutesChange(Math.max(0, Number(event.target.value || 0)))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
          />
        </label>
      </div>
      {selectedPaper.question_count <= 0 ? (
        <p className="mt-3 text-sm text-amber-700">试卷至少需要包含 1 道题后才能发布。</p>
      ) : null}
      {selectedClassIds.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">请选择至少一个未发布过的班级。</p>
      ) : null}
      <button
        type="button"
        data-testid="paper-publish"
        disabled={!canPublish}
        onClick={onPublish}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        <CheckCircle2 className="h-4 w-4" />
        {recipientScope === "student" ? "布置个人练习" : "发布到班级"}
      </button>
    </>
  );
}
