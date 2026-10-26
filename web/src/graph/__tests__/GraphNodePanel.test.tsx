import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { GraphNodePanel } from "../GraphNodePanel";
import type { GraphNodeRow, GraphRelationRow } from "../useGraphStore";
import * as clientApi from "../../api/client";

// Mock API client calls
vi.mock("../../api/client", () => ({
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
  resourceApiUrl: (path: string) => `/api/resource/${path}`,
}));

const mockNodeA: GraphNodeRow = {
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
  notes: [
    { id: "note-1", body: "微积分重点概念", created_at: "2026-10-01" },
  ],
};

const mockNodeB: GraphNodeRow = {
  id: "node-b",
  canonical_name: "导数与微分",
  node_kind: "concept",
  subject: "数学",
  tags: ["导数"],
  aliases: ["Derivative"],
  primary_parent_id: "node-a",
  level: "初级",
  layout_x: 200,
  layout_y: 300,
  notes: [],
};

const mockRelations: GraphRelationRow[] = [
  {
    id: "rel-1",
    from_node_id: "node-a",
    to_node_id: "node-b",
    relation_type: "prerequisite",
  },
];

describe("GraphNodePanel", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    vi.clearAllMocks();

    vi.mocked(clientApi.apiGraphListQuestionsForNode).mockResolvedValue({
      questions: [
        { qualified_id: "q-1", content_preview: "求极限 lim x->0" },
      ] as any,
    });
    vi.mocked(clientApi.apiGraphListNodeFiles).mockResolvedValue({
      links: [
        { id: "file-link-1", relative_path: "materials/calculus.pdf" },
      ] as any,
    });
    vi.mocked(clientApi.apiGraphUpdateNode).mockResolvedValue({} as any);
  });

  it("renders empty state placeholder when no node is selected", () => {
    render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={null}
          relations={[]}
          graphNodes={[]}
          activeSlug={null}
          tab="edit"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(screen.getByText("请先在画布中点击一个节点。")).toBeInTheDocument();
  });

  it("renders node edit fields with populated draft values", async () => {
    render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="edit"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(screen.getByDisplayValue("微积分基础")).toBeInTheDocument();
    expect(screen.getByDisplayValue("基础, 核心")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Calculus, 微积分")).toBeInTheDocument();
  });

  it("saves node changes and triggers onSaved callback", async () => {
    const onSaved = vi.fn();
    render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="edit"
          onTabChange={vi.fn()}
          onSaved={onSaved}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    const nameInput = screen.getByDisplayValue("微积分基础");
    fireEvent.change(nameInput, { target: { value: "微积分基础（修订）" } });

    const saveButton = screen.getByRole("button", { name: "保存修改" });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(clientApi.apiGraphUpdateNode).toHaveBeenCalledWith(
        "node-a",
        expect.objectContaining({
          canonical_name: "微积分基础（修订）",
        }),
        "math",
      );
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("prevents late asynchronous question and file responses from polluting switched node", async () => {
    let resolveNodeAQuestions: (value: any) => void = () => {};
    const nodeAQuestionsPromise = new Promise((resolve) => {
      resolveNodeAQuestions = resolve;
    });

    vi.mocked(clientApi.apiGraphListQuestionsForNode).mockImplementation(
      (nodeId: string) => {
        if (nodeId === "node-a") {
          return nodeAQuestionsPromise as any;
        }
        return Promise.resolve({
          questions: [
            { qualified_id: "q-node-b", content_preview: "导数练习题" },
          ],
        }) as any;
      },
    );

    const { rerender } = render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="questions"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Switch to Node B immediately
    rerender(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeB}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="questions"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Node B's questions should render
    await waitFor(() => {
      expect(screen.getByText("q-node-b")).toBeInTheDocument();
    });

    // Now resolve Node A's slow questions response
    resolveNodeAQuestions({
      questions: [{ qualified_id: "q-node-a-late", content_preview: "迟到的A题目" }],
    });

    // Wait a tick and verify Node A's late response did NOT pollute Node B
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("q-node-a-late")).not.toBeInTheDocument();
    expect(screen.getByText("q-node-b")).toBeInTheDocument();
  });

  it("switches tabs between edit, questions, files and notes", async () => {
    const onTabChange = vi.fn();
    render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="notes"
          onTabChange={onTabChange}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Notes tab should show existing note
    expect(screen.getByText("微积分重点概念")).toBeInTheDocument();

    // Click tab switcher buttons
    const filesTabBtn = screen.getByRole("button", { name: "资料" });
    await userEvent.click(filesTabBtn);
    expect(onTabChange).toHaveBeenCalledWith("files");
  });

  it("handles relations creation and deletion properly", async () => {
    const onSaved = vi.fn();
    vi.mocked(clientApi.apiGraphCreateRelation).mockResolvedValue({} as any);
    vi.mocked(clientApi.apiGraphDeleteRelation).mockResolvedValue({} as any);

    render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="edit"
          onTabChange={vi.fn()}
          onSaved={onSaved}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Remove existing relation
    const removeBtn = screen.getByRole("button", { name: "移除" });
    await userEvent.click(removeBtn);
    expect(clientApi.apiGraphDeleteRelation).toHaveBeenCalledWith("rel-1", "math");
    expect(onSaved).toHaveBeenCalled();
  });

  it("prevents late persist notes from updating switched node notes list", async () => {
    let resolveNodeANotesSave: (v: any) => void = () => {};
    const nodeASavePromise = new Promise((resolve) => {
      resolveNodeANotesSave = resolve;
    });

    vi.mocked(clientApi.apiGraphUpdateNode).mockImplementation((nodeId: string) => {
      if (nodeId === "node-a") {
        return nodeASavePromise as any;
      }
      return Promise.resolve({} as any);
    });

    const { rerender } = render(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeA}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="notes"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Delete existing note on node A
    const deleteNoteBtn = screen.getByLabelText("移除此笔记");
    await userEvent.click(deleteNoteBtn);

    // Switch to Node B while save is pending
    rerender(
      <TestI18nProvider>
        <GraphNodePanel
          selectedNode={mockNodeB}
          relations={mockRelations}
          graphNodes={[mockNodeA, mockNodeB]}
          activeSlug="math"
          tab="notes"
          onTabChange={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // Resolve node A save
    resolveNodeANotesSave({});
    await new Promise((r) => setTimeout(r, 50));

    // Node B has no notes, it should show "暂无笔记，可点击上方新增。"
    expect(screen.getByText("暂无笔记，可点击上方新增。")).toBeInTheDocument();
  });
});
