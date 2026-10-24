import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useComposeRequestScope } from "./useComposeRequestScope";

it("invalidates old responses on identity changes, including a switch back", () => {
  const { result, rerender, unmount } = renderHook(({ scope }) => useComposeRequestScope(scope), { initialProps: { scope: "teacher-a/project/paper" } });
  const old = result.current();
  expect(old()).toBe(true);
  rerender({ scope: "teacher-b/project/paper" });
  expect(old()).toBe(false);
  const second = result.current();
  rerender({ scope: "teacher-a/project/paper" });
  expect(old()).toBe(false);
  expect(second()).toBe(false);
  const last = result.current();
  unmount();
  expect(last()).toBe(false);
});
