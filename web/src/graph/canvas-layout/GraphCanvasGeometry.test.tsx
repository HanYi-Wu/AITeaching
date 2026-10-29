import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { GraphNodeRow, GraphRelationRow } from "../useGraphStore";

type MockNode = {
  id: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  selected?: boolean;
  dragging?: boolean;
};

type MockEdge = { id: string; source: string; target: string };

const flowMock = vi.hoisted(() => ({
  nodes: [] as MockNode[],
  edges: [] as MockEdge[],
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  function ReactFlow(props: Record<string, any>) {
    const nodes = props.nodes as MockNode[];
    const edges = props.edges as MockEdge[];
    flowMock.nodes = nodes;
    flowMock.edges = edges;
    return React.createElement(
      "div",
      { "data-testid": "react-flow-viewport" },
      nodes.map((node) => React.createElement(
        "div",
        {
          key: node.id,
          "data-testid": `flow-node-${node.id}`,
          "data-x": node.position.x,
          "data-y": node.position.y,
          "data-node-kind": String(node.data.nodeKind ?? ""),
          "data-selected": String(Boolean(node.selected)),
          "data-dragging": String(Boolean(node.dragging)),
        },
        React.createElement("span", null, String(node.data.label ?? "")),
        React.createElement("button", {
          type: "button",
          "aria-label": `select ${node.id}`,
          onClick: () => props.onNodesChange([
            { id: node.id, type: "select", selected: true },
          ]),
        }),
        React.createElement("button", {
          type: "button",
          "aria-label": `drag ${node.id}`,
          onClick: () => props.onNodesChange([
            {
              id: node.id,
              type: "position",
              position: { x: 731, y: -246 },
              dragging: true,
            },
          ]),
        }),
      )),
    );
  }

  function useNodesState(initial: MockNode[]) {
    const [nodes, setNodes] = React.useState(initial);
    const onNodesChange = React.useCallback((changes: Array<Record<string, any>>) => {
      setNodes((current) => current.map((node) => {
        const change = changes.find((item) => item.id === node.id);
        if (!change) return node;
        if (change.type === "position") {
          return {
            ...node,
            position: change.position ?? node.position,
            dragging: change.dragging,
          };
        }
        if (change.type === "select") return { ...node, selected: change.selected };
        return node;
      }));
    }, []);
    return [nodes, setNodes, onNodesChange] as const;
  }

  function useEdgesState(initial: MockEdge[]) {
    const [edges, setEdges] = React.useState(initial);
    const onEdgesChange = React.useCallback(() => undefined, []);
    return [edges, setEdges, onEdgesChange] as const;
  }

  const Empty = () => null;
  return {
    Background: Empty,
    BaseEdge: Empty,
    Controls: Empty,
    Handle: Empty,
    MarkerType: { ArrowClosed: "arrowclosed" },
    MiniMap: Empty,
    Position: { Top: "top", Bottom: "bottom" },
    ReactFlow,
    useEdgesState,
    useNodesState,
    useReactFlow: () => ({ getNode: () => undefined }),
    ConnectionLineType: { Straight: "straight" },
  };
});

import { GraphCanvas } from "../GraphCanvas";
import * as layoutGraph from "../layoutGraph";

const baseNodes: GraphNodeRow[] = [
  { id: "a", canonical_name: "节点甲", node_kind: "concept", file_link_count: 0 },
  { id: "b", canonical_name: "节点乙", node_kind: "skill", file_link_count: 0 },
];

const baseRelations: GraphRelationRow[] = [
  { id: "ab", from_node_id: "a", to_node_id: "b", relation_type: "prerequisite" },
];

const noop = () => undefined;

function canvasProps(
  overrides: Partial<ComponentProps<typeof GraphCanvas>> = {},
): ComponentProps<typeof GraphCanvas> {
  return {
    graphScope: "project-a/graph-a",
    graphNodes: baseNodes,
    relations: baseRelations,
    selectedNodeId: "a",
    layoutNonce: 0,
    connectingFromId: null,
    onNodeClick: noop,
    onEdgeClick: noop,
    onPaneClick: noop,
    onNodeDragStop: noop,
    onConnect: noop,
    onAddNode: noop,
    onStartConnect: noop,
    onRelayout: noop,
    onCancelConnect: noop,
    ...overrides,
  };
}

function view(props: ComponentProps<typeof GraphCanvas>) {
  return <TestI18nProvider><GraphCanvas {...props} /></TestI18nProvider>;
}

describe("GraphCanvas geometry invalidation", () => {
  beforeAll(async () => setupTestI18n("zh"));

  beforeEach(() => {
    vi.restoreAllMocks();
    flowMock.nodes = [];
    flowMock.edges = [];
  });

  it("updates labels without solving and retains node selection, drag state, and coordinates", async () => {
    const dagre = vi.spyOn(layoutGraph, "layoutWithDagre");
    const force = vi.spyOn(layoutGraph, "layoutWithForceDirected");
    const overlaps = vi.spyOn(layoutGraph, "removeNodeOverlaps");
    const initial = canvasProps();
    const mounted = render(view(initial));
    await waitFor(() => expect(flowMock.nodes).toHaveLength(2));
    expect(dagre).toHaveBeenCalledTimes(1);
    expect(force).toHaveBeenCalledTimes(1);
    expect(overlaps).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "select a" }));
    fireEvent.click(screen.getByRole("button", { name: "drag a" }));
    await waitFor(() => expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-dragging", "true"));
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-selected", "true");

    mounted.rerender(view(canvasProps({
      graphNodes: [
        { ...baseNodes[0], canonical_name: "节点甲已改名", node_kind: "causal", description: "新描述", tags: ["新标签"] },
        { ...baseNodes[1], description: "更新后的描述" },
      ],
    })));

    expect(await screen.findByText("节点甲已改名")).toBeInTheDocument();
    expect(dagre).toHaveBeenCalledTimes(1);
    expect(force).toHaveBeenCalledTimes(1);
    expect(overlaps).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-x", "731");
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-y", "-246");
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-node-kind", "causal");
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("flow-node-a")).toHaveAttribute("data-dragging", "true");
  });

  it("re-solves for dimensions, saved positions, topology, relation filters, focus, nonce, and graph scope", async () => {
    const dagre = vi.spyOn(layoutGraph, "layoutWithDagre");
    const mounted = render(view(canvasProps()));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(1));

    mounted.rerender(view(canvasProps({
      graphNodes: [{ ...baseNodes[0], file_link_count: 5 }, baseNodes[1]],
    })));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(2));

    mounted.rerender(view(canvasProps({
      graphNodes: [
        { ...baseNodes[0], file_link_count: 5, layout_x: 170, layout_y: 240 },
        baseNodes[1],
      ],
    })));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(3));

    mounted.rerender(view(canvasProps({
      graphNodes: [...baseNodes, { id: "c", canonical_name: "节点丙", node_kind: "causal" }],
      relations: [
        ...baseRelations,
        { id: "bc", from_node_id: "b", to_node_id: "c", relation_type: "causal" },
      ],
    })));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(4));
    expect(screen.getByText("节点丙")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[3]);
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(5));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(6));

    const graphNodesWithThird = [
      ...baseNodes,
      { id: "c", canonical_name: "节点丙", node_kind: "causal" },
    ];
    const relationsWithThird = [
      ...baseRelations,
      { id: "bc", from_node_id: "b", to_node_id: "c", relation_type: "causal" },
    ];
    const finalGeometry = {
      graphNodes: graphNodesWithThird,
      relations: relationsWithThird,
      layoutNonce: 1,
    };
    mounted.rerender(view(canvasProps(finalGeometry)));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(7));

    mounted.rerender(view(canvasProps({ ...finalGeometry, graphScope: "project-b/graph-a" })));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(8));
  });

  it("re-initializes after an empty graph is refilled", async () => {
    const dagre = vi.spyOn(layoutGraph, "layoutWithDagre");
    const mounted = render(view(canvasProps({ graphNodes: [], relations: [] })));
    expect(dagre).not.toHaveBeenCalled();
    expect(flowMock.nodes).toEqual([]);

    mounted.rerender(view(canvasProps()));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(1));

    mounted.rerender(view(canvasProps({ graphNodes: [], relations: [] })));
    await waitFor(() => expect(flowMock.nodes).toEqual([]));
    mounted.rerender(view(canvasProps()));
    await waitFor(() => expect(dagre).toHaveBeenCalledTimes(2));
  });
});
