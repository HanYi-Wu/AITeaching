import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { selectOption } from "../../../../test/selectOption";
import { SchoolExportDialog } from "./SchoolExportDialog";

const mocks = vi.hoisted(() => ({
  listClasses: vi.fn(), listPlatformPapers: vi.fn(), exportStudentAccounts: vi.fn(), getSchoolPaperExportOptions: vi.fn(),
  downloadPaperAnalysisReport: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("../../../../platform/auth", () => mocks);
vi.mock("../hooks/useSchoolWorkspaceData", () => ({ downloadBlob: mocks.downloadBlob }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listClasses.mockResolvedValue({ classes: [{ id: "c1", name: "一班", grade: "高一" }], total_pages: 1 });
  mocks.listPlatformPapers.mockResolvedValue({ papers: [{ paper_id: "p1", title: "期中", subject: "数学" }], total_pages: 1 });
  mocks.getSchoolPaperExportOptions.mockResolvedValue({ publications: [{ id: "pub1", title: "期中发布", status: "published", created_at: "2026-11-02", classes: [{ id: "c1", name: "一班", grade: "高一" }] }] });
  mocks.exportStudentAccounts.mockResolvedValue(new Blob(["accounts"]));
  mocks.downloadPaperAnalysisReport.mockResolvedValue(new Blob(["analysis"]));
});

it("exports the chosen class account list without including other classes", async () => {
  const onClose = vi.fn();
  render(<SchoolExportDialog kind="accounts" onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出班级" })).toBeEnabled());
  await selectOption(screen.getByRole("combobox", { name: "导出班级" }), "c1");
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  await waitFor(() => expect(mocks.exportStudentAccounts).toHaveBeenCalledWith("c1"));
  expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "学生账号_一班.xlsx");
  expect(onClose).toHaveBeenCalledOnce();
});

it("exports the chosen paper and class through the existing report permission checks", async () => {
  render(<SchoolExportDialog kind="analysis" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出试卷" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "确认导出" })).toBeDisabled();
  await selectOption(screen.getByRole("combobox", { name: "导出试卷" }), "p1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出班级" })).toBeEnabled());
  await selectOption(screen.getByRole("combobox", { name: "导出班级" }), "c1");
  await selectOption(screen.getByRole("combobox", { name: "导出格式" }), "pdf");
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith("p1", "pdf", "pub1", "c1"));
});

it("keeps an older class tied to its selected publication and resets class on publication changes", async () => {
  mocks.getSchoolPaperExportOptions.mockResolvedValue({ publications: [
    { id: "new", title: "新发布", status: "published", created_at: "2026-11-02", classes: [{ id: "c2", name: "二班" }] },
    { id: "old", title: "旧发布", status: "published", created_at: "2026-10-01", classes: [{ id: "c1", name: "一班" }] },
  ] });
  render(<SchoolExportDialog kind="analysis" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出试卷" })).toBeEnabled());
  await selectOption(screen.getByRole("combobox", { name: "导出试卷" }), "p1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出发布记录" })).toBeEnabled());
  await selectOption(screen.getByRole("combobox", { name: "导出发布记录" }), "old");
  await selectOption(screen.getByRole("combobox", { name: "导出班级" }), "c1");
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  await waitFor(() => expect(mocks.downloadPaperAnalysisReport).toHaveBeenCalledWith("p1", "xlsx", "old", "c1"));
});

it("loads class choices beyond the first page", async () => {
  mocks.listClasses.mockResolvedValueOnce({ classes: [{ id: "c1", name: "一班" }], total_pages: 2 })
    .mockResolvedValueOnce({ classes: [{ id: "c2", name: "二班" }], total_pages: 2 });
  render(<SchoolExportDialog kind="accounts" onClose={vi.fn()} />);
  await waitFor(() => expect(mocks.listClasses).toHaveBeenCalledWith({ page: 2, pageSize: 100 }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "导出班级" })).toBeEnabled());
  await selectOption(screen.getByRole("combobox", { name: "导出班级" }), "c2");
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  await waitFor(() => expect(mocks.exportStudentAccounts).toHaveBeenCalledWith("c2"));
});

it("keeps the selection and window available when exporting fails", async () => {
  mocks.exportStudentAccounts.mockRejectedValue(new Error("暂时无法导出"));
  const onClose = vi.fn();
  render(<SchoolExportDialog kind="accounts" onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "确认导出" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法导出");
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认导出" })).toBeEnabled();
});

it("does not download a result after the account or window has been closed", async () => {
  let resolve!: (blob: Blob) => void;
  mocks.exportStudentAccounts.mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
  const { unmount } = render(<SchoolExportDialog kind="accounts" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "确认导出" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "确认导出" }));
  await waitFor(() => expect(mocks.exportStudentAccounts).toHaveBeenCalledOnce());
  unmount();
  resolve(new Blob(["old account"]));
  await Promise.resolve();
  expect(mocks.downloadBlob).not.toHaveBeenCalled();
});
