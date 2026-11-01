import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PapersWorkspace } from "../../PapersWorkspace";

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
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const paper1 = {
  paper_id: "paper-1",
  exam_id: "exam-1",
  title: "First Exam",
  subject: "Math",
  delivery_mode: "online" as const,
  status: "published",
  question_count: 2,
  section_count: 1,
  score_batch_count: 0,
  has_score: false,
  has_pdf: false,
  has_docx: false,
  latest_batch_id: null,
  publication_count: 1,
  published_class_count: 1,
  mtime: "2026-10-01T00:00:00Z",
};

const paper2 = {
  paper_id: "paper-2",
  exam_id: "exam-2",
  title: "Second Exam",
  subject: "Physics",
  delivery_mode: "online" as const,
  status: "published",
  question_count: 2,
  section_count: 1,
  score_batch_count: 0,
  has_score: false,
  has_pdf: false,
  has_docx: false,
  latest_batch_id: null,
  publication_count: 1,
  published_class_count: 1,
  mtime: "2026-10-02T00:00:00Z",
};

describe("PapersWorkspace request generation and lifecycle guards", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.apiGet.mockResolvedValue({ bound: true, root: "C:/project", project_id: "project-1" });
    mocks.getAccountProfile.mockResolvedValue({ profile: { id: "teacher-1", subjects: ["Math", "Physics"] } });
    mocks.listTeacherAssignedClasses.mockResolvedValue({ classes: [] });
    mocks.listContentFolders.mockResolvedValue({ folders: [] });
    mocks.listTaggedItems.mockResolvedValue({ items: {} });
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [paper1, paper2],
      total: 2,
      page: 1,
      page_size: 10,
    });
  });

  it("drops late publication response when user switches paper", async () => {
    const pubDef1 = deferred<any>();
    const pubDef2 = deferred<any>();

    mocks.listPlatformPaperPublications.mockImplementation((id: string) => {
      if (id === "paper-1") return pubDef1.promise;
      if (id === "paper-2") return pubDef2.promise;
      return Promise.resolve({ publications: [] });
    });

    render(<PapersWorkspace />);

    // Initially loads paper-1
    await waitFor(() => expect(mocks.listPlatformPaperPublications).toHaveBeenCalledWith("paper-1"));

    // User switches to paper-2
    const paper2Button = await screen.findByRole("button", { name: /Second Exam/ });
    fireEvent.click(paper2Button);

    await waitFor(() => expect(mocks.listPlatformPaperPublications).toHaveBeenCalledWith("paper-2"));

    // Now resolve paper-2 with its publication
    pubDef2.resolve({
      publications: [
        {
          id: "pub-2",
          paper_id: "paper-2",
          title: "Publication for Paper Two",
          status: "active",
          class_ids: ["c2"],
          class_names: ["Physics Class"],
          student_names: [],
          attempt_count: 0,
          submitted_count: 0,
          proctor_event_count: 0,
        },
      ],
    });

    await screen.findByText("Publication for Paper Two");

    // Later, the delayed response for paper-1 arrives
    pubDef1.resolve({
      publications: [
        {
          id: "pub-1",
          paper_id: "paper-1",
          title: "Late Stale Publication for Paper One",
          status: "active",
          class_ids: ["c1"],
          class_names: ["Math Class"],
          student_names: [],
          attempt_count: 0,
          submitted_count: 0,
          proctor_event_count: 0,
        },
      ],
    });

    // The late response for paper-1 must NOT appear or overwrite paper-2's publications
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Late Stale Publication for Paper One")).toBeNull();
    expect(screen.getByText("Publication for Paper Two")).toBeInTheDocument();
  });

  it("reloads the same paper for a new project scope and drops the old response", async () => {
    const oldScope = deferred<any>();
    const newScope = deferred<any>();
    let switched = false;
    mocks.listPlatformPaperPublications.mockImplementation(() =>
      switched ? newScope.promise : oldScope.promise,
    );

    const { rerender } = render(
      <PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} />,
    );

    await waitFor(() => expect(mocks.listPlatformPaperPublications).toHaveBeenCalledWith("paper-1"));
    const oldScopeCallCount = mocks.listPlatformPaperPublications.mock.calls.length;

    switched = true;
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "project-beta" }} />);
    await waitFor(() =>
      expect(mocks.listPlatformPaperPublications.mock.calls.length).toBeGreaterThan(oldScopeCallCount),
    );

    await act(async () => {
      newScope.resolve({
        publications: [
          {
            id: "pub-new-scope",
            paper_id: "paper-1",
            title: "New Scope Publication",
            status: "active",
            class_ids: ["new-class"],
            class_names: ["New Scope Class"],
            student_names: [],
            attempt_count: 0,
            submitted_count: 0,
            proctor_event_count: 0,
          },
        ],
      });
    });

    await screen.findByText("New Scope Publication");

    await act(async () => {
      oldScope.resolve({
        publications: [
          {
            id: "pub-old-scope",
            paper_id: "paper-1",
            title: "Old Scope Publication",
            status: "active",
            class_ids: ["old-class"],
            class_names: ["Old Scope Class"],
            student_names: [],
            attempt_count: 0,
            submitted_count: 0,
            proctor_event_count: 0,
          },
        ],
      });
    });

    expect(screen.queryByText("Old Scope Publication")).toBeNull();
    expect(screen.getByText("New Scope Publication")).toBeInTheDocument();
  });

  it("reloads the same paper for a new session and rejects the old publication response", async () => {
    localStorage.setItem("solaire.platform.session", "session-alpha");
    const newProfile = deferred<any>();
    const oldPublication = deferred<any>();
    const newPublication = deferred<any>();
    let profileCall = 0;
    let publicationCall = 0;
    mocks.getAccountProfile.mockImplementation(() => {
      profileCall += 1;
      return profileCall === 1
        ? Promise.resolve({ profile: { id: "teacher-alpha", subjects: ["Math"] } })
        : newProfile.promise;
    });
    mocks.listPlatformPaperPublications.mockImplementation(() => {
      publicationCall += 1;
      if (publicationCall === 1) return Promise.resolve({ publications: [
        {
          id: "pub-alpha", paper_id: "paper-1", title: "Alpha Publication", status: "active",
          class_ids: ["alpha-class"], class_names: ["Alpha Class"], student_names: [],
          attempt_count: 0, submitted_count: 0, proctor_event_count: 0,
        },
      ] });
      return publicationCall === 2 ? oldPublication.promise : newPublication.promise;
    });

    const scope = { ready: true as const, value: "shared-project" };
    const { rerender } = render(<PapersWorkspace projectScope={scope} />);
    await screen.findByText("Alpha Publication");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(publicationCall).toBe(2));

    localStorage.setItem("solaire.platform.session", "session-beta");
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "shared-project" }} />);
    expect(screen.queryByText("Alpha Publication")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载当前账号数据");
    await waitFor(() => expect(mocks.getAccountProfile).toHaveBeenCalledTimes(2));

    await act(async () => {
      newProfile.resolve({ profile: { id: "teacher-beta", subjects: ["Physics"] } });
    });
    await waitFor(() => expect(publicationCall).toBeGreaterThan(2));
    await act(async () => {
      newPublication.resolve({ publications: [
        {
          id: "pub-beta", paper_id: "paper-1", title: "Beta Publication", status: "active",
          class_ids: ["beta-class"], class_names: ["Beta Class"], student_names: [],
          attempt_count: 0, submitted_count: 0, proctor_event_count: 0,
        },
      ] });
    });
    await screen.findByText("Beta Publication");

    await act(async () => {
      oldPublication.resolve({ publications: [
        {
          id: "pub-late-alpha", paper_id: "paper-1", title: "Late Alpha Publication", status: "active",
          class_ids: ["alpha-class"], class_names: ["Alpha Class"], student_names: [],
          attempt_count: 0, submitted_count: 0, proctor_event_count: 0,
        },
      ] });
    });
    expect(screen.queryByText("Late Alpha Publication")).toBeNull();
    expect(screen.getByText("Beta Publication")).toBeInTheDocument();
  });

  it("ignores an account profile response from the previous session", async () => {
    localStorage.setItem("solaire.platform.session", "session-alpha");
    const oldProfile = deferred<any>();
    const newProfile = deferred<any>();
    let profileCall = 0;
    mocks.getAccountProfile.mockImplementation(() => {
      profileCall += 1;
      return profileCall === 1 ? oldProfile.promise : newProfile.promise;
    });

    const { rerender } = render(
      <PapersWorkspace projectScope={{ ready: true, value: "shared-project" }} />,
    );
    await waitFor(() => expect(mocks.getAccountProfile).toHaveBeenCalledTimes(1));

    localStorage.setItem("solaire.platform.session", "session-beta");
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "shared-project" }} />);
    await waitFor(() => expect(mocks.getAccountProfile).toHaveBeenCalledTimes(2));

    await act(async () => {
      oldProfile.resolve({ profile: { id: "teacher-alpha", subjects: ["Math"] } });
    });
    expect(screen.getByRole("status")).toHaveTextContent("正在加载当前账号数据");
    expect(mocks.listPlatformPapers).not.toHaveBeenCalled();

    await act(async () => {
      newProfile.resolve({ profile: { id: "teacher-beta", subjects: ["Physics"] } });
    });
    await waitFor(() => expect(mocks.listPlatformPapers).toHaveBeenCalled());
  });

  it("drops late submission response when user switches paper during grading load", async () => {
    mocks.listPlatformPaperPublications.mockResolvedValue({ publications: [] });

    const subDef1 = deferred<any>();
    const subDef2 = deferred<any>();

    mocks.listPaperSubmissions.mockImplementation((id: string) => {
      if (id === "paper-1") return subDef1.promise;
      if (id === "paper-2") return subDef2.promise;
      return Promise.resolve({ submissions: [] });
    });

    render(<PapersWorkspace />);

    // Go to grading view for paper-1
    const gradingTab = await screen.findByTestId("paper-tab-grading");
    fireEvent.click(gradingTab);

    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledWith("paper-1"));

    // While paper-1 submissions are still in flight, teacher switches to paper-2
    const paper2Button = screen.getByRole("button", { name: /Second Exam/ });
    fireEvent.click(paper2Button);

    // Re-enter grading view for paper-2
    fireEvent.click(screen.getByTestId("paper-tab-grading"));
    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledWith("paper-2"));

    // Resolve paper-2 with its submission
    subDef2.resolve({
      submissions: [
        {
          attempt_id: "att-2",
          paper_id: "paper-2",
          student_id: "s2",
          student_no: "S002",
          student_name: "Physics Student",
          status: "submitted",
          score: 80,
          answers: [],
        },
      ],
    });

    await screen.findByText("Physics Student");

    // Later, delayed paper-1 submission response returns
    subDef1.resolve({
      submissions: [
        {
          attempt_id: "att-1",
          paper_id: "paper-1",
          student_id: "s1",
          student_no: "S001",
          student_name: "Late Stale Math Student",
          status: "submitted",
          score: 95,
          answers: [],
        },
      ],
    });

    // Late response must not overwrite current paper-2 submissions
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Late Stale Math Student")).toBeNull();
    expect(screen.getByText("Physics Student")).toBeInTheDocument();
  });

  it("invalidates in-flight submission request when projectScope changes", async () => {
    mocks.listPlatformPaperPublications.mockResolvedValue({ publications: [] });
    const subDef = deferred<any>();
    mocks.listPaperSubmissions.mockReturnValueOnce(subDef.promise).mockResolvedValue({ submissions: [] });

    const { rerender } = render(
      <PapersWorkspace projectScope={{ ready: true, value: "project-alpha" }} />,
    );

    const gradingTab = await screen.findByTestId("paper-tab-grading");
    fireEvent.click(gradingTab);

    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledWith("paper-1"));

    // Switch project scope to project-beta
    rerender(<PapersWorkspace projectScope={{ ready: true, value: "project-beta" }} />);
    await waitFor(() => expect(mocks.listPaperSubmissions).toHaveBeenCalledTimes(2));

    // Now resolve the late submissions that belonged to project-alpha
    subDef.resolve({
      submissions: [
        {
          attempt_id: "att-old",
          paper_id: "paper-1",
          student_id: "s1",
          student_no: "S001",
          student_name: "Old Project Alpha Student",
          status: "submitted",
          score: 90,
          answers: [],
        },
      ],
    });

    // Old project's student must NOT be admitted into the new project scope
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Old Project Alpha Student")).toBeNull();
  });
});
