import { act, type ComponentProps, type ComponentType, type DragEvent, type MouseEvent } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { GraphNodeRow, GraphRelationRow } from "../useGraphStore";
import { MindMapCanvas } from "../MindMapCanvas";

type ProfileNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  selected?: boolean;
};
type ProfileEdge = { id: string; source: string; target: string };

const mocks = vi.hoisted(() => ({
  flowNodeRenders: 0,
  customNodeRenders: 0,
  latestNodes: [] as ProfileNode[],
  latestEdges: [] as ProfileEdge[],
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  function CustomNode({ Component, ...props }: {
    Component: ComponentType<Record<string, unknown>>;
    id: string;
    data: Record<string, unknown>;
    selected: boolean;
  }) {
    mocks.customNodeRenders++;
    return React.createElement(Component, props);
  }
  const FlowNode = React.memo(function FlowNode({ node, nodeTypes, onNodeClick, onNodeDoubleClick, onNodeDragStop }: any) {
    mocks.flowNodeRenders++;
    const handleClick = React.useCallback((event: MouseEvent) => onNodeClick?.(event, node), [node, onNodeClick]);
    const handleDoubleClick = React.useCallback((event: MouseEvent) => onNodeDoubleClick?.(event, node), [node, onNodeDoubleClick]);
    const handleDragEnd = React.useCallback((event: DragEvent) => onNodeDragStop?.(event, node), [node, onNodeDragStop]);
    const Component = nodeTypes[node.type];
    return React.createElement(
      "div",
      { "data-node-id": node.id, draggable: true, onClick: handleClick, onDoubleClick: handleDoubleClick, onDragEnd: handleDragEnd },
      React.createElement(CustomNode, { Component, id: node.id, data: node.data, selected: Boolean(node.selected) }),
    );
  });
  function ReactFlow(props: any) {
    mocks.latestNodes = props.nodes;
    mocks.latestEdges = props.edges;
    const handleDoubleClick = React.useCallback((event: MouseEvent, node: ProfileNode) => props.onNodeDoubleClick?.(event, node), [props.onNodeDoubleClick]);
    return React.createElement(
      "div",
      { "data-testid": "react-flow-shell" },
      props.nodes.map((node: ProfileNode) => React.createElement(FlowNode, {
        key: node.id,
        node,
        nodeTypes: props.nodeTypes,
        onNodeClick: props.onNodeClick,
        onNodeDoubleClick: handleDoubleClick,
        onNodeDragStop: props.onNodeDragStop,
      })),
    );
  }
  const useNodesState = (initial: ProfileNode[]) => {
    const [nodes, setNodes] = React.useState(initial);
    const onNodesChange = React.useCallback(() => undefined, []);
    return [nodes, setNodes, onNodesChange];
  };
  const useEdgesState = (initial: ProfileEdge[]) => {
    const [edges, setEdges] = React.useState(initial);
    const onEdgesChange = React.useCallback(() => undefined, []);
    return [edges, setEdges, onEdgesChange];
  };
  const Empty = () => null;
  return {
    Background: Empty,
    Controls: Empty,
    Handle: Empty,
    MarkerType: { ArrowClosed: "arrowclosed" },
    MiniMap: Empty,
    Position: { Left: "left", Right: "right" },
    ReactFlow,
    useEdgesState,
    useNodesState,
    ConnectionLineType: { Straight: "straight" },
  };
});

const graphNodes: GraphNodeRow[] = [
  { id: "parent", canonical_name: "父节点", primary_parent_id: null, node_kind: "concept" },
  { id: "child", canonical_name: "子节点", primary_parent_id: "parent", node_kind: "concept" },
  { id: "grandchild", canonical_name: "孙节点", primary_parent_id: "child", node_kind: "skill" },
  { id: "sibling", canonical_name: "同级节点", primary_parent_id: "parent", node_kind: "concept" },
];
const relations: GraphRelationRow[] = [
  { id: "child-parent", from_node_id: "child", to_node_id: "parent", relation_type: "part_of" },
  { id: "grandchild-child", from_node_id: "grandchild", to_node_id: "child", relation_type: "part_of" },
  { id: "sibling-parent", from_node_id: "sibling", to_node_id: "parent", relation_type: "part_of" },
];

const noOp = () => undefined;
function renderMindMap(overrides: Partial<ComponentProps<typeof MindMapCanvas>> = {}) {
  const props: ComponentProps<typeof MindMapCanvas> = {
    graphNodes,
    relations,
    selectedNodeId: null,
    layoutNonce: 0,
    connectingFromId: null,
    activeGraphName: "测试图",
    onNodeClick: noOp,
    onEdgeClick: noOp,
    onPaneClick: noOp,
    onNodeDragStop: noOp,
    onConnect: noOp,
    onAddNode: noOp,
    onAddChildNode: noOp,
    onAddSiblingNode: noOp,
    onStartConnect: noOp,
    onRelayout: noOp,
    onCancelConnect: noOp,
    onRenameNode: async () => undefined,
    ...overrides,
  };
  return render(<TestI18nProvider><MindMapCanvas {...props} /></TestI18nProvider>);
}

function nodeElement(id: string, container: HTMLElement = document.body) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-node-id]"))
    .find((element) => element.dataset.nodeId === id) ?? null;
}

function dataFor(id: string) {
  return mocks.latestNodes.find((node) => node.id === id)?.data;
}

describe("MindMapCanvas inline editing", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    mocks.flowNodeRenders = 0;
    mocks.customNodeRenders = 0;
    mocks.latestNodes = [];
    mocks.latestEdges = [];
  });

  it("updates only the editing node per keystroke and keeps IME, focus, trim, and async save behavior", async () => {
    let finishRename!: () => void;
    const onRenameNode = vi.fn(() => new Promise<void>((resolve) => { finishRename = resolve; }));
    const user = userEvent.setup();
    const mounted = renderMindMap({ onRenameNode });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));
    const beforePositions = mocks.latestNodes.map(({ id, position }) => ({ id, ...position }));
    const beforeEdgeIds = mocks.latestEdges.map((edge) => edge.id);

    await user.dblClick(nodeElement("child", mounted.container)!);
    const input = await screen.findByDisplayValue("子节点") as HTMLInputElement;
    expect(input).toHaveFocus();
    await waitFor(() => expect(dataFor("child")?.isInlineEditing).toBe(true));

    const renderCounts: number[] = [];
    for (const value of ["新", "新名", "  新名  "]) {
      const before = mocks.customNodeRenders;
      fireEvent.change(input, { target: { value } });
      await waitFor(() => expect(input).toHaveValue(value));
      renderCounts.push(mocks.customNodeRenders - before);
      expect(input).toHaveFocus();
      expect(mocks.latestNodes.map(({ id, position }) => ({ id, ...position }))).toEqual(beforePositions);
      expect(mocks.latestEdges.map((edge) => edge.id)).toEqual(beforeEdgeIds);
    }
    expect(renderCounts).toEqual([1, 1, 1]);

    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229, which: 229 });
    expect(onRenameNode).not.toHaveBeenCalled();
    expect(input).toHaveValue("  新名  ");
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith("child", "新名"));
    expect(input).toBeInTheDocument();
    await act(async () => { finishRename(); });
    await waitFor(() => expect(screen.queryByDisplayValue("  新名  ")).not.toBeInTheDocument());
    expect(dataFor("child")?.isInlineEditing).toBe(false);
  });

  it("keeps Escape and blur commit semantics, including blank and unchanged names", async () => {
    const onRenameNode = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const mounted = renderMindMap({ onRenameNode });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));

    await user.dblClick(nodeElement("child", mounted.container)!);
    let input = await screen.findByDisplayValue("子节点");
    fireEvent.change(input, { target: { value: "  转义提交  " } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith("child", "转义提交"));
    await waitFor(() => expect(screen.queryByDisplayValue("  转义提交  ")).not.toBeInTheDocument());

    await user.dblClick(nodeElement("child", mounted.container)!);
    input = await screen.findByDisplayValue("子节点");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByDisplayValue("   ")).not.toBeInTheDocument());
    expect(onRenameNode).toHaveBeenCalledTimes(1);

    await user.dblClick(nodeElement("child", mounted.container)!);
    input = await screen.findByDisplayValue("子节点");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(screen.queryByDisplayValue("子节点")).not.toBeInTheDocument());
    expect(onRenameNode).toHaveBeenCalledTimes(1);
  });

  it("retains the draft and editor when the async rename rejects", async () => {
    const onRenameNode = vi.fn(async () => { throw new Error("rename failed"); });
    const mounted = renderMindMap({ onRenameNode });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));
    await userEvent.dblClick(nodeElement("child", mounted.container)!);
    const input = await screen.findByDisplayValue("子节点") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "未保存草稿" } });
    const commit = dataFor("child")?.onInlineCommit as ((value: string) => Promise<void>) | undefined;
    expect(commit).toBeTypeOf("function");
    await expect(commit!(input.value)).rejects.toThrow("rename failed");
    expect(onRenameNode).toHaveBeenCalledWith("child", "未保存草稿");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("未保存草稿");
    expect(dataFor("child")?.isInlineEditing).toBe(true);
  });

  it("keeps a late node commit tied to the draft from its own input", async () => {
    const onRenameNode = vi.fn(async () => undefined);
    const mounted = renderMindMap({ onRenameNode });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));

    await userEvent.dblClick(nodeElement("child", mounted.container)!);
    const inputA = await screen.findByDisplayValue("子节点") as HTMLInputElement;
    fireEvent.change(inputA, { target: { value: "A 草稿" } });
    const staleCommit = dataFor("child")?.onInlineCommit as ((value: string) => Promise<void>) | undefined;
    expect(staleCommit).toBeTypeOf("function");

    // Start editing B without dispatching a blur for A, then deliver A's captured commit callback.
    fireEvent.doubleClick(nodeElement("sibling", mounted.container)!);
    const inputB = await screen.findByDisplayValue("同级节点");
    fireEvent.change(inputB, { target: { value: "B 草稿" } });
    await act(async () => { await staleCommit!(inputA.value); });

    expect(onRenameNode).toHaveBeenCalledTimes(1);
    expect(onRenameNode).toHaveBeenCalledWith("child", "A 草稿");
    expect(inputB).toHaveValue("B 草稿");
  });

  it("keeps an unsubmitted draft and focus when graph data refreshes", async () => {
    const mounted = renderMindMap();
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));
    await userEvent.dblClick(nodeElement("child", mounted.container)!);
    const input = await screen.findByDisplayValue("子节点");
    fireEvent.change(input, { target: { value: "未提交的新名" } });

    const refreshedNodes = graphNodes.map((node) => node.id === "sibling"
      ? { ...node, canonical_name: "刷新后的同级节点" }
      : { ...node });
    refreshedNodes.push({ id: "new", canonical_name: "刷新新增", primary_parent_id: "parent", node_kind: "concept" });
    mounted.rerender(
      <TestI18nProvider>
        <MindMapCanvas
          graphNodes={refreshedNodes}
          relations={[...relations, { id: "new-parent", from_node_id: "new", to_node_id: "parent", relation_type: "part_of" }]}
          selectedNodeId={null}
          layoutNonce={0}
          connectingFromId={null}
          activeGraphName="测试图"
          onNodeClick={noOp}
          onEdgeClick={noOp}
          onPaneClick={noOp}
          onNodeDragStop={noOp}
          onConnect={noOp}
          onAddNode={noOp}
          onAddChildNode={noOp}
          onAddSiblingNode={noOp}
          onStartConnect={noOp}
          onRelayout={noOp}
          onCancelConnect={noOp}
          onRenameNode={async () => undefined}
        />
      </TestI18nProvider>,
    );
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(refreshedNodes.length + 1));
    expect(screen.getByDisplayValue("未提交的新名")).toBe(input);
    expect(input).toHaveFocus();
    expect(dataFor("child")?.label).toBe("子节点");
    expect(nodeElement("new", mounted.container)).toBeTruthy();
    expect(nodeElement("sibling", mounted.container)?.textContent).toContain("刷新后的同级节点");
  });

  it("preserves selection callbacks, collapse, connection, drag coordinates, and the virtual root", async () => {
    const onNodeClick = vi.fn();
    const onPaneClick = vi.fn();
    const onConnect = vi.fn();
    const onNodeDragStop = vi.fn();
    const selectionCanvas = renderMindMap({ onNodeClick, onPaneClick, onNodeDragStop });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));
    fireEvent.click(nodeElement("child", selectionCanvas.container)!);
    expect(onNodeClick).toHaveBeenCalledWith("child");
    selectionCanvas.unmount();
    onNodeClick.mockClear();

    const mounted = renderMindMap({ onNodeClick, onPaneClick, onConnect, onNodeDragStop, connectingFromId: "parent" });
    await waitFor(() => expect(mocks.latestNodes).toHaveLength(graphNodes.length + 1));

    fireEvent.click(nodeElement("child", mounted.container)!);
    expect(onConnect).toHaveBeenCalledWith("parent", "child");
    expect(onNodeClick).not.toHaveBeenCalled();

    fireEvent.dragEnd(nodeElement("child", mounted.container)!);
    const childPosition = mocks.latestNodes.find((node) => node.id === "child")!.position;
    expect(onNodeDragStop).toHaveBeenCalledWith("child", childPosition.x, childPosition.y);

    fireEvent.click(nodeElement("__virtual_root__", mounted.container)!);
    expect(onPaneClick).toHaveBeenCalledTimes(1);
    await userEvent.dblClick(nodeElement("__virtual_root__", mounted.container)!);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    const parentNode = nodeElement("parent", mounted.container)!;
    await userEvent.click(within(parentNode).getByRole("button", { name: "−" }));
    await waitFor(() => expect(nodeElement("grandchild", mounted.container)).toBeNull());
    await userEvent.click(within(nodeElement("parent", mounted.container)!).getByRole("button", { name: "+" }));
    await waitFor(() => expect(nodeElement("grandchild", mounted.container)).not.toBeNull());
  });
});
