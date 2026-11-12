import { useMemo, useRef, type RefObject } from "react";
import { CheckCircle2, FolderPlus } from "lucide-react";
import type { ContentFolder, PlatformPaperRecord, PaperSubmissionMode, TeacherClassRecord, TeacherClassStudentRecord } from "../../../platform/auth";
import { G51EmptyState } from "../../../ui-redesign/g51/PaperUiComponents";
import { applySelectionDelta, isShiftSpace, rangeSelection } from "../../../lib/rangeSelection";
import { formatSubjectLabel } from "../../../lib/subjectLabels";
import { Select as AppSelect } from "../../../components/ui/select";
import { DeferredMount } from "../../../components/DeferredMount";

export type PaperClassPublishPanelProps = {
  scrollRootRef?: RefObject<HTMLElement | null>;
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
  scrollRootRef,
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
  const classSelectionAnchor = useRef<string | null>(null);
  const studentSelectionAnchor = useRef<string | null>(null);
  const selectableClassIds = useMemo(
    () => classes.filter((klass) => !alreadyPublishedClassIds.has(klass.id)).map((klass) => klass.id),
    [alreadyPublishedClassIds, classes],
  );
  const visibleStudents = useMemo(
    () => classStudents.filter((student) =>
      `${student.display_name} ${student.student_no}`.toLowerCase().includes(studentSearch.toLowerCase())
    ),
    [classStudents, studentSearch],
  );
  const changeRecipientScope = (scope: "class" | "student") => {
    classSelectionAnchor.current = null;
    studentSelectionAnchor.current = null;
    onRecipientScopeChange(scope);
  };
  const selectClassRange = (classId: string) => {
    const next = rangeSelection(selectedClassIds, selectableClassIds, classSelectionAnchor.current, classId);
    applySelectionDelta(selectedClassIds, next, onToggleClass);
    classSelectionAnchor.current = classId;
  };
  const selectStudentRange = (studentId: string) => {
    const visibleIds = visibleStudents.map((student) => student.id);
    const next = rangeSelection(selectedStudentIds, visibleIds, studentSelectionAnchor.current, studentId);
    applySelectionDelta(selectedStudentIds, next, onToggleStudent);
    studentSelectionAnchor.current = studentId;
  };

  return (
    <div className="space-y-5">
      {/* Scope Switcher */}
      <div className="flex w-full sm:w-auto gap-2">
        <button
          type="button"
          onClick={() => changeRecipientScope("class")}
          className={`flex-1 sm:flex-initial rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
            recipientScope === "class"
              ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] border-[var(--or-primary)] shadow-sm"
              : "bg-[var(--or-card)] text-[var(--or-muted)] border-[var(--or-outline)] hover:bg-[var(--or-page)]"
          }`}
        >
          发布到班级
        </button>
        <button
          type="button"
          onClick={() => changeRecipientScope("student")}
          className={`flex-1 sm:flex-initial rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
            recipientScope === "student"
              ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] border-[var(--or-primary)] shadow-sm"
              : "bg-[var(--or-card)] text-[var(--or-muted)] border-[var(--or-outline)] hover:bg-[var(--or-page)]"
          }`}
        >
          指定学生
        </button>
      </div>


      {/* Target Folder */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--or-text)]">
          试卷归类（必选） <span className="text-[var(--or-on-error)]">*</span>
        </label>
        <AppSelect
          aria-label="发布文件夹"
          value={publishFolderId}
          onValueChange={(value) => onFolderChange(value)}
          className="or-g51-select w-full"
        >
          <option value="">请选择文件夹</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name} · {folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}
            </option>
          ))}
        </AppSelect>
      </div>

      {recipientScope === "student" &&
      publishFolderId &&
      folders.find((folder) => folder.id === publishFolderId)?.kind === "category" ? (
        <button
          type="button"
          className="or-g51-btn or-g51-btn-tonal text-xs py-1.5 px-3"
          onClick={onConvertFolder}
        >
          将空文件夹转为试卷文件夹
        </button>
      ) : null}

      {/* Inline Create Folder */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          aria-label="新文件夹名称"
          value={newFolderName}
          onChange={(event) => onNewFolderNameChange(event.target.value)}
          className="or-g51-input min-w-0 flex-1"
          placeholder="新建文件夹名称"
        />
        <button
          type="button"
          disabled={!newFolderName.trim()}
          className="or-g51-btn or-g51-btn-outline shrink-0 text-xs py-2 sm:py-1.5 px-3 w-full sm:w-auto"
          onClick={onCreateFolder}
        >
          <FolderPlus className="h-4 w-4 mr-1 inline" />
          新建并选择
        </button>
      </div>

      {/* Subject */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--or-text)]">
          发布学科
        </label>
        <AppSelect
          data-testid="paper-publish-subject"
          value={selectedSubject || (teacherSubjects.length === 1 ? teacherSubjects[0] : "")}
          onValueChange={(value) => onSubjectChange(value)}
          className="or-g51-select w-full"
        >
          {teacherSubjects.length > 1 ? <option value="">请选择学科</option> : null}
          {teacherSubjects.map((subject) => (
            <option key={subject} value={subject}>
              {formatSubjectLabel(subject)}
            </option>
          ))}
          {teacherSubjects.length === 0 ? (
            <option value={selectedPaper.subject}>{formatSubjectLabel(selectedPaper.subject, "通用")}</option>
          ) : null}
        </AppSelect>
      </div>

      <DeferredMount
        scrollRootRef={scrollRootRef}
        rootMargin="160px 0px"
        fallback={(
          <div className="min-h-56 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]" role="status">
            滚动到班级选择区域后加载…
          </div>
        )}
      >
        <PaperClassPublishAudience
          classes={classes}
          alreadyPublishedClassIds={alreadyPublishedClassIds}
          selectedClassIds={selectedClassIds}
          recipientScope={recipientScope}
          onToggleClass={onToggleClass}
          selectClassRange={selectClassRange}
          classSelectionAnchor={classSelectionAnchor}
          selectedStudentIds={selectedStudentIds}
          studentSearch={studentSearch}
          visibleStudents={visibleStudents}
          onStudentSearchChange={onStudentSearchChange}
          onToggleStudent={onToggleStudent}
          selectStudentRange={selectStudentRange}
          studentSelectionAnchor={studentSelectionAnchor}
        />
      </DeferredMount>

      <DeferredMount
        scrollRootRef={scrollRootRef}
        rootMargin="160px 0px"
        fallback={(
          <div className="min-h-64 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]" role="status">
            滚动到提交设置后加载…
          </div>
        )}
      >
        <PaperClassPublishOptions
          selectedPaper={selectedPaper}
          recipientScope={recipientScope}
          selectedClassIds={selectedClassIds}
          submissionMode={submissionMode}
          maxScreenSwitches={maxScreenSwitches}
          publishStartAt={publishStartAt}
          publishEndAt={publishEndAt}
          timeLimitMinutes={timeLimitMinutes}
          canPublish={canPublish}
          onSubmissionModeChange={onSubmissionModeChange}
          onMaxScreenSwitchesChange={onMaxScreenSwitchesChange}
          onPublishStartAtChange={onPublishStartAtChange}
          onPublishEndAtChange={onPublishEndAtChange}
          onTimeLimitMinutesChange={onTimeLimitMinutesChange}
          onPublish={onPublish}
        />
      </DeferredMount>
    </div>
  );
}

type PaperClassPublishAudienceProps = {
  classes: TeacherClassRecord[];
  alreadyPublishedClassIds: Set<string>;
  selectedClassIds: string[];
  recipientScope: "class" | "student";
  onToggleClass: (classId: string) => void;
  selectClassRange: (classId: string) => void;
  classSelectionAnchor: { current: string | null };
  selectedStudentIds: string[];
  studentSearch: string;
  visibleStudents: TeacherClassStudentRecord[];
  onStudentSearchChange: (value: string) => void;
  onToggleStudent: (studentId: string) => void;
  selectStudentRange: (studentId: string) => void;
  studentSelectionAnchor: { current: string | null };
};

function PaperClassPublishAudience({
  classes,
  alreadyPublishedClassIds,
  selectedClassIds,
  recipientScope,
  onToggleClass,
  selectClassRange,
  classSelectionAnchor,
  selectedStudentIds,
  studentSearch,
  visibleStudents,
  onStudentSearchChange,
  onToggleStudent,
  selectStudentRange,
  studentSelectionAnchor,
}: PaperClassPublishAudienceProps) {
  return (
    <>
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--or-text)]">
          {recipientScope === "student" ? "选择基准班级" : "选择发布班级"}
        </label>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {classes.map((klass) => {
            const alreadyPublished = recipientScope === "class" && alreadyPublishedClassIds.has(klass.id);
            const isSelected = selectedClassIds.includes(klass.id);
            return (
              <label
                key={klass.id}
                className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                  alreadyPublished
                    ? "cursor-not-allowed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] text-[var(--or-muted)]"
                    : isSelected
                    ? "cursor-pointer border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_50%,transparent)] text-[var(--or-text)] ring-1 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)]"
                    : "cursor-pointer border-[var(--or-outline)] bg-[var(--or-card)] hover:border-[var(--or-outline)]"
                }`}
              >
                <input
                  data-testid={`paper-class-${klass.id}`}
                  type={recipientScope === "student" ? "radio" : "checkbox"}
                  name={recipientScope === "student" ? "personal-publish-class" : undefined}
                  disabled={alreadyPublished}
                  checked={isSelected}
                  onKeyDown={(event) => {
                    if (recipientScope === "class" && isShiftSpace(event)) {
                      event.preventDefault();
                      selectClassRange(klass.id);
                    }
                  }}
                  onChange={(event) => {
                    if (recipientScope === "class" && (event.nativeEvent as MouseEvent).shiftKey) {
                      selectClassRange(klass.id);
                    } else {
                      if (recipientScope === "class") classSelectionAnchor.current = klass.id;
                      onToggleClass(klass.id);
                    }
                  }}
                  className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--or-text)]">
                    {klass.name}
                  </span>
                  <span className="block truncate text-[13px] text-[var(--or-muted)] mt-0.5">
                    {alreadyPublished
                      ? "已发布到该班"
                      : [klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            );
          })}
          {classes.length === 0 ? (
            <div className="sm:col-span-2">
              <G51EmptyState message="暂无可发布班级" />
            </div>
          ) : null}
        </div>
      </div>

      {recipientScope === "student" && selectedClassIds.length === 1 ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--or-text)]">指定练习学生</span>
            <span className="text-xs text-[var(--or-muted)]">已选 {selectedStudentIds.length} 人</span>
          </div>
          <input
            aria-label="搜索指定学生"
            value={studentSearch}
            onChange={(event) => onStudentSearchChange(event.target.value)}
            placeholder="按姓名或学号搜索"
            className="or-g51-input w-full text-sm"
          />
          <div className="max-h-48 space-y-1.5 overflow-auto pr-1">
            {visibleStudents.map((student) => (
              <label
                key={student.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-2 text-sm text-[var(--or-text)] hover:bg-[var(--or-page)] transition cursor-pointer"
              >
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
                    } else {
                      studentSelectionAnchor.current = student.id;
                      onToggleStudent(student.id);
                    }
                  }}
                  className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                />
                {student.display_name} · {student.student_no}
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--or-muted)]">已选 {selectedStudentIds.length} 人；每人在所选试卷文件夹内最多收到一份。</p>
        </div>
      ) : null}
    </>
  );
}

type PaperClassPublishOptionsProps = {
  selectedPaper: PlatformPaperRecord;
  recipientScope: "class" | "student";
  selectedClassIds: string[];
  submissionMode: PaperSubmissionMode;
  maxScreenSwitches: number;
  publishStartAt: string;
  publishEndAt: string;
  timeLimitMinutes: number;
  canPublish: boolean;
  onSubmissionModeChange: (mode: PaperSubmissionMode) => void;
  onMaxScreenSwitchesChange: (value: number) => void;
  onPublishStartAtChange: (value: string) => void;
  onPublishEndAtChange: (value: string) => void;
  onTimeLimitMinutesChange: (value: number) => void;
  onPublish: () => void;
};

function PaperClassPublishOptions({
  selectedPaper,
  recipientScope,
  selectedClassIds,
  submissionMode,
  maxScreenSwitches,
  publishStartAt,
  publishEndAt,
  timeLimitMinutes,
  canPublish,
  onSubmissionModeChange,
  onMaxScreenSwitchesChange,
  onPublishStartAtChange,
  onPublishEndAtChange,
  onTimeLimitMinutesChange,
  onPublish,
}: PaperClassPublishOptionsProps) {
  return (
    <>
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--or-text)]">
          作答与提交模式
        </label>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {[
            ["online", "网页答题"],
            ["image_manual", "图片人工批改"],
            ["image_ai", "图片 OCR+AI"],
          ].map(([mode, label]) => {
            const isSelected = submissionMode === mode;
            return (
              <label
                key={mode}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 transition ${
                  isSelected
                    ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_50%,transparent)] text-[var(--or-text)] ring-1 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)]"
                    : "border-[var(--or-outline)] bg-[var(--or-card)] hover:border-[var(--or-outline)]"
                }`}
              >
                <input
                  data-testid={`paper-submission-${mode.replace("_", "-")}`}
                  type="radio"
                  name="paper-submission-mode"
                  value={mode}
                  checked={isSelected}
                  onChange={() => onSubmissionModeChange(mode as PaperSubmissionMode)}
                  className="h-4 w-4 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-[var(--or-text)]">
          允许切屏次数
        </label>
        <input
          type="number"
          min={0}
          max={999}
          value={maxScreenSwitches}
          onChange={(event) => onMaxScreenSwitchesChange(Math.max(0, Number(event.target.value || 0)))}
          className="or-g51-input w-full sm:w-36"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-[var(--or-text)]">开始时间</label>
          <input
            type="datetime-local"
            value={publishStartAt}
            onChange={(event) => onPublishStartAtChange(event.target.value)}
            className="or-g51-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-[var(--or-text)]">结束时间</label>
          <input
            type="datetime-local"
            value={publishEndAt}
            onChange={(event) => onPublishEndAtChange(event.target.value)}
            className="or-g51-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-[var(--or-text)]">做题时长（分钟）</label>
          <input
            data-testid="paper-time-limit"
            type="number"
            min={0}
            max={1440}
            value={timeLimitMinutes}
            onChange={(event) => onTimeLimitMinutesChange(Math.max(0, Number(event.target.value || 0)))}
            className="or-g51-input w-full"
          />
        </div>
      </div>

      {selectedPaper.question_count <= 0 ? (
        <p className="text-sm font-medium text-[var(--or-on-warning)] bg-[var(--or-warning-container)] border border-[var(--or-warning)] rounded-xl p-3">
          试卷至少需要包含 1 道题后才能发布。
        </p>
      ) : null}
      {selectedClassIds.length === 0 ? (
        <p className="text-sm font-medium text-[var(--or-muted)] bg-[var(--or-page)] border border-[var(--or-outline)] rounded-xl p-3">
          请选择至少一个未发布过的班级。
        </p>
      ) : null}

      <div className="pt-2">
        <button
          type="button"
          data-testid="paper-publish"
          disabled={!canPublish}
          onClick={onPublish}
          className="or-g51-btn or-g51-btn-primary w-full sm:w-auto text-base font-semibold py-2.5 px-6 rounded-xl"
        >
          <CheckCircle2 className="h-5 w-5 mr-1.5 inline" />
          {recipientScope === "student" ? "布置个人练习" : "发布到班级"}
        </button>
      </div>
    </>
  );
}
