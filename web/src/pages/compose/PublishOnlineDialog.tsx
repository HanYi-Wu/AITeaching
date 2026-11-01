import { useMemo, useRef } from "react";
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
import { applySelectionDelta, isShiftSpace, rangeSelection } from "../../lib/rangeSelection";
import { Select as AppSelect } from "../../components/ui/select";

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
  teacherSubjects: string[];
  selectedSubject: string;
  onSubjectChange: (subject: string) => void;
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
  teacherSubjects,
  selectedSubject,
  onSubjectChange,
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
  const classSelectionAnchor = useRef<string | null>(null);
  const studentSelectionAnchor = useRef<string | null>(null);
  const visibleClassIds = useMemo(() => classes.map((klass) => klass.id), [classes]);
  const visibleStudents = useMemo(
    () => students.filter((student) =>
      `${student.display_name} ${student.student_no}`.toLowerCase().includes(studentSearch.toLowerCase())
    ),
    [studentSearch, students],
  );
  const changeRecipientScope = (scope: "class" | "student") => {
    classSelectionAnchor.current = null;
    studentSelectionAnchor.current = null;
    onRecipientScopeChange(scope);
  };
  const selectClassRange = (classId: string) => {
    const next = rangeSelection(selectedClassIds, visibleClassIds, classSelectionAnchor.current, classId);
    applySelectionDelta(selectedClassIds, next, onToggleClass);
    classSelectionAnchor.current = classId;
  };
  const selectStudentRange = (studentId: string) => {
    const visibleIds = visibleStudents.map((student) => student.id);
    const next = rangeSelection(selectedStudentIds, visibleIds, studentSelectionAnchor.current, studentId);
    applySelectionDelta(selectedStudentIds, next, onToggleStudent);
    studentSelectionAnchor.current = studentId;
  };

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
    (publishMode === "current" && teacherSubjects.length > 1 && !selectedSubject) ||
    (publishMode === "wrong_questions" &&
      (selectedClassIds.length !== 1 || practiceSourceIds.length !== 1)) ||
    (publishMode === "reinforcement" &&
      (selectedClassIds.length !== 1 || practiceSourceIds.length < 3));

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-online-dialog-title"
    >
      <div className="or-g49-dialog-surface max-h-[92vh] w-full max-w-3xl overflow-auto p-4 sm:p-6">
        <h2 id="publish-online-dialog-title" className="text-xl font-bold text-[var(--or-text)]">
          发布线上答题试卷
        </h2>
        <p className="mt-1.5 text-sm text-[var(--or-muted)]">
          将当前组卷保存为试卷，并发布给选中的班级。线上发布不依赖 PDF 编译。
        </p>
        {!countsOk ? (
          <p role="status" className="mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] px-3.5 py-3 text-sm leading-relaxed text-[var(--or-on-warning)]">
            <span className="font-semibold">当前试卷尚未具备发布条件。</span>
            <span>请补齐模板题量后再发布当前试卷；历史错题卷和专项巩固卷仍可选择。</span>
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => changeRecipientScope("class")}
            className={`or-g49-btn ${
              recipientScope === "class"
                ? "or-g49-btn-primary"
                : "or-g49-btn-secondary"
            }`}
          >
            发布到班级
          </button>
          <button
            type="button"
            onClick={() => changeRecipientScope("student")}
            className={`or-g49-btn ${
              recipientScope === "student"
                ? "or-g49-btn-primary"
                : "or-g49-btn-secondary"
            }`}
          >
            指定学生
          </button>
        </div>

        <div className="mt-3">
          <ContentFolderHelp paper />
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-[var(--or-muted)]">
            试卷归类（必选）
            <AppSelect
              aria-label="组卷发布文件夹"
              value={folderId}
              onValueChange={(value) => onFolderIdChange(value)}
              className="or-g49-input mt-1.5 w-full block"
            >
              <option value="">请选择文件夹</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} · {folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}
                </option>
              ))}
            </AppSelect>
          </label>

          {recipientScope === "student" && folderId && selectedFolder?.kind === "category" ? (
            <button
              type="button"
              className="or-g49-btn border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 py-1 text-xs"
              onClick={() => onConvertCategoryFolderToPaper(folderId)}
            >
              将空文件夹转为试卷文件夹
            </button>
          ) : null}

          <div className="flex gap-2">
            <input
              aria-label="组卷新建文件夹名称"
              value={newFolderName}
              onChange={(event) => onNewFolderNameChange(event.target.value)}
              placeholder="新文件夹名称"
              className="or-g49-input min-w-0 flex-1"
            />
            <button
              type="button"
              disabled={!newFolderName.trim()}
              onClick={onCreateAndSelectFolder}
              className="or-g49-btn or-g49-btn-secondary text-xs disabled:opacity-50"
            >
              新建并选择
            </button>
          </div>
        </div>

        {publishMode === "current" && teacherSubjects.length > 1 ? (
          <label className="mt-4 block text-sm font-medium text-[var(--or-muted)]">
            发布学科
            <AppSelect
              aria-label="发布学科"
              data-testid="compose-publish-subject"
              value={selectedSubject}
              onValueChange={(value) => onSubjectChange(value)}
              className="or-g49-input mt-1.5 w-full block"
            >
              <option value="">请选择学科</option>
              {teacherSubjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </AppSelect>
          </label>
        ) : null}

        <div className="mt-5 space-y-2">
          <span className="text-sm font-semibold text-[var(--or-text)]">目标班级</span>
          <div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-2.5">
            {classes.map((klass) => (
              <label
                key={klass.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--or-page)] border border-transparent hover:border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)]"
              >
                <input
                  type={recipientScope === "student" ? "radio" : "checkbox"}
                  name={recipientScope === "student" ? "compose-personal-class" : undefined}
                  checked={selectedClassIds.includes(klass.id)}
                  onKeyDown={(event) => {
                    if (recipientScope === "class" && isShiftSpace(event)) {
                      event.preventDefault();
                      selectClassRange(klass.id);
                    }
                  }}
                  onChange={(event) => {
                    if (recipientScope === "class" && (event.nativeEvent as MouseEvent).shiftKey) {
                      selectClassRange(klass.id);
                      return;
                    }
                    if (recipientScope === "class") {
                      classSelectionAnchor.current = klass.id;
                    }
                    onToggleClass(klass.id);
                  }}
                  className="h-4 w-4 shrink-0 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[var(--or-text)]">{klass.name}</span>
                  <span className="block truncate text-xs text-[var(--or-muted)]">
                    {[klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ") || "未分组"}
                  </span>
                </span>
              </label>
            ))}
            {classes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--or-outline)] p-4 text-center text-sm text-[var(--or-muted)]">
                暂无可发布班级，请先在学校端给教师分配班级。
              </p>
            ) : null}
          </div>
        </div>

        {recipientScope === "student" && selectedClassIds.length === 1 ? (
          <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-3.5">
            <input
              aria-label="组卷搜索指定学生"
              value={studentSearch}
              onChange={(event) => onStudentSearchChange(event.target.value)}
              placeholder="搜索姓名或学号"
              className="or-g49-input mb-2.5 w-full"
            />
            <div className="max-h-36 overflow-auto space-y-1">
              {visibleStudents.map((student) => (
                  <label key={student.id} className="flex items-center gap-2.5 p-1.5 text-sm rounded-lg hover:bg-[var(--or-card)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(student.id)}
                      onKeyDown={(event) => {
                        if (isShiftSpace(event)) {
                          event.preventDefault();
                          selectStudentRange(student.id);
                        }
                      }}
                      onChange={(event) => {
                        if ((event.nativeEvent as MouseEvent).shiftKey) {
                          selectStudentRange(student.id);
                          return;
                        }
                        studentSelectionAnchor.current = student.id;
                        onToggleStudent(student.id);
                      }}
                      className="h-4 w-4 shrink-0 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                    />
                    <span className="font-medium text-[var(--or-text)]">{student.display_name}</span>
                    <span className="text-xs text-[var(--or-muted)]">· {student.student_no}</span>
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
          disabled={selectedClassIds.length > 1}
          currentDisabled={!countsOk}
          onModeChange={onPublishModeChange}
          onSelectionChange={onPracticeSourceIdsChange}
          onMaxQuestionsChange={onPracticeMaxQuestionsChange}
        />

        <div className="mt-5 space-y-2">
          <span className="text-sm font-semibold text-[var(--or-text)]">作答与提交方式</span>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {(
              [
                ["online", "网页答题"],
                ["image_manual", "图片人工批改"],
                ["image_ai", "图片 OCR+AI"],
              ] as const
            ).map(([mode, label]) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition-all duration-150 ${
                  submissionMode === mode
                    ? "border-emerald-600 bg-[color-mix(in_srgb,var(--or-success-container)_80%,transparent)] text-[var(--or-on-success)] ring-1 ring-emerald-600/30"
                    : "border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] text-[var(--or-text)] hover:border-[var(--or-outline)]"
                }`}
              >
                <input
                  type="radio"
                  name="compose-publish-submission-mode"
                  value={mode}
                  checked={submissionMode === mode}
                  onChange={() => onSubmissionModeChange(mode)}
                  className="h-4 w-4 text-[var(--or-on-success)] focus:ring-emerald-500"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium text-[var(--or-muted)]">
            允许切屏次数
            <input
              type="number"
              min={0}
              max={999}
              value={maxScreenSwitches}
              onChange={(event) =>
                onMaxScreenSwitchesChange(Math.max(0, Number(event.target.value || 0)))
              }
              className="or-g49-input mt-1.5 w-full tabular-nums"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--or-muted)]">
            开始时间
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => onStartAtChange(event.target.value)}
              className="or-g49-input mt-1.5 w-full"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--or-muted)]">
            结束时间
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => onEndAtChange(event.target.value)}
              className="or-g49-input mt-1.5 w-full"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--or-muted)]">
            做题时长 (分钟)
            <input
              type="number"
              min={0}
              max={1440}
              value={timeLimitMinutes}
              onChange={(event) =>
                onTimeLimitMinutesChange(Math.max(0, Number(event.target.value || 0)))
              }
              className="or-g49-input mt-1.5 w-full tabular-nums"
            />
          </label>
        </div>

        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="or-g49-btn or-g49-btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            data-testid="compose-publish-online-confirm"
            className="or-g49-btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
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
