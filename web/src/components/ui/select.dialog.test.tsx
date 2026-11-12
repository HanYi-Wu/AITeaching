import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Select } from "./select";

function NestedSelect() {
  const [open, setOpen] = useState(true);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [value, setValue] = useState("one");
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Portal><Dialog.Content ref={setContainer} aria-describedby={undefined}>
      <Dialog.Title>测试导出</Dialog.Title>
      <Select portalContainer={container} aria-label="班级" value={value} onValueChange={setValue}>
        <option value="one">一班</option><option value="two">二班</option>
      </Select>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

it("Escape closes the open select first, preserves the dialog and then closes the dialog", async () => {
  const user = userEvent.setup();
  render(<NestedSelect />);
  await user.click(screen.getByRole("combobox", { name: "班级" }));
  expect(await screen.findByRole("listbox")).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "班级" })).toHaveFocus();
  expect(screen.getByRole("dialog", { name: "测试导出" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "班级" })).toHaveTextContent("一班");
  await waitFor(() => expect(document.querySelector("[data-or-select-content]")).not.toBeInTheDocument());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("blocks stale option input while closing and allows reopening with keyboard", async () => {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const style = originalGetComputedStyle(element, pseudoElement);
    if (!(element instanceof HTMLElement) || !element.matches("[data-or-select-content]")) return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === "animationName") return element.dataset.state === "closed" ? "or-select-close" : "or-select-open";
        if (property === "display") return "block";
        return Reflect.get(target, property, target);
      },
    });
  });
  const user = userEvent.setup();
  try {
    render(<NestedSelect />);
    const trigger = screen.getByRole("combobox", { name: "班级" });

    await user.click(trigger);
    const listbox = await screen.findByRole("listbox");
    const firstOption = within(listbox).getByRole("option", { name: "一班" });
    const secondOption = within(listbox).getByRole("option", { name: "二班" });
    fireEvent.keyDown(firstOption, { key: "Escape" });

    // Keep Radix Presence in its exit state so this exercises the real close window.
    expect(listbox.isConnected).toBe(true);
    fireEvent.click(secondOption);
    expect(trigger).toHaveTextContent("一班");
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    const reopenedListbox = await screen.findByRole("listbox");
    await user.click(within(reopenedListbox).getByRole("option", { name: "二班" }));
    await waitFor(() => expect(trigger).toHaveTextContent("二班"));
    expect(trigger).toHaveFocus();

    await waitFor(() => expect(document.querySelector("[data-or-select-content]")).not.toBeInTheDocument());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  } finally {
    getComputedStyleSpy.mockRestore();
  }
});
