import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "../../../../lib/confirmDialog";
import { deleteClass } from "../../../../platform/auth";
import type { PageMeta, PageQuery } from "../SchoolControls";
import { ClassesMainPanel } from "./ClassesPanel";

const mocks = vi.hoisted(() => ({ deleteClass: vi.fn(), updateClass: vi.fn() }));
vi.mock("../../../../platform/auth", () => mocks);
vi.mock("../../../../lib/confirmDialog", () => ({ confirmDialog: vi.fn() }));

const classRecord = {
  id: "class-1",
  school_id: "school-1",
  name: "高一 1 班",
  grade: "高一",
  student_count: 24,
  teacher_count: 3,
};
const classMeta: PageMeta = { total: 1, page: 1, pageSize: 10, totalPages: 1 };
const classQuery: PageQuery = { q: "", page: 1, pageSize: 10 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function panel(run: (action: () => Promise<void>) => Promise<void>, classes = [classRecord]) {
  return (
    <ClassesMainPanel
      classes={classes}
      classMeta={classMeta}
      classQuery={classQuery}
      setClassQuery={vi.fn()}
      classDrafts={{ [classRecord.id]: { name: classRecord.name, grade: classRecord.grade } }}
      setClassDrafts={vi.fn()}
      busy={false}
      run={run}
    />
  );
}

function renderPanel(run: (action: () => Promise<void>) => Promise<void>, classes = [classRecord]) {
  return render(panel(run, classes));
}

describe("ClassesMainPanel class deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteClass.mockResolvedValue({ ok: true, deleted: classRecord.id });
  });

  it("explains the class-level cascades and does nothing when deletion is canceled", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValue(confirmation.promise);
    const run = vi.fn(async (action: () => Promise<void>) => action());

    renderPanel(run);
    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.stringContaining("删除“高一 1 班”后，该班学生会失去当前班级归属，教师班级分配和面向该班的试卷发布关联会被清除"),
      "确认删除班级",
    );
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.stringContaining("学生、教师、试卷以及已有考试记录和答卷会保留"),
      expect.any(String),
    );
    expect(screen.getByRole("button", { name: "删除班级" })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
    expect(deleteClass).not.toHaveBeenCalled();

    await act(async () => confirmation.resolve(false));
    await waitFor(() => expect(screen.getByRole("button", { name: "删除班级" })).toBeEnabled());
    expect(run).not.toHaveBeenCalled();
    expect(deleteClass).not.toHaveBeenCalled();
  });

  it("runs the existing delete path once after confirmation", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValue(confirmation.promise);
    const run = vi.fn(async (action: () => Promise<void>) => action());

    renderPanel(run);
    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));
    expect(confirmDialog).toHaveBeenCalledTimes(1);

    await act(async () => confirmation.resolve(true));
    await waitFor(() => expect(deleteClass).toHaveBeenCalledWith(classRecord.id));
    expect(run).toHaveBeenCalledTimes(1);
    expect(deleteClass).toHaveBeenCalledTimes(1);
  });

  it("ignores a pending confirmation if the panel unmounts", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValue(confirmation.promise);
    const run = vi.fn(async (action: () => Promise<void>) => action());
    const view = renderPanel(run);

    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => confirmation.resolve(true));

    expect(run).not.toHaveBeenCalled();
    expect(deleteClass).not.toHaveBeenCalled();
  });

  it("ignores a pending confirmation when the workspace data changes", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValue(confirmation.promise);
    const run = vi.fn(async (action: () => Promise<void>) => action());
    const nextRun = vi.fn(async (action: () => Promise<void>) => action());
    const view = renderPanel(run);

    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    view.rerender(panel(nextRun, [{ ...classRecord, id: "another-school-class" }]));
    await act(async () => confirmation.resolve(true));

    expect(run).not.toHaveBeenCalled();
    expect(nextRun).not.toHaveBeenCalled();
    expect(deleteClass).not.toHaveBeenCalled();
  });

  it("runs a valid confirmation after the same class is refreshed", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValue(confirmation.promise);
    const run = vi.fn(async (action: () => Promise<void>) => action());
    const nextRun = vi.fn(async (action: () => Promise<void>) => action());
    const view = renderPanel(run);

    fireEvent.click(screen.getByRole("button", { name: "删除班级" }));
    view.rerender(panel(nextRun, [{ ...classRecord }]));
    await act(async () => confirmation.resolve(true));

    expect(run).not.toHaveBeenCalled();
    expect(nextRun).toHaveBeenCalledTimes(1);
    expect(deleteClass).toHaveBeenCalledWith(classRecord.id);
  });
});
