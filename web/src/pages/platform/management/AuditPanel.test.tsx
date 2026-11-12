import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPanel } from "./AuditPanel";

const mocks = vi.hoisted(() => ({ listSchools: vi.fn(), listManagementAudit: vi.fn() }));

vi.mock("../../../platform/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/auth")>()),
  listSchools: mocks.listSchools,
}));
vi.mock("../../../platform/managementApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/managementApi")>()),
  listManagementAudit: mocks.listManagementAudit,
}));

const event = {
  id: "evt-1", occurred_at: "2026-11-08T10:00:00Z", actor_id: "u1", actor_role: "school", actor_name: "学校管理员",
  actor_school_id: "s1", school_id: "s1", school_name: "示范学校", action: "school.user.update", action_label: "更新账号",
  resource_type: "user", resource_id: "u2", outcome: "success" as const, affected_count: 1, request_id: "req-1",
  http_status: 200, method: "PATCH", route_path: "/api/school/management/users/u2",
};

describe("AuditPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSchools.mockResolvedValue({ schools: [{ id: "s1", name: "示范学校" }], total_pages: 1 });
    mocks.listManagementAudit.mockResolvedValue({ events: [event], actions: [{ key: "school.user.update", label: "更新账号" }], total: 1, page: 1, page_size: 20, total_pages: 1 });
  });

  it("shows read only event details and scopes administrator filters to the selected school", async () => {
    const user = userEvent.setup();
    render(<AuditPanel user={{ id: "admin", role: "admin", username: "admin", display_name: "管理员", status: "active" }} scope="admin" />);

    const table = screen.getByRole("table");
    expect(await within(table).findByText("更新账号")).toBeInTheDocument();
    await screen.findByRole("option", { name: "示范学校" });
    await user.selectOptions(screen.getByRole("combobox", { name: "按学校筛选日志" }), "s1");
    await waitFor(() => expect(mocks.listManagementAudit).toHaveBeenLastCalledWith("admin", expect.objectContaining({ school_id: "s1", page: 1, pageSize: 20 })));
    await user.click(screen.getByRole("button", { name: "查看" }));
    expect(await screen.findByRole("dialog", { name: "日志详情" })).toBeInTheDocument();
    expect(screen.getByText("PATCH /api/school/management/users/u2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除|清空/ })).not.toBeInTheDocument();
  });

  it("does not send a school filter from a school scoped view", async () => {
    render(<AuditPanel user={{ id: "school", role: "school", school_id: "s1", username: "school", display_name: "校管", status: "active" }} scope="school" />);
    await within(screen.getByRole("table")).findByText("更新账号");
    expect(mocks.listManagementAudit).toHaveBeenCalledWith("school", { page: 1, pageSize: 20 });
    expect(screen.queryByRole("combobox", { name: "按学校筛选日志" })).not.toBeInTheDocument();
  });
});
