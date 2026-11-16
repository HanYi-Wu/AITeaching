import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformUser } from "../../platform/authTypes";
import { PlatformAccountDialog } from "./PlatformAccountDialog";

const mocks = vi.hoisted(() => ({
  applyAppearance: vi.fn(),
  getAccountProfile: vi.fn(),
  loadSessionToken: vi.fn(),
  saveAppearance: vi.fn(),
  saveLoginAppearance: vi.fn(),
  updateAccountCredentials: vi.fn(),
  updateAccountProfile: vi.fn(),
}));

vi.mock("../../platform/session", () => ({
  loadSessionToken: () => mocks.loadSessionToken(),
}));

vi.mock("../../platform/paperApi", () => ({
  getAccountProfile: (...args: unknown[]) => mocks.getAccountProfile(...args),
  updateAccountCredentials: (...args: unknown[]) => mocks.updateAccountCredentials(...args),
  updateAccountProfile: (...args: unknown[]) => mocks.updateAccountProfile(...args),
}));

vi.mock("../../design-system/appearance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../design-system/appearance")>();
  return {
    ...actual,
    applyAppearance: (...args: unknown[]) => mocks.applyAppearance(...args),
    saveAppearance: (...args: unknown[]) => mocks.saveAppearance(...args),
    saveLoginAppearance: (...args: unknown[]) => mocks.saveLoginAppearance(...args),
  };
});

function user(id: string, preferences: PlatformUser["preferences"] = { theme: "classic", density: "comfortable", font_scale: 1 }): PlatformUser {
  return {
    id,
    role: "admin",
    username: id,
    display_name: id,
    status: "active",
    preferences,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function TestDialog({ accountUser, onProfileUpdated }: { accountUser: PlatformUser; onProfileUpdated: (user: PlatformUser) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <PlatformAccountDialog
      accountUser={accountUser}
      open={open}
      onOpenChange={setOpen}
      onProfileUpdated={onProfileUpdated}
      trigger={<button type="button" aria-label="打开个人设置">个人设置</button>}
    />
  );
}

function renderDialog(accountUser = user("admin-a"), onProfileUpdated = vi.fn()) {
  return {
    onProfileUpdated,
    ...render(<TestDialog accountUser={accountUser} onProfileUpdated={onProfileUpdated} />),
  };
}

async function openDialog() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "打开个人设置" }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PlatformAccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.loadSessionToken.mockReturnValue("token-a");
    mocks.getAccountProfile.mockImplementation(async () => ({ profile: user("admin-a") }));
    mocks.updateAccountCredentials.mockResolvedValue({ user: user("admin-a") });
    mocks.updateAccountProfile.mockImplementation(async (payload: { preferences: NonNullable<PlatformUser["preferences"]> }) => ({
      profile: user(mocks.loadSessionToken() === "token-b" ? "admin-b" : "admin-a", payload.preferences),
    }));
    mocks.saveAppearance.mockReturnValue(true);
    mocks.saveLoginAppearance.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes preference patches and sends the latest values after an in-flight save", async () => {
    vi.useFakeTimers();
    const firstSave = deferred<{ profile: PlatformUser }>();
    mocks.updateAccountProfile.mockReturnValueOnce(firstSave.promise);
    renderDialog();
    await openDialog();
    expect(screen.getByLabelText("表格密度")).toBeInTheDocument();
    expect(screen.queryByText(/实时生效/)).not.toBeInTheDocument();
    expect(screen.queryByText(/密码至少 6 位/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /绿色|Green/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateAccountProfile.mock.calls[0][0]).toEqual({
      preferences: { theme: "forest", density: "comfortable", font_scale: 1 },
    });

    fireEvent.change(screen.getByLabelText("表格密度"), { target: { value: "compact" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    await act(async () => {
      firstSave.resolve({ profile: user("admin-a", { theme: "forest", density: "comfortable", font_scale: 1 }) });
      await firstSave.promise;
    });
    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(2));
    expect(mocks.updateAccountProfile.mock.calls[1][0]).toEqual({
      preferences: { theme: "forest", density: "compact", font_scale: 1 },
    });
  });

  it("ignores a previous account's patch response after the session changes", async () => {
    vi.useFakeTimers();
    const firstSave = deferred<{ profile: PlatformUser }>();
    const secondProfile = deferred<{ profile: PlatformUser }>();
    mocks.getAccountProfile
      .mockResolvedValueOnce({ profile: user("admin-a") })
      .mockReturnValueOnce(secondProfile.promise);
    mocks.updateAccountProfile.mockReturnValueOnce(firstSave.promise);
    const view = renderDialog(user("admin-a"));
    await openDialog();

    fireEvent.click(screen.getByRole("radio", { name: /绿色|Green/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1);
    expect(mocks.saveAppearance).toHaveBeenCalledWith("admin-a", { mode: "light", accent: "green" });

    vi.useRealTimers();
    mocks.loadSessionToken.mockReturnValue("token-b");
    view.rerender(<TestDialog accountUser={user("admin-b")} onProfileUpdated={view.onProfileUpdated} />);
    await waitFor(() => expect(mocks.getAccountProfile).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("表格密度")).not.toBeInTheDocument();

    await act(async () => {
      secondProfile.resolve({ profile: user("admin-b", { theme: "classic", density: "comfortable", font_scale: 1 }) });
      await secondProfile.promise;
    });
    expect(screen.getByLabelText("表格密度")).toBeInTheDocument();
    const applyCountAfterNewProfile = mocks.applyAppearance.mock.calls.length;

    await act(async () => {
      firstSave.resolve({ profile: user("admin-a", { theme: "forest", density: "comfortable", font_scale: 1 }) });
      await firstSave.promise;
    });
    expect(mocks.applyAppearance).toHaveBeenCalledTimes(applyCountAfterNewProfile);
    expect(mocks.saveAppearance).toHaveBeenCalledTimes(1);
    expect(mocks.saveAppearance).not.toHaveBeenCalledWith("admin-b", expect.anything());
    expect(view.onProfileUpdated).not.toHaveBeenCalled();
  });

  it("clears password fields when the dialog closes", async () => {
    renderDialog();
    await openDialog();
    const currentPassword = await screen.findByLabelText("当前密码");
    fireEvent.click(screen.getByRole("radio", { name: /绿色|Green/i }));
    fireEvent.change(currentPassword, { target: { value: "old-secret" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-secret" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-secret" } });

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1));
    expect(mocks.updateAccountProfile.mock.calls[0][0]).toEqual({
      preferences: { theme: "forest", density: "comfortable", font_scale: 1 },
    });
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "打开个人设置" }));
    expect(await screen.findByLabelText("当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
  });

  it("shows a wrong-current-password error and preserves newer preferences on success", async () => {
    const pendingPreferenceSave = deferred<{ profile: PlatformUser }>();
    mocks.updateAccountProfile.mockReturnValueOnce(pendingPreferenceSave.promise);
    mocks.updateAccountCredentials
      .mockRejectedValueOnce(new Error("当前密码错误"))
      .mockResolvedValueOnce({ user: user("admin-a", { theme: "classic", density: "comfortable", font_scale: 1 }) });
    const onProfileUpdated = vi.fn();
    renderDialog(user("admin-a"), onProfileUpdated);
    await openDialog();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("radio", { name: /绿色|Green/i }));
    fireEvent.change(screen.getByLabelText("表格密度"), { target: { value: "compact" } });
    fireEvent.change(screen.getByLabelText("字号比例"), { target: { value: "1.1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateAccountProfile.mock.calls[0][0]).toEqual({
      preferences: { theme: "forest", density: "compact", font_scale: 1.1 },
    });
    vi.useRealTimers();

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "wrong-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前密码错误");
    expect(screen.getByLabelText("当前密码")).toHaveValue("wrong-password");

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByRole("status")).toHaveTextContent("登录密码已修改");
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: "admin-a",
      preferences: { theme: "forest", density: "compact", font_scale: 1.1 },
    }));
    expect(screen.getByLabelText("表格密度")).toHaveValue("compact");
    expect(screen.getByLabelText("字号比例")).toHaveValue("1.1");

    await act(async () => {
      pendingPreferenceSave.resolve({
        profile: user("admin-a", { theme: "forest", density: "compact", font_scale: 1.1 }),
      });
      await pendingPreferenceSave.promise;
    });
  });
});
