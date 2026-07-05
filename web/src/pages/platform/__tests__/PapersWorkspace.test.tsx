import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PapersWorkspace } from "../PapersWorkspace";

const mocks = vi.hoisted(() => ({
  listPlatformPaperPublications: vi.fn(),
  listPlatformPapers: vi.fn(),
  listTeacherAssignedClasses: vi.fn(),
  updatePlatformPaperDeliveryMode: vi.fn(),
  publishPlatformPaper: vi.fn(),
  revokePlatformPaperPublication: vi.fn(),
  uploadPaperScores: vi.fn(),
  analyzePlatformPaper: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    listPlatformPaperPublications: mocks.listPlatformPaperPublications,
    listPlatformPapers: mocks.listPlatformPapers,
    listTeacherAssignedClasses: mocks.listTeacherAssignedClasses,
    updatePlatformPaperDeliveryMode: mocks.updatePlatformPaperDeliveryMode,
    publishPlatformPaper: mocks.publishPlatformPaper,
    revokePlatformPaperPublication: mocks.revokePlatformPaperPublication,
    uploadPaperScores: mocks.uploadPaperScores,
    analyzePlatformPaper: mocks.analyzePlatformPaper,
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

describe("PapersWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTeacherAssignedClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: "Math", subject: "Math" }],
    });
    mocks.listPlatformPaperPublications.mockResolvedValue({ publications: [] });
  });

  it("lists exported papers and updates online/offline delivery mode", async () => {
    mocks.listPlatformPapers.mockResolvedValue({ papers: [offlinePaper] });
    mocks.updatePlatformPaperDeliveryMode.mockResolvedValue({
      paper: { ...offlinePaper, delivery_mode: "online", status: "draft" },
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("线下").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "设为线上" }));

    await waitFor(() => expect(mocks.updatePlatformPaperDeliveryMode).toHaveBeenCalledWith("p1", "online"));
    expect((await screen.findAllByText("线上")).length).toBeGreaterThan(0);
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
    await userEvent.click(screen.getByRole("button", { name: "发布到班级" }));

    await waitFor(() =>
      expect(mocks.publishPlatformPaper).toHaveBeenCalledWith("p1", {
        class_ids: ["c1"],
        title: "Midterm",
      }),
    );
    expect((await screen.findAllByText("已发布")).length).toBeGreaterThan(0);
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
        },
      ],
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
        proctoring: { screen_switch_count: 2, screen_switch_duration_ms: 3000, flagged_student_count: 1 },
        students: [],
      },
    });

    render(<PapersWorkspace />);

    expect((await screen.findAllByText("Midterm")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("paper-load-analysis"));

    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("p1"));
    expect(await screen.findByTestId("paper-analysis-completion-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("paper-analysis-switch-count")).toHaveTextContent("2");
    expect(screen.getByTestId("paper-analysis-flagged-count")).toHaveTextContent("1");
  });
});
