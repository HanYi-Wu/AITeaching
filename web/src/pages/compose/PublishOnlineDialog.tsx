import { useTranslation } from "react-i18next";
import { AdaptivePracticeSelector } from "../../components/AdaptivePracticeSelector";
import { ContentFolderHelp } from "../../components/ContentFolders";
import type {
  ContentFolder,
  PaperSubmissionMode,
  PracticeHistoryRecord,
  PracticePublishMode,
  TeacherClassRecord,
  TeacherClassStudentRecord,
} from "../../platform/auth";

export type PublishOnlineDialogProps = {
  open: boolean;
  busy: boolean;
  countsOk: boolean;
  recipientScope: "class" | "student";
  onRecipientScopeChange: (scope: "class" | "student") => void;
  folders: ContentFolder[];
  folderId: string;
  onFolderIdChange: (folderId: string) => void;
  onConvertCategoryFolderToPaper: (folderId: string) => void;
  newFolderName: string;
  onNewFolderNameChange: (name: string) => void;
  onCreateAndSelectFolder: () => void;
  classes: TeacherClassRecord[];
  selectedClassIds: string[];
  onToggleClass: (classId: string) => void;
  students: TeacherClassStudentRecord[];
  selectedStudentIds: string[];
  onToggleStudent: (studentId: string) => void;
  studentSearch: string;
  onStudentSearchChange: (search: string) => void;
  publishMode: PracticePublishMode;
  onPublishModeChange: (mode: PracticePublishMode) => void;
  practiceHistory: PracticeHistoryRecord[];
  practiceSourceIds: string[];
  onPracticeSourceIdsChange: (ids: string[]) => void;
  practiceMaxQuestionsPerStudent: number;
  onPracticeMaxQuestionsChange: (count: number) => void;
  practiceHistoryLoading: boolean;
  submissionMode: PaperSubmissionMode;
  onSubmissionModeChange: (mode: PaperSubmissionMode) => void;
  maxScreenSwitches: number;
  onMaxScreenSwitchesChange: (value: number) => void;
  startAt: string;
  onStartAtChange: (value: string) => void;
  endAt: string;
  onEndAtChange: (value: string) => void;
  timeLimitMinutes: number;
  onTimeLimitMinutesChange: (value: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PublishOnlineDialog({
  open,
  busy,
  countsOk,
  recipientScope,
  onRecipientScopeChange,
  folders,
  folderId,
  onFolderIdChange,
  onConvertCategoryFolderToPaper,
  newFolderName,
  onNewFolderNameChange,
  onCreateAndSelectFolder,
  classes,
  selectedClassIds,
  onToggleClass,
  students,
  selectedStudentIds,
  onToggleStudent,
  studentSearch,
  onStudentSearchChange,
  publishMode,
  onPublishModeChange,
  practiceHistory,
  practiceSourceIds,
  onPracticeSourceIdsChange,
  practiceMaxQuestionsPerStudent,
  onPracticeMaxQuestionsChange,
  practiceHistoryLoading,
  submissionMode,
  onSubmissionModeChange,
  maxScreenSwitches,
  onMaxScreenSwitchesChange,
  startAt,
  onStartAtChange,
  endAt,
  onEndAtChange,
  timeLimitMinutes,
  onTimeLimitMinutesChange,
  onCancel,
  onConfirm,
}: PublishOnlineDialogProps) {
  const { t } = useTranslation(["compose", "common"]);

  if (!open) {
    return null;
  }

  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const confirmDisabled =
    busy ||
    selectedClassIds.length === 0 ||
    !folderId ||
    (recipientScope === "student" &&
      (selectedStudentIds.length === 0 || selectedFolder?.kind !== "paper")) ||
    (publishMode === "current" && !countsOk) ||
    (publishMode === "wrong_questions" &&
      (selectedClassIds.length !== 1 || practiceSourceIds.length !== 1)) ||
    (publishMode === "reinforcement" &&
      (selectedClassIds.length !== 1 || practiceSourceIds.length < 3));

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-online-dialog-title"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="publish-online-dialog-title" className="text-base font-semibold text-slate-900">
          发布线上答题试卷
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          将当前组卷保存为试卷，并发布给选中的班级。线上发布不依赖 PDF 编译。
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onRecipientScopeChange("class")}
            className={`rounded border px-3 py-1.5 text-sm ${
              recipientScope === "class" ? "bg-slate-900 text-white" : ""
            }`}
          >
            发布到班级
          </button>
          <button
            type="button"
            onClick={() => onRecipientScopeChange("student")}
            className={`rounded border px-3 py-1.5 text-sm ${
              recipientScope === "student" ? "bg-slate-900 text-white" : ""
            }`}
          >
            指定学生
          </button>
        </div>
        <ContentFolderHelp paper />
        <label className="mt-3 block text-sm">
          试卷归类（必选）
          <select
            aria-label="组卷发布文件夹"
            value={folderId}
            onChange={(event) => onFolderIdChange(event.target.value)}
            className="mt-1 w-full rounded border px-2 py-2"
          >
            <option value="">请选择文件夹</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name} · {folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}
              </option>
            ))}
          </select>
        </label>
        {recipientScope === "student" && folderId && selectedFolder?.kind === "category" ? (
          <button
            type="button"
            className="mt-2 rounded border border-violet-300 px-2 py-1 text-xs text-violet-700"
            onClick={() => onConvertCategoryFolderToPaper(folderId)}
          >
            将空文件夹转为试卷文件夹
          </button>
        ) : null}
        <div className="mt-2 flex gap-2">
          <input
            aria-label="组卷新建文件夹名称"
            value={newFolderName}
            onChange={(event) => onNewFolderNameChange(event.target.value)}
            placeholder="新文件夹名称"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!newFolderName.trim()}
            onClick={onCreateAndSelectFolder}
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
          >
            新建并选择
          </button>
        </div>
        <div className="mt-4 max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2">
          {classes.map((klass) => (
            <label
              key={klass.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type={recipientScope === "student" ? "radio" : "checkbox"}
                name={recipientScope === "student" ? "compose-personal-class" : undefined}
                checked={selectedClassIds.includes(klass.id)}
                onChange={() => onToggleClass(klass.id)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{klass.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ") || "未分组"}
                </span>
              </span>
            </label>
          ))}
          {classes.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              暂无可发布班级，请先在学校端给教师分配班级。
            </p>
          ) : null}
        </div>
        {recipientScope === "student" && selectedClassIds.length === 1 ? (
          <div className="mt-3 rounded border p-3">
            <input
              aria-label="组卷搜索指定学生"
              value={studentSearch}
              onChange={(event) => onStudentSearchChange(event.target.value)}
              placeholder="搜索姓名或学号"
              className="mb-2 w-full rounded border px-2 py-1.5 text-sm"
            />
            <div className="max-h-32 overflow-auto">
              {students
                .filter((student) =>
                  `${student.display_name} ${student.student_no}`
                    .toLowerCase()
                    .includes(studentSearch.toLowerCase()),
                )
                .map((student) => (
                  <label key={student.id} className="flex gap-2 p-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(student.id)}
                      onChange={() => onToggleStudent(student.id)}
                    />
                    {student.display_name} · {student.student_no}
                  </label>
                ))}
            </div>
          </div>
        ) : null}
        <AdaptivePracticeSelector
          mode={publishMode}
          history={practiceHistory}
          selectedIds={practiceSourceIds}
          maxQuestionsPerStudent={practiceMaxQuestionsPerStudent}
          loading={practiceHistoryLoading}
          disabled={selectedClassIds.length !== 1}
          onModeChange={onPublishModeChange}
          onSelectionChange={onPracticeSourceIdsChange}
          onMaxQuestionsChange={onPracticeMaxQuestionsChange}
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(
            [
              ["online", "网页答题"],
              ["image_manual", "图片人工批改"],
              ["image_ai", "图片 OCR+AI"],
            ] as const
          ).map(([mode, label]) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                submissionMode === mode
                  ? "border-emerald-700 bg-emerald-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <input
                type="radio"
                name="compose-publish-submission-mode"
                value={mode}
                checked={submissionMode === mode}
                onChange={() => onSubmissionModeChange(mode)}
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
            onChange={(event) =>
              onMaxScreenSwitchesChange(Math.max(0, Number(event.target.value || 0)))
            }
            className="mt-1 w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
          />
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700">
            开始时间
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => onStartAtChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            结束时间
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => onEndAtChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            做题时长
            <input
              type="number"
              min={0}
              max={1440}
              value={timeLimitMinutes}
              onChange={(event) =>
                onTimeLimitMinutesChange(Math.max(0, Number(event.target.value || 0)))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
            />
          </label>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            data-testid="compose-publish-online-confirm"
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {busy
              ? publishMode === "reinforcement"
                ? "AI 正在生成每位学生的专项题…"
                : "发布中..."
              : publishMode === "wrong_questions"
                ? "发布历史错题卷"
                : publishMode === "reinforcement"
                  ? "生成并发布专项巩固卷"
                  : "发布线上试卷"}
          </button>
        </div>
      </div>
    </div>
  );
}
