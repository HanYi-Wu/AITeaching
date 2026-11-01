import { memo } from "react";
import type { StudentAnswerImage, StudentQuestionRecord } from "../../../platform/auth";
import { Save, Send } from "lucide-react";
import { formatSubjectLabel } from "../../../lib/subjectLabels";
import { PlatformShell } from "../PlatformShell";
import { QuestionAnswer } from "./StudentPanels";
import { type StudentExamController } from "./useStudentExam";
import { StudentExamHeader } from "../../../ui-redesign/g54/StudentExamHeader";
import { StudentQuestionNav } from "../../../ui-redesign/g54/StudentQuestionNav";
import { StudentSubmitDialog } from "../../../ui-redesign/g54/StudentSubmitDialog";
import "../../../ui-redesign/g54/g54.css";

const EMPTY_IMAGES: StudentAnswerImage[] = [];

const ExamQuestion = memo(function ExamQuestion({
  question,
  anchorId,
  value,
  imageMode,
  images,
  setAnswer,
  setQuestionImages,
  onFileDialogOpen,
  onFileDialogClose,
}: {
  question: StudentQuestionRecord;
  anchorId: string;
  value: string;
  imageMode: boolean;
  images: StudentAnswerImage[];
  setAnswer: (questionId: string, value: string) => void;
  setQuestionImages: (questionId: string, files: FileList | null) => Promise<void>;
  onFileDialogOpen: () => void;
  onFileDialogClose: () => void;
}) {
  return (
    <QuestionAnswer
      question={question}
      anchorId={anchorId}
      value={value}
      onChange={(value) => setAnswer(question.question_id, value)}
      imageMode={imageMode}
      images={images}
      onImagesChange={(files) => void setQuestionImages(question.question_id, files)}
      onFileDialogOpen={onFileDialogOpen}
      onFileDialogClose={onFileDialogClose}
    />
  );
});

export function StudentExamPanel({
  controller,
  userName,
  message,
}: {
  controller: StudentExamController;
  userName: string;
  message: string | null;
}) {
  const exam = controller;
  const {
    activeAttempt,
    questions,
    answers,
    imageAnswers,
    remainingSeconds,
    saveStatus,
    answeredCount,
    submitReviewOpen,
    submitting,
    textConflicts,
    textDraftIssue,
    localTextRestored,
    imageDraftIssue,
    imageDraftStored,
    localImagesRestored,
    imageConflicts,
  } = exam;

  if (!activeAttempt) return null;

  return (
    <PlatformShell
      roleLabel="学生端"
      title={activeAttempt.title}
      subtitle={`${formatSubjectLabel(activeAttempt.subject, "未分科")} · ${questions.length} 题`}
      userName={userName}
      compactMobile
      hideLogout
    >
      <section className="mx-auto w-full max-w-4xl rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm sm:p-7">
        <StudentExamHeader
          title={activeAttempt.title}
          subject={formatSubjectLabel(activeAttempt.subject)}
          questionCount={questions.length}
          answeredCount={answeredCount}
          remainingSeconds={remainingSeconds}
          saveStatus={saveStatus}
          localTextRestored={localTextRestored}
          localImagesRestored={localImagesRestored}
          hasTextConflicts={Object.keys(textConflicts).length > 0}
          onRecoverTextConflicts={exam.recoverConflictingText}
          textDraftIssue={textDraftIssue}
          hasImageConflicts={Object.keys(imageConflicts).length > 0}
          onRecoverImageConflicts={exam.recoverConflictingImages}
          imageDraftIssue={imageDraftIssue}
          imageDraftStored={imageDraftStored}
        />

        <StudentQuestionNav
          questions={questions}
          answers={answers}
          imageAnswers={imageAnswers}
        />

        <div className="space-y-5">
          {questions.map((question, index) => (
            <ExamQuestion
              key={question.question_id}
              anchorId={`student-question-${index + 1}`}
              question={question}
              value={answers[question.question_id] ?? ""}
              setAnswer={exam.setAnswer}
              imageMode={
                activeAttempt.submission_mode === "image_manual" ||
                activeAttempt.submission_mode === "image_ai"
              }
              images={imageAnswers[question.question_id] ?? EMPTY_IMAGES}
              setQuestionImages={exam.setQuestionImages}
              onFileDialogOpen={exam.onFileDialogOpen}
              onFileDialogClose={exam.onFileDialogClose}
            />
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end border-t border-[var(--or-outline)] pt-5">
          <button
            type="button"
            data-testid="student-save-draft"
            disabled={saveStatus === "saving" || submitting}
            onClick={() => void exam.saveActiveDraft()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-5 py-2.5 text-sm font-semibold text-[var(--or-text)] hover:bg-[var(--or-page)] disabled:opacity-60 transition-colors sm:w-auto"
          >
            <Save className="h-4 w-4" />
            保存草稿
          </button>
          <button
            type="button"
            data-testid="student-submit-attempt"
            disabled={submitting}
            onClick={() => exam.setSubmitReviewOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--or-primary)] px-6 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] disabled:opacity-60 transition-colors sm:w-auto"
          >
            <Send className="h-4 w-4" />
            提交试卷
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-3 text-sm text-[var(--or-muted)]">
            {message}
          </div>
        ) : null}
      </section>

      <StudentSubmitDialog
        open={submitReviewOpen}
        onClose={() => exam.setSubmitReviewOpen(false)}
        onConfirm={() => void exam.submitActiveAttempt()}
        submitting={submitting}
        answeredCount={answeredCount}
        questionCount={questions.length}
        remainingSeconds={remainingSeconds}
        saveStatus={saveStatus}
      />
    </PlatformShell>
  );
}
