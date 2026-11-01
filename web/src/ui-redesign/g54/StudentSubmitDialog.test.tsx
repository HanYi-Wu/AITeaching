import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StudentSubmitDialog } from "./StudentSubmitDialog";

function DialogHarness({ submitting = false, onConfirm = vi.fn() }: { submitting?: boolean; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开提交确认
      </button>
      <StudentSubmitDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={onConfirm}
        submitting={submitting}
        answeredCount={2}
        questionCount={3}
        remainingSeconds={60}
        saveStatus="saved"
      />
    </>
  );
}

describe("StudentSubmitDialog keyboard behavior", () => {
  it("traps focus, dismisses with Escape, and restores focus to its opener", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole("button", { name: "打开提交确认" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "提交前确认" });
    const continueButton = screen.getByRole("button", { name: "继续检查" });
    const confirmButton = screen.getByRole("button", { name: "确认提交" });
    expect(dialog).toHaveAccessibleDescription("提交后不能撤回，请核对答题进度。");
    expect(continueButton).toHaveFocus();

    await user.keyboard("{Tab}");
    expect(confirmButton).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(continueButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Escape and outside clicks from closing while submitting", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <StudentSubmitDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        submitting
        answeredCount={2}
        questionCount={3}
        remainingSeconds={60}
        saveStatus="saving"
      />,
    );

    await user.keyboard("{Escape}");
    await user.click(document.querySelector(".or-g54-dialog-backdrop") as HTMLElement);

    expect(screen.getByRole("dialog", { name: "提交前确认" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "继续检查" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  });
});
