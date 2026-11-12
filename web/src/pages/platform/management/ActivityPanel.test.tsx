import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformUser } from "../../../platform/authTypes";
import { loadSessionToken } from "../../../platform/session";
import {
  getManagementActivity,
  getManagementOptions,
  type ManagementActivity,
  type ManagementOptions,
} from "../../../platform/managementApi";
import { ActivityPanel } from "./ActivityPanel";

vi.mock("../../../platform/managementApi", () => ({
  getManagementActivity: vi.fn(),
  getManagementOptions: vi.fn(),
}));
vi.mock("../../../platform/session", () => ({ loadSessionToken: vi.fn() }));

const activity = (schoolId = "school-1", schoolName = "甲学校", count = 3): ManagementActivity => ({
  metric: "management_activity",
  timezone: "Asia/Shanghai",
  date_from: "2026-07-02",
  date_to: "2026-07-02",
  summary: { operation_count: count, active_accounts: count ? 1 : 0, active_schools: count ? 1 : 0 },
  days: [{ date: "2026-07-02", operation_count: count, active_accounts: count ? 1 : 0 }],
  schools: [
    { school_id: "school-1", school_name: "甲学校", operation_count: schoolId === "school-1" ? count : 0, active_accounts: schoolId === "school-1" && count ? 1 : 0 },
    { school_id: "school-2", school_name: "乙学校", operation_count: schoolId === "school-2" ? count : 0, active_accounts: schoolId === "school-2" && count ? 1 : 0 },
  ],
  heatmap: {
    rows: [{ school_id: schoolId, school_name: schoolName }],
    columns: ["2026-07-02"],
    matrix: [[count]],
  },
  coverage: { started_at: "2026-06-01T00:00:00.000Z", description: "管理操作从 2026-06-01 起记录；仅统计成功的管理操作。" },
});

const options = (activityDefaultDays: 7 | 30 | 90 = 30): ManagementOptions => ({
  settings: { default_page_size: 25, activity_default_days: activityDefaultDays },
  subjects: [],
  grades: [],
});

const adminUser = (id = "admin-1"): PlatformUser => ({
  id,
  role: "admin",
  username: id,
  display_name: "管理员",
  status: "active",
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

describe("ActivityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadSessionToken).mockReturnValue("session-a");
    vi.mocked(getManagementOptions).mockResolvedValue(options());
    vi.mocked(getManagementActivity).mockResolvedValue(activity());
  });

  it("uses the saved activity window, lets admins filter by a complete school list, and exposes heatmap cells accessibly", async () => {
    vi.mocked(getManagementOptions).mockResolvedValue(options(7));
    render(<ActivityPanel user={adminUser()} scope="admin" />);

    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledWith("admin", { days: 7 }));
    expect(await screen.findByRole("cell", { name: "甲学校，2026-07-02，3 次管理操作" })).toBeInTheDocument();
    expect(screen.getByText("成功操作（含平台）")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("学校范围"), { target: { value: "school-2" } });
    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledWith("admin", { days: 7, school_id: "school-2" }));
  });

  it("ignores activity responses from a previously selected account", async () => {
    const oldRequest = deferred<ManagementActivity>();
    const currentRequest = deferred<ManagementActivity>();
    vi.mocked(getManagementActivity)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const view = render(<ActivityPanel user={adminUser("admin-old")} scope="admin" />);
    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledTimes(1));

    view.rerender(<ActivityPanel user={adminUser("admin-current")} scope="admin" />);
    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledTimes(2));
    await act(async () => currentRequest.resolve(activity("school-2", "当前学校", 6)));
    expect(await screen.findByRole("cell", { name: "当前学校，2026-07-02，6 次管理操作" })).toBeInTheDocument();
    await act(async () => oldRequest.resolve(activity("school-1", "旧账号学校", 9)));
    expect(screen.queryByText("旧账号学校")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "当前学校，2026-07-02，6 次管理操作" })).toBeInTheDocument();
  });

  it("invalidates requests when the session changes for the same account", async () => {
    const previousSession = deferred<ManagementActivity>();
    const currentSession = deferred<ManagementActivity>();
    vi.mocked(getManagementActivity)
      .mockReturnValueOnce(previousSession.promise)
      .mockReturnValueOnce(currentSession.promise);
    const view = render(<ActivityPanel user={adminUser()} scope="admin" />);
    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledTimes(1));

    vi.mocked(loadSessionToken).mockReturnValue("session-b");
    view.rerender(<ActivityPanel user={adminUser()} scope="admin" />);
    await waitFor(() => expect(getManagementActivity).toHaveBeenCalledTimes(2));
    await act(async () => currentSession.resolve(activity("school-2", "新会话学校", 5)));
    expect(await screen.findByRole("cell", { name: "新会话学校，2026-07-02，5 次管理操作" })).toBeInTheDocument();
    await act(async () => previousSession.resolve(activity("school-1", "旧会话学校", 8)));
    expect(screen.queryByText("旧会话学校")).not.toBeInTheDocument();
  });

  it("renders only twenty school rows at a time in the heatmap", async () => {
    const schools = Array.from({ length: 21 }, (_, index) => ({
      school_id: `school-${index + 1}`,
      school_name: `学校${index + 1}`,
      operation_count: 1,
      active_accounts: 1,
    }));
    vi.mocked(getManagementActivity).mockResolvedValue({
      ...activity(),
      schools,
      heatmap: {
        rows: schools.map(({ school_id, school_name }) => ({ school_id, school_name })),
        columns: Array.from({ length: 90 }, (_, index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)),
        matrix: schools.map(() => Array.from({ length: 90 }, () => 1)),
      },
    });
    render(<ActivityPanel user={adminUser()} scope="admin" />);

    expect(await screen.findByRole("rowheader", { name: "学校20" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "学校21" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("rowheader", { name: "学校21" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "学校1" })).not.toBeInTheDocument();
  });

  it("shows a retry after an activity failure", async () => {
    vi.mocked(getManagementActivity)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(activity());
    render(<ActivityPanel user={adminUser()} scope="admin" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("管理活动暂时无法加载");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("cell", { name: "甲学校，2026-07-02，3 次管理操作" })).toBeInTheDocument();
  });
});
