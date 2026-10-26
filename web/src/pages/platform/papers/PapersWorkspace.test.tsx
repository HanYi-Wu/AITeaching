import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PapersWorkspace } from "./PapersWorkspace";
import { buildGradingDraftStorageKey } from "./gradingDraftStorage";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getAccountProfile: vi.fn(),
  listPlatformPaperPublications: vi.fn(),
  listPlatformPapers: vi.fn(),
  listTeacherAssignedClasses: vi.fn(),
  listTeacherClassStudents: vi.fn(),
  listContentFolders: vi.fn(),
  listTaggedItems: vi.fn(),
  updatePlatformPaperDeliveryMode: vi.fn(),
  publishPlatformPaper: vi.fn(),
  revokePlatformPaperPublication: vi.fn(),
  updatePlatformPaperPublication: vi.fn(),
  uploadPaperScores: vi.fn(),
  analyzePlatformPaper: vi.fn(),
  downloadPaperAnalysisReport: vi.fn(),
  listPaperSubmissions: vi.fn(),
  suggestAiGradesForAttempt: vi.fn(),
  gradePaperAnswer: vi.fn(),
}));

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return { ...actual, apiGet: mocks.apiGet };
});

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    getAccountProfile: mocks.getAccountProfile,
    listPlatformPaperPublications: mocks.listPlatformPaperPublications,
    listPlatformPapers: mocks.listPlatformPapers,
    listTeacherAssignedClasses: mocks.listTeacherAssignedClasses,
    listTeacherClassStudents: mocks.listTeacherClassStudents,
    listContentFolders: mocks.listContentFolders,
    listTaggedItems: mocks.listTaggedItems,
    updatePlatformPaperDeliveryMode: mocks.updatePlatformPaperDeliveryMode,
    publishPlatformPaper: mocks.publishPlatformPaper,
    revokePlatformPaperPublication: mocks.revokePlatformPaperPublication,
    updatePlatformPaperPublication: mocks.updatePlatformPaperPublication,
    uploadPaperScores: mocks.uploadPaperScores,
    analyzePlatformPaper: mocks.analyzePlatformPaper,
    downloadPaperAnalysisReport: mocks.downloadPaperAnalysisReport,
    listPaperSubmissions: mocks.listPaperSubmissions,
    suggestAiGradesForAttempt: mocks.suggestAiGradesForAttempt,
    gradePaperAnswer: mocks.gradePaperAnswer,
  };
});

const offlinePaper = {
  paper_id: "p1",
  exam_id: "midterm/Math",
  title: "Midterm",
  subject: "Math",
  delivery_mode: "offline" as const,
  status: "draft",
  question_count: 2,
  section_count: 1,
  score_batch_count: 0,
  has_score: false,
  has_pdf: false,
  has_docx: false,
  latest_batch_id: null,
  publication_count: 0,
  published_class_count: 0,
  mtime: "2026-07-04T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("PapersWorkspace", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.apiGet.mockResolvedValue({ bound: true, root: "C:/project", project_id: "project-1" });
    mocks.getAccountProfile.mockResolvedValue({ profile: { id: "teacher-1", subjects: [] } });
    Object.defineProperty(URL, "createObjectURL", { writable: true, value: vi.fn(() => "blob:report") });
    Object.defineProperty(URL, "revokeObjectURL", { writable: true, value: vi.fn() });
    mocks.listTeacherAssignedClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: "Math", subject: "Math" }],
    });
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "f1", owner_teacher_id: "t1", scope: "paper", parent_id: null, kind: "category", name: "默认文件夹" }] });
    mocks.listTaggedItems.mockResolvedValue({ items: {} });
    mocks.listTeacherClassStudents.mockResolvedValue({ students: [{ id: "s1", student_no: "S001", display_name: "张三", status: "active" }] });
    mocks.listPlatformPaperPublications.mockResolvedValue({ publications: [] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [] });
    mocks.downloadPaperAnalysisReport.mockResolvedValue(new Blob(["report"]));
  });

  it("lists exported papers and updates online/offline delivery mode", async () => {
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [{ ...offlinePaper, submitted_student_count: 2, published_student_count: 1 }],
    });
    mocks.updatePlatformPaperDeliveryMode.mockResolvedValue({
      paper: { ...offlinePaper, delivery_mode: "online", status: "draft", question_count: 0, section_count: 0 },
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("线下").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 份已提交").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 份批改并发布").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "设为线上" }));

    await waitFor(() => expect(mocks.updatePlatformPaperDeliveryMode).toHaveBeenCalledWith("p1", "online"));
    expect((await screen.findAllByText("线上")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 份已提交").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByLabelText(/Class 1/));
    await userEvent.selectOptions(screen.getByLabelText("发布文件夹"), "f1");
    expect(screen.getByTestId("paper-publish")).toBeEnabled();
  });

  it("publishes an online paper to selected classes", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.publishPlatformPaper.mockResolvedValue({
      publication: {
        id: "pub1",
        paper_id: "p1",
        status: "published",
        title: "Midterm",
        class_ids: ["c1"],
        attempt_count: 0,
      },
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByLabelText(/Class 1/));
    await userEvent.selectOptions(screen.getByLabelText("发布文件夹"), "f1");
    await userEvent.click(screen.getByTestId("paper-publish"));

    await waitFor(() =>
      expect(mocks.publishPlatformPaper).toHaveBeenCalledWith("p1", {
        class_ids: ["c1"],
        student_ids: [],
        folder_id: "f1",
        title: "Midterm",
        start_at: null,
        end_at: null,
        submission_mode: "online",
        max_screen_switches: 0,
        subject: "Math",
        time_limit_minutes: null,
      }),
    );
    expect((await screen.findAllByText("已发布")).length).toBeGreaterThan(0);
  });

  it("keeps the student preselected when opening practice from student insights", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    render(<PapersWorkspace assignStudent={{ classId: "c1", studentId: "s1", name: "张三" }} />);
    expect(await screen.findByText("张三 · S001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "指定学生" })).toHaveClass("bg-slate-900");
    expect(screen.getByRole("checkbox", { name: /张三/ })).toBeChecked();
  });

  it("shows and revokes publication history", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online", status: "published" }] });
    mocks.listPlatformPaperPublications.mockResolvedValue({
      publications: [
        {
          id: "pub1",
          paper_id: "p1",
          status: "published",
          title: "Managed Publication",
          class_ids: ["c1"],
          class_names: ["Class 1"],
          attempt_count: 3,
          submitted_count: 1,
          proctor_event_count: 2,
          max_screen_switches: 1,
          time_limit_minutes: 60,
        },
      ],
    });
    mocks.updatePlatformPaperPublication.mockResolvedValue({
      publication: {
        id: "pub1",
        paper_id: "p1",
        status: "paused",
        title: "Managed Publication",
        class_ids: ["c1"],
      },
    });
    mocks.revokePlatformPaperPublication.mockResolvedValue({
      publication: {
        id: "pub1",
        paper_id: "p1",
        status: "revoked",
        title: "Managed Publication",
        class_ids: ["c1"],
      },
    });

    render(<PapersWorkspace />);

    expect(await screen.findByText("Managed Publication")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("限时 60 分钟")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "暂停收取提交" }));
    await waitFor(() =>
      expect(mocks.updatePlatformPaperPublication).toHaveBeenCalledWith("p1", "pub1", { status: "paused" }),
    );
    expect(screen.getByRole("button", { name: "撤回发布" })).toHaveTextContent('取消发布');
    expect(screen.getByRole("button", { name: "撤回发布" }).closest('table')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "撤回发布" }));

    await waitFor(() => expect(mocks.revokePlatformPaperPublication).toHaveBeenCalledWith("p1", "pub1"));
  });

  it("loads paper analysis with screen-switch risk", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.analyzePlatformPaper.mockResolvedValue({
      analysis: {
        paper: {
          paper_id: "p1",
          exam_id: "midterm/Math",
          title: "Midterm",
          subject: "Math",
          delivery_mode: "online",
          status: "published",
        },
        summary: {
          total_students: 2,
          completed_students: 1,
          in_progress_students: 1,
          not_started_students: 0,
          completion_rate: 50,
          average_score: 80,
          average_time_seconds: 1200,
          publication_count: 1,
        },
        proctoring: {
          event_count: 5,
          event_type_counts: { visibility_hidden: 2, copy: 1, paste: 1, fullscreen_exit: 1 },
          screen_switch_count: 2,
          screen_switch_duration_ms: 3000,
          flagged_student_count: 1,
          exceeded_student_count: 1,
        },
        classes: [
          {
            class_id: "c1",
            class_name: "Class 1",
            student_count: 2,
            completed_count: 1,
            in_progress_count: 1,
            not_started_count: 0,
            completion_rate: 50,
            average_score: 80,
            average_time_seconds: 1200,
            screen_switch_count: 2,
          },
        ],
        questions: [
          {
            question_id: "math/q1",
            header: "Q1",
            section_id: "Choice",
            type: "single_choice",
            content: "Question 1",
            score_per_item: 5,
            answered_count: 1,
            scored_count: 1,
            correct_count: 1,
            wrong_count: 0,
            average_score_percent: 100,
            accuracy_rate: 100,
            risk_level: "low",
          },
        ],
        students: [
          {
            student_id: "s1",
            student_no: "S001",
            display_name: "Student One",
            account_username: "stu_s001",
            status: "completed",
            score: 80,
            max_score: 100,
            score_percent: 80,
            time_spent_seconds: 1200,
            screen_switch_count: 2,
            screen_switch_limit: 1,
            screen_switch_exceeded: true,
            screen_switch_duration_ms: 3000,
            integrity_event_count: 5,
            integrity_event_type_counts: { visibility_hidden: 2, copy: 1, paste: 1, fullscreen_exit: 1 },
            integrity_risk_score: 75,
            class_names: ["Class 1"],
          },
        ],
      },
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("paper-load-analysis"));

    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("p1", undefined, undefined));
    expect(await screen.findByRole("dialog", { name: "试卷分析" })).toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-charts")).toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-chart-score")).toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-classes")).toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-questions")).toBeInTheDocument();
    expect(screen.getByText("学生个人分析表")).toBeInTheDocument();
    expect(screen.getByText("Student One")).toBeInTheDocument();
    expect(screen.getByText("2/1")).toBeInTheDocument();
    expect(screen.getByText("75 · 高风险")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("paper-export-report-xlsx"));
    await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith("p1", "xlsx", undefined, undefined));
    await userEvent.click(screen.getByTestId("paper-export-report-pdf"));
    await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith("p1", "pdf", undefined, undefined));
  });

  it("disables publishing until a paper has questions and sends image submission mode", async () => {
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [{ ...offlinePaper, paper_id: "empty", question_count: 0, delivery_mode: "online" as const }],
    });

    const { rerender } = render(<PapersWorkspace />);

    expect(await screen.findByText("Midterm")).toBeInTheDocument();
    expect(screen.getByTestId("paper-publish")).toBeDisabled();

    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    rerender(<PapersWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByTestId("paper-publish")).toBeDisabled());
    await userEvent.click(screen.getByLabelText(/Class 1/));
    await userEvent.selectOptions(screen.getByLabelText("发布文件夹"), "f1");
    expect(screen.getByTestId("paper-publish")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("paper-submission-image-ai"));
    await userEvent.clear(screen.getByTestId("paper-time-limit"));
    await userEvent.type(screen.getByTestId("paper-time-limit"), "45");
    await userEvent.click(screen.getByTestId("paper-publish"));

    await waitFor(() =>
      expect(mocks.publishPlatformPaper).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ submission_mode: "image_ai", max_screen_switches: 0, time_limit_minutes: 45 }),
      ),
    );
  });

  it("prevents selecting classes that already have an active publication", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online", status: "published" }] });
    mocks.listPlatformPaperPublications.mockResolvedValue({
      publications: [
        {
          id: "pub1",
          paper_id: "p1",
          status: "published",
          title: "Managed Publication",
          class_ids: ["c1"],
          class_names: ["Class 1"],
          attempt_count: 0,
          submitted_count: 0,
          proctor_event_count: 0,
        },
      ],
    });

    render(<PapersWorkspace />);

    const checkbox = await screen.findByTestId("paper-class-c1");
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("已发布到该班")).toBeInTheDocument();
  });

  it("lets a teacher review image submissions on a separate grading page", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({
      submissions: [
        {
          attempt_id: "a1",
          publication_id: "pub1",
          student_name: "Student One",
          student_no: "S001",
          status: "submitted",
          submitted_at: "2026-08-23T08:30:00Z",
          score: null,
          max_score: 10,
          answers: [
            {
              question_id: "math/q1",
              header: "1.1",
              score_per_item: 5,
              score: null,
              grading_status: "pending",
              feedback: null,
              ai_suggested_score: null,
              ai_feedback: null,
              images: [{ name: "answer.png", mime_type: "image/png", data_url: "data:image/png;base64,ZmFrZQ==" }],
            },
          ],
        },
      ],
    });
    mocks.gradePaperAnswer.mockResolvedValue({
      answer: { question_id: "math/q1", score: 4, feedback: "Reviewed", grading_status: "reviewed" },
    });
    mocks.suggestAiGradesForAttempt.mockResolvedValue({
      suggestions: [
        {
          question_id: "math/q1",
          suggested_score: 4.5,
          feedback: "步骤完整，计算结果正确。",
          confidence: 0.92,
        },
      ],
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(screen.getAllByText(/已提交/).length).toBeGreaterThan(0);
    expect(screen.getByText(/待批改/)).toBeInTheDocument();
    expect(screen.queryByText("submitted")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("paper-ai-grade-a1"));
    await waitFor(() =>
      expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledWith("p1", "a1", ["math/q1"]),
    );
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("4.5");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("步骤完整，计算结果正确。");
    expect(screen.getByTestId("paper-answer-image-math/q1")).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId("paper-grade-math/q1"));
    await userEvent.type(screen.getByTestId("paper-grade-math/q1"), "4");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() =>
      expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
        score: 4,
        feedback: "步骤完整，计算结果正确。",
        is_correct: null,
      }),
    );
  });

  it("restores an isolated local grading draft and saves against its source version", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 2, grading_status: "reviewed", feedback: "服务器评语", grading_version: "revision-1", images: [] }],
    };
    const saved = {
      ...submission,
      answers: [{ ...submission.answers[0], score: 4.5, grading_version: "revision-2" }],
    };
    const key = buildGradingDraftStorageKey({
      accountId: "teacher-1",
      projectId: "project-1",
      paperId: "p1",
      attemptId: "a1",
      questionId: "math/q1",
    });
    localStorage.setItem(key, JSON.stringify({ version: 1, sourceVersion: "revision-1", score: "4.5" }));
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValueOnce({ submissions: [submission] }).mockResolvedValueOnce({ submissions: [saved] });
    mocks.gradePaperAnswer.mockResolvedValue({ answer: { ...saved.answers[0], feedback: "服务器评语" } });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    expect(score).toHaveValue("4.5");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));

    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
      score: 4.5,
      feedback: "服务器评语",
      is_correct: null,
    }, "revision-1"));
    await screen.findByText("已保存批改结果");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("asks before saving a local draft based on an older grading version", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 2, grading_status: "reviewed", feedback: "服务器评语", grading_version: "revision-2", images: [] }],
    };
    const saved = { ...submission, answers: [{ ...submission.answers[0], score: 4.5, grading_version: "revision-3" }] };
    const key = buildGradingDraftStorageKey({ accountId: "teacher-1", projectId: "project-1", paperId: "p1", attemptId: "a1", questionId: "math/q1" });
    localStorage.setItem(key, JSON.stringify({ version: 1, sourceVersion: "revision-1", score: "4.5" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValueOnce({ submissions: [submission] }).mockResolvedValueOnce({ submissions: [saved] });
    mocks.gradePaperAnswer.mockResolvedValue({ answer: { ...saved.answers[0], feedback: "服务器评语" } });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await screen.findByText("服务器批改版本已变化，本地草稿基于较早内容；保存前会请你确认。");
    const save = screen.getByTestId("paper-save-grade-math/q1");
    await userEvent.click(save);
    expect(mocks.gradePaperAnswer).not.toHaveBeenCalled();
    await userEvent.click(save);

    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
      score: 4.5,
      feedback: "服务器评语",
      is_correct: null,
    }, "revision-2"));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("anchors a clean restored draft to the current server version", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 3,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 3, grading_status: "reviewed", feedback: "服务器评语", grading_version: "revision-2", images: [] }],
    };
    const saved = { ...submission, answers: [{ ...submission.answers[0], score: 4, grading_version: "revision-3" }] };
    const key = buildGradingDraftStorageKey({ accountId: "teacher-1", projectId: "project-1", paperId: "p1", attemptId: "a1", questionId: "math/q1" });
    localStorage.setItem(key, JSON.stringify({ version: 1, sourceVersion: "revision-1", score: "3" }));
    const confirm = vi.spyOn(window, "confirm");
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValueOnce({ submissions: [submission] }).mockResolvedValueOnce({ submissions: [saved] });
    mocks.gradePaperAnswer.mockResolvedValue({ answer: { ...saved.answers[0], feedback: "服务器评语" } });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    await userEvent.clear(score);
    await userEvent.type(score, "4");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));

    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
      score: 4,
      feedback: "服务器评语",
      is_correct: null,
    }, "revision-2"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uses the completed version when a same-question save is queued", async () => {
    const firstSave = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_version: string; grading_status: string } }>();
    const secondSave = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_version: string; grading_status: string } }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 1,
      max_score: 5,
      answers: [
        { question_id: "math/q1", score: 1, grading_status: "reviewed", feedback: "服务器评语", grading_version: "revision-1", images: [] },
        { question_id: "math/q2", score: 1, grading_status: "reviewed", feedback: "第二题评语", grading_version: "revision-1", images: [] },
      ],
    };
    let calls = 0;
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.gradePaperAnswer.mockImplementation((_paperId: string, _attemptId: string, questionId: string) => {
      if (questionId === "math/q2") return Promise.resolve({ answer: { question_id: "math/q2", score: 1, feedback: "第二题评语", grading_version: "revision-1", grading_status: "reviewed" } });
      return ++calls === 1 ? firstSave.promise : secondSave.promise;
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    await userEvent.clear(score);
    await userEvent.type(score, "2");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(calls).toBe(1));

    await userEvent.click(screen.getByTestId("paper-save-grade-math/q2"));
    await screen.findByText("已保存批改结果");

    await userEvent.clear(score);
    await userEvent.type(score, "3");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    expect(calls).toBe(1);

    await act(async () => {
      firstSave.resolve({ answer: { question_id: "math/q1", score: 2, feedback: "服务器评语", grading_version: "revision-2", grading_status: "reviewed" } });
      await firstSave.promise;
    });
    await waitFor(() => expect(calls).toBe(2));
    expect(mocks.gradePaperAnswer).toHaveBeenLastCalledWith("p1", "a1", "math/q1", {
      score: 3,
      feedback: "服务器评语",
      is_correct: null,
    }, "revision-2");

    await act(async () => {
      secondSave.resolve({ answer: { question_id: "math/q1", score: 3, feedback: "服务器评语", grading_version: "revision-3", grading_status: "reviewed" } });
      await secondSave.promise;
    });
  });

  it("keeps server grading available when local draft storage is blocked", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 2, grading_status: "reviewed", feedback: "服务器评语", images: [] }],
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.gradePaperAnswer.mockResolvedValue({ answer: { question_id: "math/q1", score: 4, feedback: "服务器评语", grading_status: "reviewed" } });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    await userEvent.clear(score);
    await userEvent.type(score, "4");
    await screen.findByText("本地批改草稿暂不可用；仍可使用保存按钮将批改结果提交到服务器。");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));

    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
      score: 4,
      feedback: "服务器评语",
      is_correct: null,
    }));
  });

  it("keeps score and feedback edited after a save request while its refresh is pending", async () => {
    const savedResponse = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_status: string } }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 2, grading_status: "reviewed", feedback: "初始评语", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.gradePaperAnswer.mockReturnValueOnce(savedResponse.promise);

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    const feedback = screen.getByTestId("paper-feedback-math/q1");
    await userEvent.clear(score);
    await userEvent.type(score, "3");
    await userEvent.clear(feedback);
    await userEvent.type(feedback, "发出保存时的评语");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledOnce());

    await userEvent.clear(score);
    await userEvent.type(score, "4");
    await userEvent.clear(feedback);
    await userEvent.type(feedback, "保存之后继续写的评语");

    await act(async () => {
      savedResponse.resolve({ answer: { question_id: "math/q1", score: 3, feedback: "发出保存时的评语", grading_status: "reviewed" } });
      await savedResponse.promise;
    });
    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledTimes(2));

    expect(score).toHaveValue("4");
    expect(feedback).toHaveValue("保存之后继续写的评语");
    expect(await screen.findByText("已保存发出时的分数和评语；当前有更新的分数和评语未保存。")).toBeInTheDocument();
  });

  it("keeps a partial unsaved notice when only one field changes during a save", async () => {
    const savedResponse = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_status: string } }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 2, grading_status: "reviewed", feedback: "已保存评语", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.gradePaperAnswer.mockReturnValueOnce(savedResponse.promise);

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const score = await screen.findByTestId("paper-grade-math/q1");
    await userEvent.clear(score);
    await userEvent.type(score, "3");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledOnce());

    await userEvent.clear(score);
    await userEvent.type(score, "4");
    await act(async () => {
      savedResponse.resolve({ answer: { question_id: "math/q1", score: 3, feedback: "已保存评语", grading_status: "reviewed" } });
      await savedResponse.promise;
    });

    expect(score).toHaveValue("4");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("已保存评语");
    expect(await screen.findByText("已保存发出时的评语；当前有更新的分数未保存。")).toBeInTheDocument();
  });

  it("serializes same-question saves and leaves the newest value in storage", async () => {
    const firstSave = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_status: string } }>();
    const secondSave = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_status: string } }>();
    const initial = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 2,
      max_score: 10,
      answers: [
        { question_id: "math/q1", score: 1, grading_status: "reviewed", feedback: "第一题旧评语", images: [] },
        { question_id: "math/q2", score: 1, grading_status: "reviewed", feedback: "第二题旧评语", images: [] },
      ],
    };
    const latest = {
      ...initial,
      score: 4,
      answers: [
        { ...initial.answers[0], score: 3, feedback: "较新保存的评语" },
        initial.answers[1],
      ],
    };
    let firstQuestionSaveCount = 0;
    let persistedFirstQuestionScore = 1;
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [initial] });
    mocks.gradePaperAnswer.mockImplementation((_paperId: string, _attemptId: string, questionId: string) => {
      if (questionId === "math/q1") {
        firstQuestionSaveCount += 1;
        const response = firstQuestionSaveCount === 1 ? firstSave.promise : secondSave.promise;
        return response.then((result) => {
          persistedFirstQuestionScore = result.answer.score;
          return result;
        });
      }
      return Promise.resolve({ answer: { question_id: "math/q2", score: 1, feedback: "第二题旧评语", grading_status: "reviewed" } });
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const firstScore = await screen.findByTestId("paper-grade-math/q1");
    await userEvent.clear(firstScore);
    await userEvent.type(firstScore, "2");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(firstQuestionSaveCount).toBe(1));

    await userEvent.click(screen.getByTestId("paper-save-grade-math/q2"));
    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q2", expect.any(Object)));
    await screen.findByText("已保存批改结果");

    await userEvent.clear(firstScore);
    await userEvent.type(firstScore, "3");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    expect(firstQuestionSaveCount).toBe(1);

    await act(async () => {
      firstSave.resolve({ answer: { question_id: "math/q1", score: 2, feedback: "较旧保存的评语", grading_status: "reviewed" } });
      await firstSave.promise;
    });
    await waitFor(() => expect(firstQuestionSaveCount).toBe(2));
    expect(persistedFirstQuestionScore).toBe(2);
    expect(mocks.gradePaperAnswer).toHaveBeenLastCalledWith("p1", "a1", "math/q1", {
      score: 3,
      feedback: "第一题旧评语",
      is_correct: null,
    });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [latest] });

    await act(async () => {
      secondSave.resolve({ answer: { question_id: "math/q1", score: 3, feedback: "较新保存的评语", grading_status: "reviewed" } });
      await secondSave.promise;
    });
    await screen.findByText("已保存批改结果");

    expect(persistedFirstQuestionScore).toBe(3);
    expect(firstScore).toHaveValue("3");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("较新保存的评语");
    expect(screen.getByText("已保存批改结果")).toBeInTheDocument();
  });

  it("ignores a grading response from the previous paper after switching papers", async () => {
    const oldPaperSave = deferred<{ answer: { question_id: string; score: number; feedback: string; grading_status: string } }>();
    const firstPaper = { ...offlinePaper, paper_id: "p1", title: "Midterm", delivery_mode: "online" as const };
    const secondPaper = { ...offlinePaper, paper_id: "p2", title: "Final", delivery_mode: "online" as const };
    const firstSubmission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 1,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: 1, grading_status: "reviewed", feedback: "第一份评语", images: [] }],
    };
    const secondSubmission = {
      ...firstSubmission,
      attempt_id: "a2",
      student_name: "Student Two",
      student_no: "S002",
      score: 4,
      answers: [{ question_id: "math/q1", score: 4, grading_status: "reviewed", feedback: "第二份评语", images: [] }],
    };
    mocks.listPlatformPapers.mockImplementation((params: { q?: string }) =>
      Promise.resolve({ papers: params.q === "Final" ? [secondPaper] : [firstPaper] }),
    );
    mocks.listPaperSubmissions.mockImplementation((paperId: string) =>
      Promise.resolve({ submissions: paperId === "p2" ? [secondSubmission] : [firstSubmission] }),
    );
    mocks.gradePaperAnswer.mockReturnValueOnce(oldPaperSave.promise);
    const { rerender } = render(<PapersWorkspace />);

    await waitFor(() => expect(screen.getAllByText("Midterm").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    await screen.findByText("Student One");
    const firstScore = screen.getByTestId("paper-grade-math/q1");
    await userEvent.clear(firstScore);
    await userEvent.type(firstScore, "2");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledOnce());

    rerender(<PapersWorkspace openTarget={{ paperId: "p2", attemptId: "a2", title: "Final" }} />);
    await screen.findByText("Student Two");
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("4");

    await act(async () => {
      oldPaperSave.resolve({ answer: { question_id: "math/q1", score: 2, feedback: "旧试卷迟到的评语", grading_status: "reviewed" } });
      await oldPaperSave.promise;
    });

    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("4");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("第二份评语");
    expect(screen.queryByText("已保存批改结果")).not.toBeInTheDocument();
  });

  it.each(["single", "batch"] as const)("keeps the new paper draft after an old %s suggestion returns", async (kind) => {
    const response = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const firstPaper = { ...offlinePaper, delivery_mode: "online" as const };
    const secondPaper = { ...firstPaper, paper_id: "p2", title: "Final" };
    const firstSubmission = {
      attempt_id: "a1", publication_id: "pub1", student_name: "Student One", student_no: "S001",
      status: "submitted", submitted_at: "2026-08-23T08:30:00Z", score: null, max_score: 5,
      answers: [{ question_id: "math/q1", score: null, feedback: null, grading_status: "pending", images: [] }],
    };
    const secondSubmission = { ...firstSubmission, attempt_id: "a2", student_name: "Student Two" };
    mocks.listPlatformPapers.mockImplementation((params: { q?: string }) =>
      Promise.resolve({ papers: params.q === "Final" ? [secondPaper] : [firstPaper] }),
    );
    mocks.listPaperSubmissions.mockImplementation((paperId: string) =>
      Promise.resolve({ submissions: paperId === "p2" ? [secondSubmission] : [firstSubmission] }),
    );
    mocks.suggestAiGradesForAttempt.mockReturnValueOnce(response.promise);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerender } = render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await screen.findByText("Student One");
    await userEvent.click(screen.getByTestId(kind === "single" ? "paper-ai-grade-a1" : "paper-ai-grade-batch"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());
    rerender(<PapersWorkspace openTarget={{ paperId: "p2", attemptId: "a2", title: "Final" }} />);
    await screen.findByText("Student Two");
    await userEvent.type(screen.getByTestId("paper-grade-math/q1"), "3");
    await userEvent.type(screen.getByTestId("paper-feedback-math/q1"), "New paper draft");
    await act(async () => {
      response.resolve({ suggestions: [{ question_id: "math/q1", suggested_score: 1, feedback: "Old paper response", status: "needs_review" }] });
      await response.promise;
    });
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("3");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("New paper draft");
  });

  it("does not let a late single AI response replace a saved final score or comment", async () => {
    const aiResponse = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, grading_status: "pending", feedback: null, ai_suggested_score: null, ai_feedback: null, images: [] }],
    };
    const savedSubmission = {
      ...submission,
      answers: [{ ...submission.answers[0], score: 3.5, grading_status: "reviewed", feedback: "教师最终评语" }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.suggestAiGradesForAttempt.mockReturnValueOnce(aiResponse.promise);
    mocks.gradePaperAnswer.mockResolvedValue({
      answer: { question_id: "math/q1", score: 3.5, feedback: "教师最终评语", grading_status: "reviewed" },
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await userEvent.click(screen.getByTestId("paper-ai-grade-a1"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());

    const score = screen.getByTestId("paper-grade-math/q1");
    const feedback = screen.getByTestId("paper-feedback-math/q1");
    await userEvent.clear(score);
    await userEvent.type(score, "3.5");
    await userEvent.clear(feedback);
    await userEvent.type(feedback, "教师最终评语");
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [savedSubmission] });
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() => expect(mocks.gradePaperAnswer).toHaveBeenCalledOnce());
    await screen.findByText("已保存批改结果");

    await act(async () => {
      aiResponse.resolve({
        suggestions: [{ question_id: "math/q1", suggested_score: 1, feedback: "迟到的 AI 评语", status: "needs_review" }],
      });
      await aiResponse.promise;
    });

    expect(score).toHaveValue("3.5");
    expect(feedback).toHaveValue("教师最终评语");
    expect(await screen.findByText("AI 预批改结果已过期，当前分数和评语未被覆盖；请重新发起预批改。")).toBeInTheDocument();
    expect(screen.queryByText(/已生成 1 条 AI 预批改建议/)).not.toBeInTheDocument();
  });

  it("counts only the fields still eligible when a single AI response arrives", async () => {
    const aiResponse = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, grading_status: "pending", feedback: null, ai_suggested_score: null, ai_feedback: null, images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.suggestAiGradesForAttempt.mockReturnValueOnce(aiResponse.promise);

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await userEvent.click(screen.getByTestId("paper-ai-grade-a1"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());
    const score = screen.getByTestId("paper-grade-math/q1");
    const feedback = screen.getByTestId("paper-feedback-math/q1");
    await userEvent.type(score, "4");

    await act(async () => {
      aiResponse.resolve({
        suggestions: [{ question_id: "math/q1", suggested_score: 2, feedback: "可接受的 AI 评语", status: "needs_review" }],
      });
      await aiResponse.promise;
    });

    expect(score).toHaveValue("4");
    expect(feedback).toHaveValue("可接受的 AI 评语");
    expect(await screen.findByText("已生成 1 条 AI 预批改建议；忽略了 1 个过期字段；0 题仍待处理，请教师复核后保存。")).toBeInTheDocument();
  });

  it("filters stale results from the batch AI path while keeping unaffected answers", async () => {
    const firstAi = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const secondAi = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const submissions = ["a1", "a2"].map((attemptId, index) => ({
      attempt_id: attemptId,
      publication_id: "pub1",
      student_name: `Student ${index + 1}`,
      student_no: `S00${index + 1}`,
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{
        question_id: "math/q1",
        score: null,
        grading_status: "pending",
        feedback: null,
        ai_suggested_score: null,
        ai_feedback: null,
        images: [],
      }],
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions });
    mocks.suggestAiGradesForAttempt.mockImplementation((_paperId: string, attemptId: string) =>
      attemptId === "a1" ? firstAi.promise : secondAi.promise,
    );

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await userEvent.click(screen.getByTestId("paper-ai-grade-batch"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledWith("p1", "a1", ["math/q1"]));

    const firstScore = screen.getByTestId("paper-grade-math/q1");
    const firstFeedback = screen.getByTestId("paper-feedback-math/q1");
    await userEvent.clear(firstScore);
    await userEvent.type(firstScore, "4");
    await userEvent.clear(firstFeedback);
    await userEvent.type(firstFeedback, "教师在批量请求后修改");
    await act(async () => {
      firstAi.resolve({ suggestions: [{ question_id: "math/q1", suggested_score: 2, feedback: "AI 学生一", status: "needs_review" }] });
      await firstAi.promise;
    });
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledWith("p1", "a2", ["math/q1"]));

    await act(async () => {
      secondAi.resolve({ suggestions: [{ question_id: "math/q1", suggested_score: 3, feedback: "AI 学生二", status: "needs_review" }] });
      await secondAi.promise;
    });

    expect(firstScore).toHaveValue("4");
    expect(firstFeedback).toHaveValue("教师在批量请求后修改");
    expect(await screen.findByText("AI 批量预批改完成：生成 1 条建议，0 题可重试，忽略 2 个过期字段。请教师逐题复核。")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("paper-grading-student-select"), "a2");
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("3");
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("AI 学生二");
    confirm.mockRestore();
  });

  it("reports an expired batch result when every returned field is stale", async () => {
    const aiResponse = deferred<{ suggestions: Array<{ question_id: string; suggested_score: number; feedback: string; status: string }> }>();
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, grading_status: "pending", feedback: null, ai_suggested_score: null, ai_feedback: null, images: [] }],
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.suggestAiGradesForAttempt.mockReturnValueOnce(aiResponse.promise);

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await userEvent.click(screen.getByTestId("paper-ai-grade-batch"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());
    const score = screen.getByTestId("paper-grade-math/q1");
    const feedback = screen.getByTestId("paper-feedback-math/q1");
    await userEvent.type(score, "4");
    await userEvent.type(feedback, "教师最终评语");

    await act(async () => {
      aiResponse.resolve({ suggestions: [{ question_id: "math/q1", suggested_score: 2, feedback: "迟到的 AI 评语", status: "needs_review" }] });
      await aiResponse.promise;
    });

    expect(score).toHaveValue("4");
    expect(feedback).toHaveValue("教师最终评语");
    expect(await screen.findByText("AI 批量预批改结果已过期，当前批改内容未被覆盖。")).toBeInTheDocument();
    expect(screen.queryByText(/生成 1 条建议/)).not.toBeInTheDocument();
  });

  it("explains why an unsubmitted answer cannot have grading results published", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [{ attempt_id: "draft-a1", publication_id: "pub1", student_name: "未交卷学生", student_no: "S002", status: "in_progress", submitted_at: null, score: null, max_score: 10, answers: [] }] });
    render(<PapersWorkspace />);
    await screen.findAllByText("Midterm");
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    expect(await screen.findByText("学生尚未提交答卷，提交后才能完成批改并发布成绩。")).toBeInTheDocument();
    expect(screen.getByTestId("paper-complete-grading-draft-a1")).toBeDisabled();
  });

  it("turns the empty paper page into a teacher getting-started entry", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [] });
    const onOpenBank = vi.fn();
    const onOpenTemplates = vi.fn();
    const onOpenCompose = vi.fn();

    render(
      <PapersWorkspace
        onOpenBank={onOpenBank}
        onOpenTemplates={onOpenTemplates}
        onOpenCompose={onOpenCompose}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "去创建题目" }));
    await userEvent.click(screen.getByRole("button", { name: "去创建模板" }));
    await userEvent.click(screen.getByRole("button", { name: "开始组卷" }));
    expect(onOpenBank).toHaveBeenCalledOnce();
    expect(onOpenTemplates).toHaveBeenCalledOnce();
    expect(onOpenCompose).toHaveBeenCalledOnce();
  });

  it("saves the displayed existing score instead of silently replacing it with zero", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({
      submissions: [
        {
          attempt_id: "a1",
          publication_id: "pub1",
          student_name: "Student One",
          student_no: "S001",
          status: "submitted",
          score: 4,
          max_score: 5,
          answers: [
            {
              question_id: "math/q1",
              header: "1.1",
              content: "题目内容",
              answer: "学生真实作答",
              score_per_item: 5,
              score: 4,
              grading_status: "reviewed",
              feedback: null,
              images: [],
            },
          ],
        },
      ],
    });
    mocks.gradePaperAnswer.mockResolvedValue({
      answer: { question_id: "math/q1", score: 4, grading_status: "reviewed" },
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("4");
    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));

    await waitFor(() =>
      expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
        score: 4,
        feedback: null,
        is_correct: null,
      }),
    );
  });

  it("keeps edited grading comments dirty through submission refresh and saves a zero score", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: 0,
      max_score: 5,
      answers: [
        {
          question_id: "math/q1",
          header: "1.1",
          score_per_item: 5,
          score: 0,
          grading_status: "reviewed",
          feedback: "服务器原评语",
          ai_suggested_score: null,
          ai_feedback: null,
          images: [],
        },
      ],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });
    mocks.listPaperSubmissions.mockResolvedValueOnce({ submissions: [submission] });
    mocks.listPaperSubmissions.mockResolvedValueOnce({ submissions: [submission] });
    mocks.gradePaperAnswer.mockResolvedValue({
      answer: { question_id: "math/q1", score: 0, feedback: "教师调整后的评语", grading_status: "reviewed" },
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const feedbackInput = await screen.findByTestId("paper-feedback-math/q1");
    await userEvent.clear(feedbackInput);
    await userEvent.type(feedbackInput, "教师调整后的评语");

    await userEvent.click(screen.getByTestId("paper-load-submissions"));
    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledTimes(2));
    expect(feedbackInput).toHaveValue("教师调整后的评语");
    expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("0");

    await userEvent.click(screen.getByTestId("paper-save-grade-math/q1"));
    await waitFor(() =>
      expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "math/q1", {
        score: 0,
        feedback: "教师调整后的评语",
        is_correct: null,
      }),
    );
  });

  it("shows one selected student's real answer at a time", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({
      submissions: [
        {
          attempt_id: "a1",
          publication_id: "pub1",
          student_name: "Student One",
          student_no: "S001",
          status: "submitted",
          score: 4,
          max_score: 5,
          answers: [
            {
              question_id: "math/q1",
              header: "1.1",
              content: "第一题",
              answer: "学生真实作答一",
              score_per_item: 5,
              score: 4,
              grading_status: "reviewed",
              images: [],
            },
          ],
        },
        {
          attempt_id: "a2",
          publication_id: "pub1",
          student_name: "Student Two",
          student_no: "S002",
          status: "submitted",
          score: null,
          max_score: 5,
          answers: [
            {
              question_id: "math/q1",
              header: "1.1",
              content: "第一题",
              answer: "学生真实作答二",
              score_per_item: 5,
              score: null,
              grading_status: "pending",
              images: [],
            },
          ],
        },
      ],
    });

    render(<PapersWorkspace />);
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    const selector = await screen.findByTestId("paper-grading-student-select");
    expect(selector).toHaveValue("a1");
    expect(screen.getByText("学生真实作答一")).toBeInTheDocument();
    expect(screen.queryByText("学生真实作答二")).not.toBeInTheDocument();

    await userEvent.selectOptions(selector, "a2");
    expect(await screen.findByText("学生真实作答二")).toBeInTheDocument();
    expect(screen.queryByText("学生真实作答一")).not.toBeInTheDocument();
  });
});
