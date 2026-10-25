import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, it } from "vitest";
import type { ComposeLocalDraftRecord } from "../../types/compose";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { createEmptyPaperState } from "./composeModel";
import { ComposeDraftRecoveryDialog } from "./ComposeDraftRecoveryDialog";

beforeAll(async () => { await setupTestI18n("zh"); });

it("requires resolving the existing recovery before the saved paper can be edited", async () => {
  function Workspace() {
    const [record, setRecord] = useState<ComposeLocalDraftRecord | null>({
      version: 1, updatedAt: "2026-10-25T08:00:00Z",
      scope: { accountId: "teacher", projectRoot: "project", paperKey: "scratch" },
      paper: createEmptyPaperState({ exportLabel: "Recoverable paper" }),
    });
    return <><input aria-label="试卷标题" defaultValue="Saved paper" /><ComposeDraftRecoveryDialog record={record} busy={false} onRestore={() => setRecord(null)} onDiscard={() => setRecord(null)} /></>;
  }
  render(<TestI18nProvider><Workspace /></TestI18nProvider>);
  const user = userEvent.setup();
  expect(screen.getByRole("dialog")).toHaveTextContent("Recoverable paper");
  expect(screen.queryByRole("textbox", { name: "试卷标题" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "丢弃草稿" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "试卷标题" })).toHaveValue("Saved paper");
});
