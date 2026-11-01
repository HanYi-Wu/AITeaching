import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Choose through the same visible popup used by keyboard and pointer users. */
export async function selectOption(trigger: HTMLElement, value: string | number) {
  await userEvent.click(trigger);
  const list = await screen.findByRole("listbox");
  const option = within(list).getAllByRole("option").find((item) => item.getAttribute("data-value") === String(value));
  if (!option) throw new Error(`Select option not found: ${value}`);
  await userEvent.click(option);
}
