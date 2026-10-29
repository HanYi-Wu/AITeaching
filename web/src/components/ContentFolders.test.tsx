import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentFolders } from "./ContentFolders";
import { CONTENT_ITEMS_MIME, CONTENT_ITEM_MIME } from "../lib/contentSelection";

const mocks = vi.hoisted(() => ({ deleteFolder: vi.fn() }));
vi.mock("../platform/auth", async (importOriginal) => ({ ...await importOriginal<typeof import("../platform/auth")>(), deleteContentFolder: mocks.deleteFolder }));
const folder = { id: "test-folder", name: "验证目录", parent_id: null, kind: "category" as const, scope: "compose" as const, owner_teacher_id: "t1" };

describe("folder deletion", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("explains that content is retained and cancellation leaves the folder alone", () => {
    render(<ContentFolders scope="compose" folders={[folder]} selectedId={folder.id} onSelect={vi.fn()} onCreated={vi.fn()} onDeleted={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    expect(screen.getByRole("alertdialog", { name: "删除文件夹" })).toHaveTextContent("源文件不会删除");
    fireEvent.click(screen.getByRole("button", { name: "取消删除" }));
    expect(mocks.deleteFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("refreshes folders and content assignments after confirmation", async () => {
    const result = { folders: [], items: {}, parent_id: null };
    mocks.deleteFolder.mockResolvedValue(result);
    const onDeleted = vi.fn();
    const onSelect = vi.fn();
    render(<ContentFolders scope="compose" folders={[folder]} selectedId={folder.id} onSelect={onSelect} onCreated={vi.fn()} onDeleted={onDeleted} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(result));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(mocks.deleteFolder).toHaveBeenCalledWith(folder.id);
  });
});

describe("content drops", () => {
  it("forwards a same-scope bulk payload as one drop operation", () => {
    const onDropItems = vi.fn();
    const dataTransfer = {
      types: [CONTENT_ITEMS_MIME],
      getData: (type: string) => type === CONTENT_ITEMS_MIME ? JSON.stringify({ scope: "compose", ids: ["exam-1", "exam-2"] }) : "",
    };
    render(<ContentFolders scope="compose" folders={[folder]} selectedId={folder.id} onSelect={vi.fn()} onCreated={vi.fn()} onDeleted={vi.fn()} onDropItems={onDropItems} onError={vi.fn()} />);

    fireEvent.drop(screen.getByTitle("验证目录 · 归类文件夹"), { dataTransfer });

    expect(onDropItems).toHaveBeenCalledWith(["exam-1", "exam-2"], folder.id);
  });

  it("continues to accept the legacy single-item drag payload", () => {
    const onDropItem = vi.fn();
    const dataTransfer = {
      types: [CONTENT_ITEM_MIME],
      getData: (type: string) => type === CONTENT_ITEM_MIME ? JSON.stringify({ scope: "compose", id: "exam-1" }) : "",
    };
    render(<ContentFolders scope="compose" folders={[folder]} selectedId={folder.id} onSelect={vi.fn()} onCreated={vi.fn()} onDeleted={vi.fn()} onDropItem={onDropItem} onError={vi.fn()} />);

    fireEvent.drop(screen.getByTitle("验证目录 · 归类文件夹"), { dataTransfer });

    expect(onDropItem).toHaveBeenCalledWith("exam-1", folder.id);
  });
});
