import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const selectPortalLifecycle = vi.hoisted(() => ({ active: 0 }));

vi.mock("@radix-ui/react-select", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@radix-ui/react-select")>();
  const React = await import("react");
  function TrackingPortal(props: { children?: React.ReactNode; [key: string]: unknown }) {
    React.useEffect(() => {
      selectPortalLifecycle.active += 1;
      return () => { selectPortalLifecycle.active -= 1; };
    }, []);
    const { children, ...portalProps } = props;
    return React.createElement(actual.Portal as React.ElementType, portalProps, children);
  }
  return { ...actual, Portal: TrackingPortal };
});

import { Select } from "./select";

let trackedLabelActiveCount = 0;

function TrackedOptionLabel() {
  useEffect(() => {
    trackedLabelActiveCount += 1;
    return () => { trackedLabelActiveCount -= 1; };
  }, []);
  return <>可追踪选项</>;
}

function Filter() {
  const [value, setValue] = useState("");
  return <label>学科<Select value={value} onValueChange={setValue}>
    <option value="">全部学科</option>
    <optgroup label="理科"><option value="math">数学</option><option value="physics" disabled>物理</option></optgroup>
    <optgroup label="停用" disabled><option value="disabled-group-option">不可选分组项</option></optgroup>
    <option value="__or_select_empty__">特殊元数据值</option>
  </Select></label>;
}

function TrackedFilter() {
  const [value, setValue] = useState("");
  return <label>追踪<Select aria-label="追踪" value={value} onValueChange={setValue}>
    <option value="">请选择</option>
    <option value="tracked"><TrackedOptionLabel /></option>
  </Select></label>;
}

it("keeps empty filter values, option groups and disabled options in the application menu", async () => {
  const user = userEvent.setup();
  render(<Filter />);
  const trigger = screen.getByRole("combobox", { name: "学科" });
  expect(trigger).toHaveTextContent("全部学科");
  await user.click(trigger);
  expect(screen.getByRole("option", { name: "物理" })).toHaveAttribute("data-disabled");
  expect(screen.getByRole("option", { name: "不可选分组项" })).toHaveAttribute("data-disabled");
  await user.click(screen.getByRole("option", { name: "特殊元数据值" }));
  expect(trigger).toHaveTextContent("特殊元数据值");
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "数学" }));
  expect(trigger).toHaveTextContent("数学");
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "全部学科" }));
  expect(trigger).toHaveTextContent("全部学科");
});

it("shows an explicit disabled empty state when there are no options", async () => {
  const onValueChange = vi.fn();
  const user = userEvent.setup();
  render(<Select aria-label="当前小节" value="" onValueChange={onValueChange}>{null}</Select>);

  const trigger = screen.getByRole("combobox", { name: "当前小节" });
  await user.click(trigger);

  const emptyState = await screen.findByRole("option", { name: "暂无可选项" });
  expect(emptyState).toHaveAttribute("aria-disabled", "true");
  expect(emptyState).toHaveClass("or-select-empty");
  await user.click(emptyState);
  expect(onValueChange).not.toHaveBeenCalled();
});

it("supports keyboard selection, Escape and focus return", async () => {
  const user = userEvent.setup();
  render(<Filter />);
  const trigger = screen.getByRole("combobox", { name: "学科" });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("listbox");
  await user.keyboard("{End}{Enter}");
  expect(trigger).toHaveTextContent("数学");
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

it("releases the closed popup tree after its close animation", async () => {
  const user = userEvent.setup();
  render(<Filter />);
  const trigger = screen.getByRole("combobox", { name: "学科" });
  await user.click(trigger);
  expect(document.querySelector("[data-or-select-content]")).not.toBeNull();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.querySelector("[data-or-select-content]")).toBeNull(), { timeout: 1000 });
  expect(trigger).toHaveFocus();
});

it("unmounts React option labels after closing, not only the visible DOM", async () => {
  trackedLabelActiveCount = 0;
  selectPortalLifecycle.active = 0;
  const user = userEvent.setup();
  render(<TrackedFilter />);
  const trigger = screen.getByRole("combobox", { name: "追踪" });
  expect(trackedLabelActiveCount).toBe(0);

  await user.click(trigger);
  await screen.findByRole("option", { name: "可追踪选项" });
  await waitFor(() => expect(trackedLabelActiveCount).toBeGreaterThan(0));

  await user.keyboard("{Escape}");
  await waitFor(() => expect(trackedLabelActiveCount).toBe(0), { timeout: 1000 });
  await waitFor(() => expect(selectPortalLifecycle.active).toBe(0), { timeout: 1000 });
});

it("preserves required form validation and reflects controlled changes", async () => {
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    return <form onSubmit={(event) => { event.preventDefault(); submit(value); }}>
      <Select aria-label="班级" required value={value} onValueChange={setValue}><option value="">请选择班级</option><option value="c1">一班</option></Select>
      <button type="submit">提交</button>
      <button type="button" onClick={() => setValue("")}>清空</button>
    </form>;
  }
  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole("button", { name: "提交" }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "班级" })).toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("combobox", { name: "班级" }));
  await user.click(screen.getByRole("option", { name: "一班" }));
  await user.click(screen.getByRole("button", { name: "提交" }));
  expect(submit).toHaveBeenCalledWith("c1");
  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  expect(screen.getByRole("combobox", { name: "班级" })).toHaveTextContent("请选择班级");
});
