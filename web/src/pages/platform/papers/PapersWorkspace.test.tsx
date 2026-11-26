import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PapersWorkspace } from "./PapersWorkspace";
import { PaperPublishingSidebar } from "./PaperPublishingSidebar";
import { buildGradingDraftStorageKey } from "./gradingDraftStorage";
import { selectOption } from "../../../test/selectOption";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiDownloadBlob: vi.fn(),
  getAccountProfile: vi.fn(),
  listPlatformPaperPublications: vi.fn(),
  listPlatformPapers: vi.fn(),
  listTeacherAssignedClasses: vi.fn(),
  listTeacherClassStudents: vi.fn(),
  listContentFolders: vi.fn(),
  listTaggedItems: vi.fn(),
  moveContentItemsToFolder: vi.fn(),
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
  return { ...actual, apiGet: mocks.apiGet, apiDownloadBlob: mocks.apiDownloadBlob };
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
    moveContentItemsToFolder: mocks.moveContentItemsToFolder,
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
    mocks.apiDownloadBlob.mockResolvedValue({ blob: new Blob(["template"]), filename: "template.csv" });
    mocks.getAccountProfile.mockResolvedValue({ profile: { id: "teacher-1", subjects: [] } });
    Object.defineProperty(URL, "createObjectURL", { writable: true, value: vi.fn(() => "blob:report") });
    Object.defineProperty(URL, "revokeObjectURL", { writable: true, value: vi.fn() });
    mocks.listTeacherAssignedClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: "Math", subject: "Math" }],
    });
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "f1", owner_teacher_id: "t1", scope: "paper", parent_id: null, kind: "category", name: "默认文件夹" }] });
    mocks.moveContentItemsToFolder.mockResolvedValue({ ok: true, moved_count: 1 });
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
    await userEvent.click(await screen.findByLabelText(/Class 1/));
    await selectOption(await screen.findByRole("combobox", { name: "发布文件夹" }), "f1");
    expect(screen.getByTestId("paper-publish")).toBeEnabled();
  });

  it("does not mount hidden mobile paper details until the detail segment is opened", async () => {
    const originalMatchMedia = window.matchMedia;
    const mobileMedia = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => mobileMedia),
    });
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, question_count: 0 }] });

    try {
      const { rerender } = render(<PapersWorkspace />);
      expect(await screen.findByTestId("paper-list-item-p1")).toBeInTheDocument();
      expect(screen.queryByTestId("paper-publish")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "试卷内容" }));
      expect(await screen.findByTestId("paper-publish")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /返回试卷列表/ }));
      expect(screen.getByTestId("paper-publish")).toBeInTheDocument();
      expect(screen.getByTestId("paper-publish").closest("main")).toHaveClass("hidden");

      rerender(<PapersWorkspace projectScope={{ ready: true, value: "other-project" }} />);
      expect(screen.queryByTestId("paper-publish")).not.toBeInTheDocument();
    } finally {
      if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: originalMatchMedia,
        });
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
    }
  });

  it("keeps the full workspace layout visible while the account profile is pending", async () => {
    const profileRequest = deferred<{ profile: { id: string; subjects: string[] } }>();
    mocks.getAccountProfile.mockReturnValue(profileRequest.promise);
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, question_count: 0 }] });

    render(<PapersWorkspace />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载当前账号数据");
    expect(await screen.findByTitle("新建文件夹")).toBeInTheDocument();
    expect(await screen.findByLabelText("全选当前可移动试卷")).toBeInTheDocument();
    expect(screen.queryByTestId("paper-list-item-p1")).not.toBeInTheDocument();
    expect(mocks.listPlatformPapers).not.toHaveBeenCalled();

    await act(async () => {
      profileRequest.resolve({ profile: { id: "teacher-1", subjects: [] } });
      await profileRequest.promise;
    });

    expect(await screen.findByTestId("paper-list-item-p1")).toBeInTheDocument();
    expect(await screen.findByTestId("paper-publish")).toBeInTheDocument();
    expect(screen.queryByText("正在加载发布面板…")).not.toBeInTheDocument();
  });

  it("selects and drags a group of movable papers, then clears selection after a successful batch move", async () => {
    const papers = [
      { ...offlinePaper, paper_id: "p1", title: "Paper One" },
      { ...offlinePaper, paper_id: "p2", title: "Paper Two", exam_id: "quiz/Science" },
    ];
    mocks.listPlatformPapers.mockResolvedValue({ papers, total: papers.length, page: 1, page_size: 10, total_pages: 1 });
    mocks.moveContentItemsToFolder.mockResolvedValue({ ok: true, moved_count: 2 });
    render(<PapersWorkspace />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "选择试卷 Paper One" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "选择试卷 Paper Two" }));
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId("paper-list-item-p1"), { dataTransfer: { setData } as unknown as DataTransfer });
    expect(setData).toHaveBeenCalledWith("application/x-or-content-items", JSON.stringify({ scope: "paper", ids: ["p1", "p2"] }));
    expect(setData).toHaveBeenCalledWith("application/x-or-content-item", JSON.stringify({ scope: "paper", id: "p1" }));

    await selectOption(await screen.findByRole("combobox", { name: "批量移动到文件夹" }), "f1");
    await userEvent.click(screen.getByRole("button", { name: "移动所选" }));
    await waitFor(() => expect(mocks.moveContentItemsToFolder).toHaveBeenCalledWith("paper", ["p1", "p2"], "f1"));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择试卷 Paper One" })).not.toBeChecked());
  });

  it("keeps paper selections after a rejected batch and prevents selecting published papers", async () => {
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [
        { ...offlinePaper, paper_id: "p1", title: "Movable Paper" },
        { ...offlinePaper, paper_id: "p2", title: "Published Paper", publication_count: 1 },
        { ...offlinePaper, paper_id: "p3", title: "Revoked History Paper", has_publication_history: true },
      ],
      total: 3, page: 1, page_size: 10, total_pages: 1,
    });
    mocks.moveContentItemsToFolder.mockRejectedValue(new Error("move rejected"));
    render(<PapersWorkspace />);

    const movable = await screen.findByRole("checkbox", { name: "选择试卷 Movable Paper" });
    const published = screen.getByRole("checkbox", { name: "选择试卷 Published Paper" });
    const revokedHistory = screen.getByRole("checkbox", { name: "选择试卷 Revoked History Paper" });
    expect(published).toBeDisabled();
    expect(revokedHistory).toBeDisabled();
    expect(screen.getByTestId("paper-list-item-p2")).toHaveAttribute("draggable", "false");
    expect(screen.getByTestId("paper-list-item-p3")).toHaveAttribute("draggable", "false");
    await userEvent.click(movable);
    await selectOption(await screen.findByRole("combobox", { name: "批量移动到文件夹" }), "f1");
    await userEvent.click(screen.getByRole("button", { name: "移动所选" }));

    await waitFor(() => expect(mocks.moveContentItemsToFolder).toHaveBeenCalledWith("paper", ["p1"], "f1"));
    expect(await screen.findByText("move rejected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择试卷 Movable Paper" })).toBeChecked();
    await userEvent.click(screen.getByTestId("paper-list-item-p3"));
    await waitFor(() => expect(screen.getByLabelText("试卷所在文件夹")).toBeDisabled());
    expect(screen.getByLabelText("试卷所在文件夹")).toHaveAttribute("title", "已有发布记录，请移动整个文件夹，以保留答卷和统计关系");
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
    await userEvent.click(await screen.findByLabelText(/Class 1/));
    await selectOption(await screen.findByRole("combobox", { name: "发布文件夹" }), "f1");
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
    expect(screen.getByRole("button", { name: "指定学生" })).toHaveClass("bg-[var(--or-primary)]");
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
    await userEvent.click(await screen.findByTestId("paper-load-analysis"));

    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("p1", undefined, undefined));
    expect(await screen.findByRole("dialog", { name: "试卷分析" })).toBeInTheDocument();
    expect(await screen.findByTestId("paper-analysis-charts")).toBeInTheDocument();
    expect(await screen.findByTestId("paper-analysis-chart-score")).toBeInTheDocument();
    expect(await screen.findByTestId("paper-analysis-classes")).toBeInTheDocument();
    expect(await screen.findByTestId("paper-analysis-questions")).toBeInTheDocument();
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
    expect(await screen.findByTestId("paper-publish")).toBeDisabled();

    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    rerender(<PapersWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByTestId("paper-publish")).toBeDisabled());
    await userEvent.click(await screen.findByLabelText(/Class 1/));
    await selectOption(await screen.findByRole("combobox", { name: "发布文件夹" }), "f1");
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
    await userEvent.click(await screen.findByTestId("paper-ai-grade-a1"));
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

    await userEvent.click(await screen.findByTestId("paper-save-grade-math/q2"));
    await screen.findByText("已保存批改结果");

    await userEvent.clear(score);
    await userEvent.type(score, "3");
    await userEvent.click(await screen.findByTestId("paper-save-grade-math/q1"));
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
    mocks.listPlatformPapers.mockImplementation((params: { paperId?: string }) =>
      Promise.resolve({ papers: params.paperId === "p2" ? [secondPaper] : [firstPaper] }),
    );
    mocks.listPaperSubmissions.mockImplementation((paperId: string) =>
      Promise.resolve({ submissions: paperId === "p2" ? [secondSubmission] : [firstSubmission] }),
    );
    mocks.gradePaperAnswer.mockReturnValueOnce(oldPaperSave.promise);
    const { rerender } = render(<PapersWorkspace />);

    await waitFor(() => expect(screen.getAllByText("Midterm").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    await screen.findByText("Student One");
    const firstScore = await screen.findByTestId("paper-grade-math/q1");
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
    mocks.listPlatformPapers.mockImplementation((params: { paperId?: string }) =>
      Promise.resolve({ papers: params.paperId === "p2" ? [secondPaper] : [firstPaper] }),
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
    await userEvent.click(await screen.findByTestId("paper-ai-grade-a1"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());

    const score = await screen.findByTestId("paper-grade-math/q1");
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
    await userEvent.click(await screen.findByTestId("paper-ai-grade-a1"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());
    const score = await screen.findByTestId("paper-grade-math/q1");
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
    await userEvent.click(await screen.findByTestId("paper-ai-grade-batch"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledWith("p1", "a1", ["math/q1"]));

    const firstScore = await screen.findByTestId("paper-grade-math/q1");
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
    await selectOption(screen.getByTestId("paper-grading-student-select"), "a2");
    await waitFor(() => expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("3"));
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
    await userEvent.click(await screen.findByTestId("paper-ai-grade-batch"));
    await waitFor(() => expect(mocks.suggestAiGradesForAttempt).toHaveBeenCalledOnce());
    const score = await screen.findByTestId("paper-grade-math/q1");
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
    expect(await screen.findByTestId("paper-grade-math/q1")).toHaveValue("4");
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
    expect(selector).toHaveTextContent("Student One");
    await screen.findByTestId("paper-grade-math/q1");
    expect(screen.getByText("学生真实作答一")).toBeInTheDocument();
    expect(screen.queryByText("学生真实作答二")).not.toBeInTheDocument();

    await selectOption(selector, "a2");
    expect(selector).toHaveTextContent("Student Two");
    expect(await screen.findByText("学生真实作答二")).toBeInTheDocument();
    expect(screen.queryByText("学生真实作答一")).not.toBeInTheDocument();
  });
  it("discards delayed query results and keeps latest query papers, pagination, and publications", async () => {
    const queryADeferred = deferred<{ papers: any[]; total?: number; page?: number; pageSize?: number; totalPages?: number }>();
    const paperA = { ...offlinePaper, paper_id: "p-a", title: "Math Midterm", publication_count: 1 };
    const paperB = { ...offlinePaper, paper_id: "p-b", title: "Physics Final", publication_count: 1 };

    mocks.listPlatformPapers.mockImplementation((params: any) => {
      if (params.q === "Physics") {
        return Promise.resolve({ papers: [paperB], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      }
      return queryADeferred.promise;
    });

    mocks.listPlatformPaperPublications.mockImplementation((paperId: string) => {
      if (paperId === "p-b") {
        return Promise.resolve({
          publications: [
            {
              id: "pub-b",
              paper_id: "p-b",
              title: "Physics Final Pub",
              status: "published",
              start_at: "2026-07-04T00:00:00Z",
              end_at: "2026-07-04T02:00:00Z",
              recipient_scope: "class",
              class_ids: ["c1"],
              class_names: ["Class 1"],
              submitted_count: 0,
              attempt_count: 1,
              max_screen_switches: 0,
              time_limit_minutes: 60,
            },
          ],
        });
      }
      return Promise.resolve({
        publications: [
          {
            id: "pub-a",
            paper_id: "p-a",
            title: "Math Midterm Pub",
            status: "published",
            start_at: "2026-07-04T00:00:00Z",
            end_at: "2026-07-04T02:00:00Z",
            recipient_scope: "class",
            class_ids: ["c1"],
            class_names: ["Class 1"],
            submitted_count: 0,
            attempt_count: 1,
            max_screen_switches: 0,
            time_limit_minutes: 60,
          },
        ],
      });
    });

    render(<PapersWorkspace />);

    // Query A is pending. Switch to Query B by typing "Physics"
    await waitFor(() => expect(mocks.listPlatformPapers).toHaveBeenCalledWith(expect.objectContaining({ q: "" })));
    const searchInput = screen.getByPlaceholderText("搜索试卷");
    await userEvent.type(searchInput, "Physics");

    // Query B completes and displays Paper B and its publication
    expect((await screen.findAllByText("Physics Final")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Physics Final Pub")).toBeInTheDocument();
    expect(await screen.findByText("第 1 / 1 页，共 1 条")).toBeInTheDocument();

    // Now Query A resolves late
    await act(async () => {
      queryADeferred.resolve({ papers: [paperA], total: 10, page: 1, pageSize: 10, totalPages: 1 });
      await queryADeferred.promise;
    });

    // Verify Query B results remain and Query A did not overwrite
    expect(screen.getAllByText("Physics Final").length).toBeGreaterThan(0);
    expect(screen.queryByText("Math Midterm")).not.toBeInTheDocument();
    expect(screen.getByText("Physics Final Pub")).toBeInTheDocument();
    expect(screen.queryByText("Math Midterm Pub")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 / 1 页，共 1 条")).toBeInTheDocument();
    expect(screen.queryByText("共 10 条")).not.toBeInTheDocument();
  });

  it("does not backfill error when an older query rejects after the latest query succeeds", async () => {
    let rejectQueryA!: (err: Error) => void;
    const queryAPromise = new Promise<any>((_, reject) => {
      rejectQueryA = reject;
    });
    const paperB = { ...offlinePaper, paper_id: "p-b", title: "Chemistry Exam" };

    mocks.listPlatformPapers.mockImplementation((params: any) => {
      if (params.q === "Chemistry") {
        return Promise.resolve({ papers: [paperB], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      }
      return queryAPromise;
    });

    const onError = vi.fn();
    render(<PapersWorkspace onError={onError} />);

    // Query A is in flight. Trigger Query B (Chemistry)
    await waitFor(() => expect(mocks.listPlatformPapers).toHaveBeenCalledWith(expect.objectContaining({ q: "" })));
    const searchInput = screen.getByPlaceholderText("搜索试卷");
    await userEvent.type(searchInput, "Chemistry");

    expect((await screen.findAllByText("Chemistry Exam")).length).toBeGreaterThan(0);

    // Now Query A rejects late
    await act(async () => {
      rejectQueryA(new Error("Stale query network failure"));
      try {
        await queryAPromise;
      } catch {
        // expected
      }
    });

    // Query A error should be ignored and not backfilled
    expect(onError).not.toHaveBeenCalledWith("Stale query network failure");
    expect(screen.queryByText("Stale query network failure")).not.toBeInTheDocument();
    expect(screen.getAllByText("Chemistry Exam").length).toBeGreaterThan(0);
  });

  it("ignores stale folder query responses when switching folders", async () => {
    const folder1Deferred = deferred<{ papers: any[]; total?: number; page?: number; pageSize?: number; totalPages?: number }>();
    const paper1 = { ...offlinePaper, paper_id: "p-f1", title: "Folder 1 Paper" };
    const paper2 = { ...offlinePaper, paper_id: "p-f2", title: "Folder 2 Paper" };

    mocks.listContentFolders.mockResolvedValue({
      folders: [
        { id: "f1", owner_teacher_id: "t1", scope: "paper", parent_id: null, kind: "category", name: "Folder One" },
        { id: "f2", owner_teacher_id: "t1", scope: "paper", parent_id: null, kind: "category", name: "Folder Two" },
      ],
    });

    mocks.listPlatformPapers.mockImplementation((params: any) => {
      if (params.folderId === "f2") {
        return Promise.resolve({ papers: [paper2], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      }
      if (params.folderId === "f1") {
        return folder1Deferred.promise;
      }
      return Promise.resolve({ papers: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
    });

    render(<PapersWorkspace />);

    // Switch to folder 1 (delayed)
    const folder1Items = await screen.findAllByText("Folder One");
    await userEvent.click(folder1Items[0]);

    // Switch to folder 2 (resolves fast)
    const folder2Items = await screen.findAllByText("Folder Two");
    await userEvent.click(folder2Items[0]);
    expect((await screen.findAllByText("Folder 2 Paper")).length).toBeGreaterThan(0);

    // Folder 1 resolves late
    await act(async () => {
      folder1Deferred.resolve({ papers: [paper1], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      await folder1Deferred.promise;
    });

    expect(screen.getAllByText("Folder 2 Paper").length).toBeGreaterThan(0);
    expect(screen.queryByText("Folder 1 Paper")).not.toBeInTheDocument();
  });

  it("localizes publication clock updates so clock ticks do not re-render PapersWorkspace", async () => {
    vi.useFakeTimers();
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [{ ...offlinePaper, delivery_mode: "online", publication_count: 1 }],
    });
    mocks.listPlatformPaperPublications.mockResolvedValue({
      publications: [
        {
          id: "pub1",
          paper_id: "p1",
          title: "Midterm",
          start_at: "2026-07-04T00:00:00Z",
          end_at: "2026-07-04T02:00:00Z",
          status: "published",
          recipient_scope: "class",
          class_ids: ["c1"],
          class_names: ["Class 1"],
          submitted_count: 0,
          attempt_count: 1,
          max_screen_switches: 0,
          time_limit_minutes: 60,
        },
      ],
    });

    render(<PapersWorkspace />);

    await act(async () => {
      await Promise.resolve();
    });

    const callsAfterMount = mocks.listPlatformPapers.mock.calls.length;

    // Advance 3 seconds
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // listPlatformPapers is NOT called again on second ticks
    expect(mocks.listPlatformPapers.mock.calls.length).toBe(callsAfterMount);

    vi.useRealTimers();
  });

  it("default omitted projectScope prop still reads /api/project/info and restores draft using fetched project", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, feedback: null, grading_status: "pending", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });

    // Store draft for teacher-1 / project-1 / p1
    const storageKey = buildGradingDraftStorageKey({
      accountId: "teacher-1",
      projectId: "project-1",
      paperId: "p1",
      attemptId: "a1",
      questionId: "math/q1",
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        sourceVersion: null,
        score: "3.5",
        feedback: "Default scope draft",
      }),
    );

    render(<PapersWorkspace />);
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/project/info"));

    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await waitFor(() => expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("3.5"));
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("Default scope draft");
  });

  it("host projectScope with ready=false does not call /api/project/info and does not restore drafts", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, feedback: null, grading_status: "pending", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });

    const storageKey = buildGradingDraftStorageKey({
      accountId: "teacher-1",
      projectId: "project-1",
      paperId: "p1",
      attemptId: "a1",
      questionId: "math/q1",
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        sourceVersion: null,
        score: "3.5",
        feedback: "Pending scope draft",
      }),
    );

    render(<PapersWorkspace projectScope={{ ready: false, value: null }} />);

    // Must NOT call /api/project/info
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/project/info");

    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    // Draft should NOT be restored
    expect(screen.queryByTestId("paper-grade-math/q1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paper-feedback-math/q1")).not.toBeInTheDocument();
  });

  it("host projectScope with ready=true and string value isolates drafts to custom scope without calling /api/project/info", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, feedback: null, grading_status: "pending", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });

    // Store draft for custom scope
    const storageKey = buildGradingDraftStorageKey({
      accountId: "teacher-1",
      projectId: "custom-host-scope",
      paperId: "p1",
      attemptId: "a1",
      questionId: "math/q1",
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        sourceVersion: null,
        score: "4.5",
        feedback: "Custom host scope feedback",
      }),
    );

    render(<PapersWorkspace projectScope={{ ready: true, value: "custom-host-scope" }} />);

    // Must NOT call /api/project/info
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/project/info");

    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    await waitFor(() => expect(screen.getByTestId("paper-grade-math/q1")).toHaveValue("4.5"));
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("Custom host scope feedback");
  });

  it("transitions projectScope from pending to ready and restores drafts for the newly resolved scope", async () => {
    const submission = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Student One",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "math/q1", score: null, feedback: null, grading_status: "pending", images: [] }],
    };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [{ ...offlinePaper, delivery_mode: "online" }] });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [submission] });

    const storageKey = buildGradingDraftStorageKey({
      accountId: "teacher-1",
      projectId: "bound-project",
      paperId: "p1",
      attemptId: "a1",
      questionId: "math/q1",
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        sourceVersion: null,
        score: "5",
        feedback: "Resolved bound draft",
      }),
    );

    const { rerender } = render(<PapersWorkspace projectScope={{ ready: false, value: null }} />);
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/project/info");

    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    expect(screen.queryByTestId("paper-grade-math/q1")).not.toBeInTheDocument();

    // Transition scope to ready
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "bound-project" }} />);

    await waitFor(() => expect(screen.getByDisplayValue("5")).toBeInTheDocument());
    expect(screen.getByTestId("paper-feedback-math/q1")).toHaveValue("Resolved bound draft");
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/project/info");
  });  it("PaperPublishingSidebar independently renders and updates publication window badge without parent clock prop", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const futurePublication = {
      id: "pub-sidebar-1",
      paper_id: "p1",
      title: "Sidebar Test Paper",
      status: "published",
      start_at: new Date(now + 60000).toISOString(),
      end_at: new Date(now + 120000).toISOString(),
      recipient_scope: "class" as const,
      class_ids: ["c1"],
      class_names: ["Class 1"],
      submitted_count: 0,
      attempt_count: 5,
      max_screen_switches: 0,
      time_limit_minutes: 60,
    };

    render(
      <PaperPublishingSidebar
        publishPanel={<div>Publish Panel Content</div>}
        publications={[futurePublication]}
        busy={null}
        onTogglePause={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("未开始")).toBeInTheDocument();

    // Advance past start_at
    await act(async () => {
      vi.advanceTimersByTime(61000);
    });

    expect(screen.getByText("进行中")).toBeInTheDocument();

    vi.useRealTimers();
  });  it("user perspective: browsing, pagination, page size switching and manual refresh", async () => {
    const generatePapers = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({
        ...offlinePaper,
        paper_id: `${prefix}-${i + 1}`,
        title: `${prefix} Paper ${i + 1}`,
      }));

    mocks.listPlatformPapers.mockImplementation((params: any) => {
      const page = params.page || 1;
      const pageSize = params.pageSize || 10;
      const total = 25;
      const totalPages = Math.ceil(total / pageSize);
      const start = (page - 1) * pageSize;
      const papers = generatePapers(total, "Exam").slice(start, start + pageSize);
      return Promise.resolve({ papers, total, page, pageSize, totalPages });
    });

    render(<PapersWorkspace />);

    // 1. Initial page 1 shows 10 items
    expect(await screen.findByText("第 1 / 3 页，共 25 条")).toBeInTheDocument();
    expect(screen.getByText(/Exam Paper 1 ·/)).toBeInTheDocument();
    expect(screen.getByText(/Exam Paper 10 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Exam Paper 11 ·/)).not.toBeInTheDocument();

    // 2. Click "下一页" -> page 2
    const nextBtn = screen.getByRole("button", { name: "下一页" });
    const prevBtn = screen.getByRole("button", { name: "上一页" });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    await userEvent.click(nextBtn);
    expect(await screen.findByText("第 2 / 3 页，共 25 条")).toBeInTheDocument();
    expect(screen.getByText(/Exam Paper 11 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Exam Paper 1 ·/)).not.toBeInTheDocument();
    expect(prevBtn).toBeEnabled();

    // 3. Click "上一页" -> returns to page 1
    await userEvent.click(prevBtn);
    expect(await screen.findByText("第 1 / 3 页，共 25 条")).toBeInTheDocument();
    expect(screen.getByText(/Exam Paper 1 ·/)).toBeInTheDocument();

    // 4. Change page size to 20
    const pageSizeSelect = screen.getByLabelText("每页条数");
    await selectOption(pageSizeSelect, "20");
    expect(pageSizeSelect).toHaveTextContent("20 条/页");
    expect(await screen.findByText("第 1 / 2 页，共 25 条")).toBeInTheDocument();
    expect(screen.getByText(/Exam Paper 20 ·/)).toBeInTheDocument();

    // 5. Click "刷新"
    const refreshBtn = screen.getByRole("button", { name: "刷新" });
    await userEvent.click(refreshBtn);
    expect(await screen.findByText("第 1 / 2 页，共 25 条")).toBeInTheDocument();
  });

  it("user perspective: publishing validation, publishing execution, pause/resume, and revoke lifecycle", async () => {
    const paper = { ...offlinePaper, paper_id: "p1", title: "Active Exam", question_count: 5, delivery_mode: "online" as const };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [paper] });

    let currentPublication: any = null;
    mocks.listPlatformPaperPublications.mockImplementation(() =>
      Promise.resolve({ publications: currentPublication ? [currentPublication] : [] }),
    );

    mocks.publishPlatformPaper.mockImplementation((_paperId, body: any) => {
      currentPublication = {
        id: "pub-1",
        paper_id: "p1",
        title: "Active Exam",
        status: "published",
        start_at: "2026-07-04T00:00:00Z",
        end_at: "2026-07-04T02:00:00Z",
        recipient_scope: "class",
        class_ids: body.class_ids,
        class_names: ["Class 1"],
        submitted_count: 0,
        attempt_count: 20,
        max_screen_switches: body.max_screen_switches,
        time_limit_minutes: body.time_limit_minutes,
      };
      return Promise.resolve({ publication: currentPublication });
    });

    mocks.updatePlatformPaperPublication.mockImplementation((_paperId, _pubId, patch: any) => {
      currentPublication = { ...currentPublication, ...patch };
      return Promise.resolve({ publication: currentPublication });
    });

    mocks.revokePlatformPaperPublication.mockImplementation(() => {
      currentPublication = null;
      return Promise.resolve({ ok: true });
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<PapersWorkspace />);

    // Initially publish button is disabled because no class is selected
    const publishBtn = await screen.findByTestId("paper-publish");
    expect(publishBtn).toBeDisabled();
    expect(screen.getByText("请选择至少一个未发布过的班级。")).toBeInTheDocument();

    // User selects class
    const classCheckbox = screen.getByTestId("paper-class-c1");
    await userEvent.click(classCheckbox);

    // Still disabled because no folder selected
    expect(publishBtn).toBeDisabled();

    // User selects folder
    const folderSelect = screen.getByLabelText("发布文件夹");
    await selectOption(folderSelect, "f1");

    // Now button is enabled
    expect(publishBtn).toBeEnabled();

    // User clicks publish
    await userEvent.click(publishBtn);

    // Publication record appears in sidebar
    expect(await screen.findByText("暂停收取提交")).toBeInTheDocument();

    // User pauses publication
    const pauseBtn = screen.getByRole("button", { name: "暂停收取提交" });
    await userEvent.click(pauseBtn);
    expect(await screen.findByRole("button", { name: "恢复收取提交" })).toBeInTheDocument();

    // User resumes publication
    const resumeBtn = screen.getByRole("button", { name: "恢复收取提交" });
    await userEvent.click(resumeBtn);
    expect(await screen.findByRole("button", { name: "暂停收取提交" })).toBeInTheDocument();

    // User revokes publication
    const revokeBtn = screen.getByRole("button", { name: "撤回发布" });
    await userEvent.click(revokeBtn);
    expect(await screen.findByText("已撤回发布")).toBeInTheDocument();
  });

  it("user perspective: teacher grades multiple students with isolated unsaved drafts across paper switches", async () => {
    const paper1 = { ...offlinePaper, paper_id: "p1", title: "Math Paper" };
    const paper2 = { ...offlinePaper, paper_id: "p2", title: "English Paper" };

    const submissionP1 = {
      attempt_id: "a1",
      publication_id: "pub1",
      student_name: "Alice",
      student_no: "S001",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 5,
      answers: [{ question_id: "q1", content: "1 + 1 = ?", answer: "2", score: null, feedback: null, grading_status: "pending", images: [] }],
    };

    const submissionP2 = {
      attempt_id: "a2",
      publication_id: "pub2",
      student_name: "Bob",
      student_no: "S002",
      status: "submitted",
      submitted_at: "2026-08-23T08:30:00Z",
      score: null,
      max_score: 10,
      answers: [{ question_id: "eng1", content: "Translate hello", answer: "你好", score: null, feedback: null, grading_status: "pending", images: [] }],
    };

    mocks.listPlatformPapers.mockResolvedValue({ papers: [paper1, paper2] });
    mocks.listPaperSubmissions.mockImplementation((paperId: string) => {
      if (paperId === "p1") return Promise.resolve({ submissions: [submissionP1] });
      return Promise.resolve({ submissions: [submissionP2] });
    });
    mocks.gradePaperAnswer.mockResolvedValue({
      answer: { question_id: "q1", score: 5, feedback: "Excellent job!", grading_status: "reviewed" },
    });

    render(<PapersWorkspace />);

    // 1. Open grading for Paper 1
    await userEvent.click(await screen.findByTestId("paper-tab-grading"));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("1 + 1 = ?")).toBeInTheDocument();

    // Type score and comment for Paper 1
    const scoreInputP1 = await screen.findByTestId("paper-grade-q1");
    const feedbackInputP1 = screen.getByTestId("paper-feedback-q1");
    await userEvent.type(scoreInputP1, "5");
    await userEvent.type(feedbackInputP1, "Excellent job!");

    // 2. User switches to Paper 2 in sidebar and loads its grading view
    await userEvent.click(screen.getByText(/English Paper/));
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Translate hello")).toBeInTheDocument();

    // Verify Paper 2 does NOT have Paper 1's inputs
    expect(screen.getByTestId("paper-grade-eng1")).toHaveValue("");
    expect(screen.getByTestId("paper-feedback-eng1")).toHaveValue("");

    // 3. User switches back to Paper 1
    await userEvent.click(screen.getByText(/Math Paper/));
    await userEvent.click(screen.getByTestId("paper-tab-grading"));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    // Draft score and feedback for Paper 1 are preserved
    await waitFor(() => expect(screen.getByTestId("paper-grade-q1")).toHaveValue("5"));
    expect(screen.getByTestId("paper-feedback-q1")).toHaveValue("Excellent job!");

    // 4. Save grading
    await userEvent.click(screen.getByTestId("paper-save-grade-q1"));
    await waitFor(() =>
      expect(mocks.gradePaperAnswer).toHaveBeenCalledWith("p1", "a1", "q1", {
        score: 5,
        feedback: "Excellent job!",
        is_correct: null,
      }),
    );
  });

  it("user perspective: switching delivery mode and handling offline score upload and template download", async () => {
    const paper = { ...offlinePaper, paper_id: "p1", title: "Hybrid Exam", delivery_mode: "offline" as const };
    mocks.listPlatformPapers.mockResolvedValue({ papers: [paper] });
    mocks.updatePlatformPaperDeliveryMode.mockImplementation((_id, mode) =>
      Promise.resolve({ paper: { ...paper, delivery_mode: mode } }),
    );
    mocks.uploadPaperScores.mockResolvedValue({ ok: true, batch_id: "batch-1", student_count: 5 });

    render(<PapersWorkspace />);

    // Initially offline
    expect(await screen.findByTestId("paper-mode-offline")).toBeDisabled();
    const onlineBtn = screen.getByTestId("paper-mode-online");
    expect(onlineBtn).toBeEnabled();

    // User switches to online
    await userEvent.click(onlineBtn);
    await waitFor(() => expect(mocks.updatePlatformPaperDeliveryMode).toHaveBeenCalledWith("p1", "online"));

    // User downloads score template
    const downloadTemplateBtn = await screen.findByRole(
      "button",
      { name: "下载成绩模板" },
      { timeout: 4000 },
    );
    await userEvent.click(downloadTemplateBtn);
    await waitFor(() =>
      expect(mocks.apiDownloadBlob).toHaveBeenCalledWith(`/api/exams/${encodeURIComponent(paper.exam_id)}/score-template`),
    );

    // User uploads scores
    const file = new File(["student,score\nS001,90"], "scores.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"][accept=".csv,.xlsx,.xls"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(mocks.uploadPaperScores).toHaveBeenCalledWith(paper.exam_id, file));
    expect(await screen.findByText("成绩已上传")).toBeInTheDocument();
  });
});
