import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { platformRequest } from "../../../platform/platformRequest";
import { TeacherWorkbench } from "./TeacherWorkbench";

vi.mock("../../../platform/platformRequest", () => ({ platformRequest: vi.fn() }));

it("opens the exact paper and attempt from the scoped grading queue", async () => {
  vi.mocked(platformRequest).mockResolvedValue({ pending_total: 12, paper_total: 9, outstanding_attempts: 3,
    queue: [{ paper_id: "p-id", title: "单元测验", attempt_id: "a-id", pending_count: 2, submitted_at: null }] });
  const openGrading = vi.fn();
  render(<TeacherWorkbench onOpenGrading={openGrading} onOpenPapers={vi.fn()} onOpenStudents={vi.fn()} />);
  expect(await screen.findByText("12")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "批改 单元测验" }));
  expect(openGrading).toHaveBeenCalledWith({ paperId: "p-id", attemptId: "a-id", title: "单元测验" });
});
