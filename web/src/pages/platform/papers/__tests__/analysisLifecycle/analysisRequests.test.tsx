import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PapersWorkspace } from "../../PapersWorkspace";
import { selectOption } from "../../../../../test/selectOption";

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

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../api/client")>();
  return { ...actual, apiGet: mocks.apiGet, apiDownloadBlob: mocks.apiDownloadBlob };
});

vi.mock("../../../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../platform/auth")>();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const papers = [
  {
    paper_id: "paper-a",
    exam_id: "exam-a",
    title: "Paper A",
    subject: "Math",
    delivery_mode: "online" as const,
    status: "published",
    question_count: 2,
    section_count: 1,
    score_batch_count: 0,
    has_score: true,
    has_pdf: false,
    has_docx: false,
    latest_batch_id: null,
    publication_count: 1,
    published_class_count: 1,
    mtime: "2026-01-01T00:00:00Z",
  },
  {
    paper_id: "paper-b",
    exam_id: "exam-b",
    title: "Paper B",
    subject: "Science",
    delivery_mode: "online" as const,
    status: "published",
    question_count: 3,
    section_count: 1,
    score_batch_count: 0,
    has_score: true,
    has_pdf: false,
    has_docx: false,
    latest_batch_id: null,
    publication_count: 1,
    published_class_count: 1,
    mtime: "2026-01-01T00:00:00Z",
  },
];

function paperAnalysis(
  paper: (typeof papers)[number],
  options: {
    publicationId?: string;
    classId?: string;
    averageScore?: number | null;
    publications?: Array<{ id: string; title: string; created_at: string }>;
    availableClasses?: Array<{ id: string; name: string; grade?: string | null }>;
  } = {},
) {
  return {
    analysis: {
      paper: {
        paper_id: paper.paper_id,
        exam_id: paper.exam_id,
        title: paper.title,
        subject: paper.subject,
        delivery_mode: paper.delivery_mode,
        status: paper.status,
      },
      publication_id: options.publicationId ?? `publication-${paper.paper_id}`,
      class_id: options.classId ?? `class-${paper.paper_id}`,
      publications: options.publications ?? [],
      available_classes: options.availableClasses ?? [],
      summary: {
        total_students: 0,
        completed_students: 0,
        in_progress_students: 0,
        not_started_students: 0,
        completion_rate: 0,
        average_score: options.averageScore ?? null,
        average_time_seconds: null,
        publication_count: 1,
      },
      proctoring: {
        event_count: 0,
        event_type_counts: {},
        screen_switch_count: 0,
        screen_switch_duration_ms: 0,
        flagged_student_count: 0,
        exceeded_student_count: 0,
      },
      classes: [],
      questions: [],
      modules: [],
      radar: [],
      students: [],
    },
  };
}

describe("PapersWorkspace analysis request ownership", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.apiGet.mockResolvedValue({ bound: true, root: "C:/project", project_id: "project-1" });
    mocks.apiDownloadBlob.mockResolvedValue({ blob: new Blob(["template"]), filename: "template.csv" });
    mocks.getAccountProfile.mockResolvedValue({ profile: { id: "teacher-1", subjects: [] } });
    mocks.listPlatformPaperPublications.mockResolvedValue({ publications: [] });
    mocks.listPlatformPapers.mockResolvedValue({ papers });
    mocks.listTeacherAssignedClasses.mockResolvedValue({ classes: [] });
    mocks.listTeacherClassStudents.mockResolvedValue({ students: [] });
    mocks.listContentFolders.mockResolvedValue({ folders: [] });
    mocks.listTaggedItems.mockResolvedValue({ items: {} });
    mocks.moveContentItemsToFolder.mockResolvedValue({ ok: true, moved_count: 0 });
    mocks.listPaperSubmissions.mockResolvedValue({ submissions: [] });
    mocks.suggestAiGradesForAttempt.mockResolvedValue({ suggestions: [] });
    mocks.gradePaperAnswer.mockResolvedValue({ ok: true });
    mocks.downloadPaperAnalysisReport.mockResolvedValue(new Blob(["report"]));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:report") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
  });

  it("does not let an older paper analysis replace the currently selected paper", async () => {
    const analysisA = deferred<ReturnType<typeof paperAnalysis>>();
    const analysisB = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockImplementation((paperId: string) =>
      paperId === "paper-a" ? analysisA.promise : analysisB.promise,
    );

    render(<PapersWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Paper A/ }));
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));

    fireEvent.click(screen.getByRole("button", { name: /Paper B/ }));
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-b", undefined, undefined));

    await act(async () => { analysisB.resolve(paperAnalysis(papers[1]!)); });
    expect(await screen.findByRole("heading", { name: "Paper B · 试卷分析" })).toBeInTheDocument();

    await act(async () => { analysisA.resolve(paperAnalysis(papers[0]!)); });
    await waitFor(() => {
      const dialog = screen.getByRole("dialog", { name: "试卷分析" });
      expect(dialog.querySelector("h2")?.textContent).toBe("Paper B · 试卷分析");
    });
  });

  it("keeps the newest filter result when same-paper filter requests finish out of order", async () => {
    const publications = [
      { id: "publication-one", title: "Batch One", created_at: "2026-01-01" },
      { id: "publication-two", title: "Batch Two", created_at: "2026-01-02" },
      { id: "publication-three", title: "Batch Three", created_at: "2026-01-03" },
    ];
    mocks.analyzePlatformPaper.mockResolvedValueOnce(paperAnalysis(papers[0]!, {
      publicationId: "publication-one",
      classId: "class-one",
      publications,
      availableClasses: [{ id: "class-one", name: "Class One" }],
    }));

    render(<PapersWorkspace />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await screen.findByLabelText("分析发布批次");
    expect(screen.getByLabelText("分析班级")).toHaveTextContent("Class One");

    const olderFilter = deferred<ReturnType<typeof paperAnalysis>>();
    const newerFilter = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockImplementation((_paperId: string, publicationId?: string) =>
      publicationId === "publication-two" ? olderFilter.promise : newerFilter.promise,
    );
    const publicationSelect = screen.getByRole("combobox", { name: "分析发布批次" });
    await selectOption(publicationSelect, "publication-two");
    await selectOption(publicationSelect, "publication-three");

    const filterCalls = mocks.analyzePlatformPaper.mock.calls.slice(-2);
    expect(filterCalls.map((call) => call[1])).toEqual(
      expect.arrayContaining(["publication-two", "publication-three"]),
    );
    expect(filterCalls.every((call) => call[2] === undefined)).toBe(true);
    const latestPublicationId = filterCalls[1]?.[1] as string;
    const latestFilter = latestPublicationId === "publication-two" ? olderFilter : newerFilter;
    const staleFilter = latestPublicationId === "publication-two" ? newerFilter : olderFilter;
    expect(publicationSelect).toHaveTextContent("Batch Three");
    expect(screen.getByLabelText("分析班级")).toHaveTextContent("全部班级");
    expect(screen.getByTestId("paper-export-report-xlsx")).toBeDisabled();

    await act(async () => {
      latestFilter.resolve(paperAnalysis(papers[0]!, {
        publicationId: latestPublicationId,
        averageScore: 93,
        publications,
      }));
    });
    expect(await screen.findByText("93")).toBeInTheDocument();

    await act(async () => {
      staleFilter.resolve(paperAnalysis(papers[0]!, {
        publicationId: latestPublicationId === "publication-two" ? "publication-three" : "publication-two",
        averageScore: 22,
        publications,
      }));
    });
    expect(screen.getByText("93")).toBeInTheDocument();
    expect(screen.queryByText("22")).not.toBeInTheDocument();
    expect(screen.getByLabelText("分析发布批次")).toHaveTextContent("Batch Three");
  });

  it("does not reopen analysis after the user closes it while a filter request is pending", async () => {
    const publications = [
      { id: "publication-one", title: "Batch One", created_at: "2026-01-01" },
      { id: "publication-two", title: "Batch Two", created_at: "2026-01-02" },
    ];
    mocks.analyzePlatformPaper.mockResolvedValueOnce(paperAnalysis(papers[0]!, {
      publicationId: "publication-one",
      publications,
    }));

    render(<PapersWorkspace />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await screen.findByRole("heading", { name: "Paper A · 试卷分析" });

    const lateFilter = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockReturnValue(lateFilter.promise);
    await selectOption(screen.getByRole("combobox", { name: "分析发布批次" }), "publication-two");
    expect(await screen.findByText("正在更新分析结果…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭试卷分析" }));
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();

    await act(async () => {
      lateFilter.resolve(paperAnalysis(papers[0]!, { publicationId: "publication-two" }));
    });
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();
  });

  it("reports a current filter failure and removes the previous analysis", async () => {
    const publications = [
      { id: "publication-one", title: "Batch One", created_at: "2026-01-01" },
      { id: "publication-two", title: "Batch Two", created_at: "2026-01-02" },
    ];
    mocks.analyzePlatformPaper.mockResolvedValueOnce(paperAnalysis(papers[0]!, {
      publicationId: "publication-one",
      averageScore: 74,
      publications,
    }));
    const onError = vi.fn();

    render(<PapersWorkspace onError={onError} />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await screen.findByText("74");

    const failedFilter = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockReturnValue(failedFilter.promise);
    await selectOption(screen.getByRole("combobox", { name: "分析发布批次" }), "publication-two");
    await screen.findByText("正在更新分析结果…");

    await act(async () => {
      failedFilter.reject(new Error("current filter failure"));
      await failedFilter.promise.catch(() => undefined);
    });
    expect(onError).toHaveBeenCalledWith("current filter failure");
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("74")).not.toBeInTheDocument();
  });

  it("ignores a late analysis response after the same paper moves to another project", async () => {
    const lateAnalysis = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockReturnValue(lateAnalysis.promise);

    const { rerender } = render(
      <PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} />,
    );
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));

    rerender(<PapersWorkspace projectScope={{ ready: true, value: "project-beta" }} />);
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();

    await act(async () => {
      lateAnalysis.resolve(paperAnalysis(papers[0]!));
    });
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();
  });

  it("hides and rejects same-paper analysis across a token/profile transition", async () => {
    localStorage.setItem("solaire.platform.session", "session-alpha");
    const nextProfile = deferred<{ profile: { id: string; subjects: string[] } }>();
    let profileCalls = 0;
    mocks.getAccountProfile.mockImplementation(() => {
      profileCalls += 1;
      return profileCalls === 1
        ? Promise.resolve({ profile: { id: "teacher-alpha", subjects: [] } })
        : nextProfile.promise;
    });
    const lateAnalysis = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockReturnValue(lateAnalysis.promise);

    const { rerender } = render(
      <PapersWorkspace projectScope={{ ready: true, value: "shared-project" }} />,
    );
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));

    localStorage.setItem("solaire.platform.session", "session-beta");
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "shared-project" }} />);
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载当前账号数据");

    await act(async () => {
      lateAnalysis.resolve(paperAnalysis(papers[0]!));
    });
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();

    await waitFor(() => expect(mocks.getAccountProfile).toHaveBeenCalledTimes(2));
    await act(async () => {
      nextProfile.resolve({ profile: { id: "teacher-beta", subjects: [] } });
    });
    await screen.findByRole("button", { name: /Paper A/ });
    expect(screen.queryByRole("dialog", { name: "试卷分析" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("paper-analysis-chart-score")).not.toBeInTheDocument();
  });

  it("checks the current token even before a token change has rendered", async () => {
    const lateAnalysis = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper.mockReturnValue(lateAnalysis.promise);

    render(<PapersWorkspace />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));

    localStorage.setItem("solaire.platform.session", "session-changed-before-render");
    await act(async () => {
      lateAnalysis.resolve(paperAnalysis(papers[0]!));
    });
    expect(screen.queryByTestId("paper-analysis-chart-score")).not.toBeInTheDocument();
  });

  it("ignores an analysis failure after the workspace unmounts", async () => {
    const failedAnalysis = deferred<ReturnType<typeof paperAnalysis>>();
    const onError = vi.fn();
    mocks.analyzePlatformPaper.mockReturnValue(failedAnalysis.promise);

    const { unmount } = render(<PapersWorkspace onError={onError} />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));
    unmount();

    await act(async () => {
      failedAnalysis.reject(new Error("unmounted analysis failure"));
      await failedAnalysis.promise.catch(() => undefined);
    });
    expect(onError).not.toHaveBeenCalledWith("unmounted analysis failure");
  });

  it("does not report a superseded failure or let its finally clear the newer analysis busy state", async () => {
    const analysisA = deferred<ReturnType<typeof paperAnalysis>>();
    const analysisB = deferred<ReturnType<typeof paperAnalysis>>();
    const onError = vi.fn();
    mocks.analyzePlatformPaper.mockImplementation((paperId: string) =>
      paperId === "paper-a" ? analysisA.promise : analysisB.promise,
    );

    render(<PapersWorkspace onError={onError} />);
    fireEvent.click(await screen.findByRole("button", { name: /Paper A/ }));
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-a", undefined, undefined));

    fireEvent.click(screen.getByRole("button", { name: /Paper B/ }));
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-b", undefined, undefined));

    await act(async () => {
      analysisA.reject(new Error("superseded analysis failure"));
      await analysisA.promise.catch(() => undefined);
    });
    expect(onError).not.toHaveBeenCalledWith("superseded analysis failure");
    expect(screen.getByTestId("paper-load-analysis")).toBeDisabled();
    expect(screen.getByTestId("paper-load-analysis")).toHaveTextContent("加载中");

    await act(async () => {
      analysisB.resolve(paperAnalysis(papers[1]!));
    });
    expect(await screen.findByRole("heading", { name: "Paper B · 试卷分析" })).toBeInTheDocument();
  });

  it("exports the captured paper, filters, and filename after a same-scope paper switch", async () => {
    const report = deferred<Blob>();
    const downloadedFilenames: string[] = [];
    mocks.analyzePlatformPaper.mockResolvedValue(paperAnalysis(papers[0]!));
    mocks.downloadPaperAnalysisReport.mockReturnValue(report.promise);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilenames.push(this.download);
    });

    render(<PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await screen.findByRole("heading", { name: "Paper A · 试卷分析" });
    fireEvent.click(await screen.findByTestId("paper-export-report-xlsx"));
    await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith(
      "paper-a",
      "xlsx",
      "publication-paper-a",
      "class-paper-a",
    ));

    fireEvent.click(screen.getByRole("button", { name: "关闭试卷分析" }));
    fireEvent.click(screen.getByRole("button", { name: /Paper B/ }));
    await act(async () => {
      report.resolve(new Blob(["report"]));
    });

    expect(downloadedFilenames).toEqual(["Paper A-analysis-report.xlsx"]);
  });

  it("does not let an older export finally clear a newer paper analysis busy state", async () => {
    const report = deferred<Blob>();
    const analysisB = deferred<ReturnType<typeof paperAnalysis>>();
    mocks.analyzePlatformPaper
      .mockResolvedValueOnce(paperAnalysis(papers[0]!))
      .mockReturnValueOnce(analysisB.promise);
    mocks.downloadPaperAnalysisReport.mockReturnValue(report.promise);

    render(<PapersWorkspace />);
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await screen.findByRole("heading", { name: "Paper A · 试卷分析" });
    fireEvent.click(await screen.findByTestId("paper-export-report-xlsx"));
    await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith(
      "paper-a",
      "xlsx",
      "publication-paper-a",
      "class-paper-a",
    ));

    fireEvent.click(screen.getByRole("button", { name: "关闭试卷分析" }));
    fireEvent.click(screen.getByRole("button", { name: /Paper B/ }));
    fireEvent.click(await screen.findByTestId("paper-load-analysis"));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("paper-b", undefined, undefined));

    await act(async () => {
      report.resolve(new Blob(["report"]));
    });
    expect(screen.getByTestId("paper-load-analysis")).toBeDisabled();
    expect(screen.getByTestId("paper-load-analysis")).toHaveTextContent("加载中");

    await act(async () => {
      analysisB.resolve(paperAnalysis(papers[1]!));
    });
    expect(await screen.findByRole("heading", { name: "Paper B · 试卷分析" })).toBeInTheDocument();
  });

  it.each(["project", "account", "unmount"] as const)(
    "ignores an export response after a %s scope change",
    async (boundary) => {
      const report = deferred<Blob>();
      const failedReport = deferred<Blob>();
      const downloadedFilenames: string[] = [];
      const onError = vi.fn();
      mocks.analyzePlatformPaper.mockResolvedValue(paperAnalysis(papers[0]!));
      mocks.downloadPaperAnalysisReport
        .mockReturnValueOnce(report.promise)
        .mockReturnValueOnce(failedReport.promise);
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFilenames.push(this.download);
      });

      const { rerender, unmount } = render(
        <PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} onError={onError} />,
      );
      fireEvent.click(await screen.findByTestId("paper-load-analysis"));
      await screen.findByRole("heading", { name: "Paper A · 试卷分析" });
      fireEvent.click(await screen.findByTestId("paper-export-report-xlsx"));
      fireEvent.click(await screen.findByTestId("paper-export-report-pdf"));
      await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledTimes(2));

      if (boundary === "project") {
        rerender(<PapersWorkspace projectScope={{ ready: true, value: "project-beta" }} />);
      } else if (boundary === "account") {
        localStorage.setItem("solaire.platform.session", "session-beta");
        rerender(<PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} />);
      } else {
        unmount();
      }

      await act(async () => {
        report.resolve(new Blob(["report"]));
        failedReport.reject(new Error("stale report failure"));
        await failedReport.promise.catch(() => undefined);
      });
      expect(downloadedFilenames).toEqual([]);
      expect(onError).not.toHaveBeenCalledWith("stale report failure");
    },
  );
});
