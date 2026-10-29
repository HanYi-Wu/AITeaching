import { memo } from "react";
import type { StudentAnswerImage, StudentQuestionRecord } from "../../../platform/auth";
import { AlertTriangle, Clock, Save, Send } from "lucide-react";
import { PlatformShell } from "../PlatformShell";
import { QuestionAnswer } from "./StudentPanels";
import { formatCountdown, type StudentExamController } from "./useStudentExam";

const EMPTY_IMAGES: StudentAnswerImage[] = [];

const ExamQuestion = memo(function ExamQuestion({
  question, anchorId, value, imageMode, images, setAnswer, setQuestionImages, onFileDialogOpen, onFileDialogClose,
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
  return <QuestionAnswer
    question={question} anchorId={anchorId} value={value}
    onChange={(value) => setAnswer(question.question_id, value)}
    imageMode={imageMode} images={images}
    onImagesChange={(files) => void setQuestionImages(question.question_id, files)}
    onFileDialogOpen={onFileDialogOpen} onFileDialogClose={onFileDialogClose}
  />;
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
  const { activeAttempt, questions, answers, imageAnswers, remainingSeconds, saveStatus, answeredCount,
    submitReviewOpen, submitting, textConflicts, textDraftIssue, localTextRestored, imageDraftIssue,
    imageDraftStored, localImagesRestored, imageConflicts } = exam;
  if (!activeAttempt) return null;

  return (
    <PlatformShell
      roleLabel="学生端"
      title={activeAttempt.title}
      subtitle={`${activeAttempt.subject || "未分科"} · ${questions.length} 题`}
      userName={userName}
      compactMobile
      hideLogout
    >
      <section className="mx-auto w-full max-w-4xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">{activeAttempt.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{activeAttempt.subject || "未分科"} · {questions.length} 题</p>
            <p className="mt-2 text-sm font-medium text-slate-700">已作答 {answeredCount} / {questions.length}</p>
            <p className="mt-1 text-xs text-slate-500" role="status">
              {saveStatus === "restored" ? "草稿已恢复" : saveStatus === "dirty" ? "有未保存修改" : saveStatus === "saving" ? "正在保存草稿…" : saveStatus === "error" ? "草稿保存失败，请重试" : "草稿已保存"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
              <Clock className="h-4 w-4" />{formatCountdown(remainingSeconds)}
            </div>
            <div className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4" />已记录切屏、复制粘贴、右键与退出全屏；选择答题图片不会计为切屏
            </div>
          </div>
        </div>
        {localTextRestored ? <p className="mb-3 text-sm text-amber-800" role="status">已恢复本机文本草稿，等待保存到服务器。</p> : null}
        {localImagesRestored ? <p className="mb-3 text-sm text-amber-800" role="status">已恢复本机图片草稿，等待保存到服务器。</p> : null}
        {Object.keys(textConflicts).length ? <div className="mb-3 text-sm text-amber-800" role="status">
          服务器答案已有其他更新，本机文本草稿仍保留。
          <button type="button" onClick={exam.recoverConflictingText} className="ml-2 underline">恢复本机文本草稿</button>
        </div> : null}
        {textDraftIssue === "unavailable" ? <p className="mb-3 text-sm text-amber-800" role="status">本机文本存储不可用；草稿暂留在当前标签页内存，刷新或关闭可能丢失，请先保存到服务器。</p> : null}
        {textDraftIssue === "too_large" ? <p className="mb-3 text-sm text-amber-800" role="status">本机文本草稿超过暂存限额，请先保存到服务器。</p> : null}
        {textDraftIssue === "corrupt" ? <p className="mb-3 text-sm text-amber-800" role="status">本机文本草稿损坏，未自动恢复；请检查答案并保存到服务器。</p> : null}
        {Object.keys(imageConflicts).length ? <div className="mb-3 text-sm text-amber-800" role="status">
          服务器图片答案已有其他更新，本机图片草稿仍保留。
          <button type="button" onClick={exam.recoverConflictingImages} className="ml-2 underline">恢复本机图片草稿</button>
        </div> : null}
        {imageDraftIssue === "unavailable" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片存储暂不可用；图片按账号暂留在当前标签页内存，刷新或关闭可能丢失，请先保存到服务器。</p> : null}
        {imageDraftIssue === "too_large" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片草稿超过 20 MB 限额，未能暂存；请及时保存到服务器。</p> : null}
        {imageDraftIssue === "corrupt" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片草稿损坏，未自动恢复；请检查图片后保存到服务器。</p> : null}
        {imageDraftStored && !imageDraftIssue ? <p className="mb-3 text-sm text-slate-600" role="status">图片已暂存在本机，尚未确认保存到服务器。</p> : null}
        <nav className="mb-4 flex flex-wrap gap-2" aria-label="答题导航">
          {questions.map((question, index) => (
            <a key={question.question_id} href={`#student-question-${index + 1}`}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold ${(Boolean((answers[question.question_id] ?? "").trim()) || (imageAnswers[question.question_id]?.length ?? 0) > 0) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600"}`}>
              {index + 1}
            </a>
          ))}
        </nav>
        <div className="space-y-4">
          {questions.map((question, index) => (
            <ExamQuestion
              key={question.question_id}
              anchorId={`student-question-${index + 1}`}
              question={question}
              value={answers[question.question_id] ?? ""}
              setAnswer={exam.setAnswer}
              imageMode={activeAttempt.submission_mode === "image_manual" || activeAttempt.submission_mode === "image_ai"}
              images={imageAnswers[question.question_id] ?? EMPTY_IMAGES}
              setQuestionImages={exam.setQuestionImages}
              onFileDialogOpen={exam.onFileDialogOpen}
              onFileDialogClose={exam.onFileDialogClose}
            />
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" data-testid="student-save-draft" disabled={saveStatus === "saving" || submitting}
            onClick={() => void exam.saveActiveDraft()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:w-auto">
            <Save className="h-4 w-4" />保存草稿
          </button>
          <button type="button" data-testid="student-submit-attempt" disabled={submitting}
            onClick={() => exam.setSubmitReviewOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto">
            <Send className="h-4 w-4" />提交试卷
          </button>
        </div>
        {message ? <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</div> : null}
      </section>
      {submitReviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="提交前确认">
          <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">提交前确认</h2>
            <p className="mt-1 text-sm text-slate-600">提交后不能撤回，请核对答题进度。</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-emerald-50 p-4"><p className="text-xs text-emerald-700">答题进度</p><p className="mt-1 text-lg font-semibold text-emerald-900">已答 {answeredCount} 题</p></div>
              <div className={`rounded-lg p-4 ${questions.length - answeredCount > 0 ? "bg-rose-50" : "bg-slate-50"}`}>
                <p className={`text-xs ${questions.length - answeredCount > 0 ? "text-rose-700" : "text-slate-600"}`}>需要检查</p>
                <p className={`mt-1 text-lg font-semibold ${questions.length - answeredCount > 0 ? "text-rose-900" : "text-slate-900"}`}>未答 {Math.max(0, questions.length - answeredCount)} 题</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 rounded-lg border border-slate-200 p-4 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">草稿状态</dt><dd className="text-right font-medium text-slate-800">{saveStatus === "dirty" ? "有未保存修改，将随提交一并保存" : saveStatus === "saving" ? "草稿正在保存，提交时会携带最新答案" : saveStatus === "error" ? "草稿保存失败，但提交时会携带当前答案" : saveStatus === "restored" ? "草稿已恢复，可安全提交" : "草稿已保存，可安全提交"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">剩余时间</dt><dd className="font-medium text-slate-800">{formatCountdown(remainingSeconds)}</dd></div>
            </dl>
            {questions.length - answeredCount > 0 ? <p className="mt-4 text-sm font-medium text-rose-700">还有未答题，建议返回检查后再提交。</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => exam.setSubmitReviewOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">继续检查</button>
              <button type="button" disabled={submitting} onClick={() => { exam.setSubmitReviewOpen(false); void exam.submitActiveAttempt(); }} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">确认提交</button>
            </div>
          </section>
        </div>
      ) : null}
    </PlatformShell>
  );
}
