import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { GraphNodePanel } from "../GraphNodePanel";
import type { GraphNodeRow } from "../useGraphStore";
import * as clientApi from "../../api/client";

const mocks = vi.hoisted(() => ({
  apiGraphListQuestionsForNode: vi.fn(),
  apiGraphListNodeFiles: vi.fn(),
  apiGraphUpdateNode: vi.fn(),
  apiGraphDeleteNode: vi.fn(),
  apiGraphCreateRelation: vi.fn(),
  apiGraphDeleteRelation: vi.fn(),
  apiGraphUpdateRelation: vi.fn(),
  apiBankItems: vi.fn(),
  apiGraphBindBatch: vi.fn(),
  apiGraphUnbindBinding: vi.fn(),
  apiGraphUnbindBatch: vi.fn(),
  apiGraphListResourceFiles: vi.fn(),
  apiGraphAttachFile: vi.fn(),
  apiGraphUploadMaterial: vi.fn(),
  apiGraphDetachFile: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  ...mocks,
  resourceApiUrl: (path: string) => `/api/resource/${path}`,
}));

const nodeA: GraphNodeRow = {
  id: "node-a",
  canonical_name: "微积分基础",
  node_kind: "concept",
  subject: "数学",
  tags: ["基础", "核心"],
  aliases: ["Calculus", "微积分"],
  primary_parent_id: null,
  level: "初级",
  layout_x: 100,
  layout_y: 200,
  notes: [{ id: "note-a", body: "原有笔记", created_at: "2026-10-01" }],
};
const nodeB: GraphNodeRow = {
  ...nodeA,
  id: "node-b",
  canonical_name: "导数与微分",
  node_kind: "skill",
  tags: ["导数"],
  aliases: ["Derivative"],
  primary_parent_id: "node-a",
  notes: [],
};

type PanelProps = {
  selectedNode: GraphNodeRow | null;
  activeSlug?: string | null;
  tab?: "edit" | "questions" | "files" | "notes";
  onSaved?: () => void;
  onDeleted?: () => void;
  onError?: (message: string | null) => void;
  onDeleteNode?: () => Promise<void>;
};

function panel(props: PanelProps) {
  return (
    <TestI18nProvider>
      <GraphNodePanel
        selectedNode={props.selectedNode}
        relations={[]}
        graphNodes={[nodeA, nodeB]}
        activeSlug={props.activeSlug ?? "math"}
        tab={props.tab ?? "edit"}
        onTabChange={vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
        onDeleteNode={props.onDeleteNode}
        onDeleted={props.onDeleted ?? vi.fn()}
        onError={props.onError ?? vi.fn()}
        onClose={vi.fn()}
      />
    </TestI18nProvider>
  );
}

describe("GraphNodePanel request and snapshot lifecycle", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    vi.clearAllMocks();
    vi.mocked(clientApi.apiGraphListQuestionsForNode).mockResolvedValue({ questions: [] } as any);
    vi.mocked(clientApi.apiGraphListNodeFiles).mockResolvedValue({ links: [] } as any);
    vi.mocked(clientApi.apiGraphUpdateNode).mockResolvedValue({} as any);
    vi.mocked(clientApi.apiGraphDeleteNode).mockResolvedValue({ ok: true } as any);
  });

  it("unblocks a switched node and ignores the previous node's late save", async () => {
    let resolveSaveA!: (value: unknown) => void;
    vi.mocked(clientApi.apiGraphUpdateNode).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSaveA = resolve;
    }) as any);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const view = render(panel({ selectedNode: nodeA, onSaved }));

    fireEvent.change(screen.getByLabelText("标准名称"), { target: { value: "A 未保存名称" } });
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    view.rerender(panel({ selectedNode: nodeB, onSaved }));
    expect(await screen.findByDisplayValue("导数与微分")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled());

    await act(async () => { resolveSaveA({}); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("标准名称")).toHaveValue("导数与微分");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
  });

  it("treats the same node id in another graph as a different identity", async () => {
    let resolveSave!: (value: unknown) => void;
    vi.mocked(clientApi.apiGraphUpdateNode).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve;
    }) as any);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const sameIdInOtherGraph = { ...nodeA, canonical_name: "物理图谱同 ID 节点", tags: ["物理"] };
    const view = render(panel({ selectedNode: nodeA, activeSlug: "math", onSaved }));

    fireEvent.change(screen.getByLabelText("标准名称"), { target: { value: "数学图谱本地草稿" } });
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    view.rerender(panel({ selectedNode: sameIdInOtherGraph, activeSlug: "physics", onSaved }));

    expect(await screen.findByDisplayValue("物理图谱同 ID 节点")).toBeInTheDocument();
    expect(screen.getByLabelText("标签（逗号分隔）")).toHaveValue("物理");
    await act(async () => { resolveSave({}); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("标准名称")).toHaveValue("物理图谱同 ID 节点");
    expect(clientApi.apiGraphListQuestionsForNode).toHaveBeenCalledWith("node-a", "physics");
  });

  it("keeps dirty fields and a note draft across a same-node refresh, accepts clean fields, and clears busy on completion", async () => {
    let resolveSave!: (value: unknown) => void;
    vi.mocked(clientApi.apiGraphUpdateNode).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve;
    }) as any);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const view = render(panel({ selectedNode: nodeA, onSaved }));

    fireEvent.change(screen.getByLabelText("标准名称"), { target: { value: "本地未保存名称" } });
    fireEvent.change(screen.getByLabelText("标签（逗号分隔）"), { target: { value: "本地标签" } });
    fireEvent.change(screen.getByLabelText("别名（逗号分隔）"), { target: { value: "本地别名" } });
    view.rerender(panel({ selectedNode: nodeA, tab: "notes", onSaved }));
    await user.click(screen.getByRole("button", { name: "新增笔记" }));
    const editor = view.container.querySelector('[contenteditable="true"]');
    expect(editor).not.toBeNull();
    await user.type(editor as HTMLElement, "笔记草稿未保存");

    view.rerender(panel({ selectedNode: nodeA, tab: "edit", onSaved }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    const refreshedNode: GraphNodeRow = {
      ...nodeA,
      canonical_name: "服务端最新名称",
      node_kind: "skill",
      tags: ["服务端最新标签"],
      aliases: ["服务端最新别名"],
      notes: [{ id: "note-a", body: "服务端最新笔记", created_at: "2026-10-02" }],
    };
    view.rerender(panel({ selectedNode: refreshedNode, tab: "edit", onSaved }));
    expect(screen.getByLabelText("标准名称")).toHaveValue("本地未保存名称");
    expect(screen.getByLabelText("标签（逗号分隔）")).toHaveValue("本地标签");
    expect(screen.getByLabelText("别名（逗号分隔）")).toHaveValue("本地别名");
    expect(screen.getByLabelText("节点类型")).toHaveValue("skill");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    view.rerender(panel({ selectedNode: refreshedNode, tab: "notes", onSaved }));
    expect(screen.getByText("服务端最新笔记")).toBeInTheDocument();
    expect(view.container.querySelector('[contenteditable="true"]')).toHaveTextContent("笔记草稿未保存");

    await act(async () => { resolveSave({}); });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("does not reset drafts or reload bindings when only the onError callback changes", async () => {
    let rejectQuestions!: (reason: unknown) => void;
    vi.mocked(clientApi.apiGraphListQuestionsForNode).mockImplementationOnce(() => new Promise((_, reject) => {
      rejectQuestions = reject;
    }) as any);
    const onErrorBefore = vi.fn();
    const onErrorAfter = vi.fn();
    const view = render(panel({ selectedNode: nodeA, onError: onErrorBefore }));
    fireEvent.change(screen.getByLabelText("标准名称"), { target: { value: "保持的草稿" } });
    await waitFor(() => expect(clientApi.apiGraphListQuestionsForNode).toHaveBeenCalledTimes(1));
    expect(clientApi.apiGraphListNodeFiles).toHaveBeenCalledTimes(1);

    view.rerender(panel({ selectedNode: nodeA, onError: onErrorAfter }));
    expect(screen.getByLabelText("标准名称")).toHaveValue("保持的草稿");
    expect(clientApi.apiGraphListQuestionsForNode).toHaveBeenCalledTimes(1);
    expect(clientApi.apiGraphListNodeFiles).toHaveBeenCalledTimes(1);

    await act(async () => { rejectQuestions(new Error("late question lookup")); });
    await waitFor(() => expect(onErrorAfter).toHaveBeenCalledWith("late question lookup"));
    expect(onErrorBefore).not.toHaveBeenCalled();
  });

  it("ignores late save and delete responses after unmount", async () => {
    let resolveSave!: (value: unknown) => void;
    vi.mocked(clientApi.apiGraphUpdateNode).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve;
    }) as any);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const saveView = render(panel({ selectedNode: nodeA, onSaved }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    saveView.unmount();
    await act(async () => { resolveSave({}); });
    expect(onSaved).not.toHaveBeenCalled();

    let resolveDelete!: (value: unknown) => void;
    vi.mocked(clientApi.apiGraphDeleteNode).mockImplementationOnce(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }) as any);
    const onDeleted = vi.fn();
    const deleteView = render(panel({ selectedNode: nodeA, onDeleted }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    deleteView.unmount();
    await act(async () => { resolveDelete({ ok: true }); });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
