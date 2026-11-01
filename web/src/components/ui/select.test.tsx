import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Select } from "./select";

function Filter() {
  const [value, setValue] = useState("");
  return <label>学科<Select value={value} onValueChange={setValue}>
    <option value="">全部学科</option>
    <optgroup label="理科"><option value="math">数学</option><option value="physics" disabled>物理</option></optgroup>
    <optgroup label="停用" disabled><option value="disabled-group-option">不可选分组项</option></optgroup>
    <option value="__or_select_empty__">特殊元数据值</option>
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
