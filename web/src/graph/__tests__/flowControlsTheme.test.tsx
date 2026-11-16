import { render, screen } from "@testing-library/react";
import type { AriaLabelConfig } from "@xyflow/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n/i18n";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { buildFlowAriaLabelConfig } from "../flowAriaLabels";
import { GraphCanvas } from "../GraphCanvas";
import { MindMapCanvas } from "../MindMapCanvas";
import type { GraphNodeRow } from "../useGraphStore";

const flowPropsSpy = vi.hoisted(() => ({
  calls: [] as Array<{ className?: string; ariaLabelConfig?: Partial<AriaLabelConfig> }>,
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");

  function ReactFlow(props: {
    className?: string;
    ariaLabelConfig?: Partial<AriaLabelConfig>;
    children?: React.ReactNode;
  }) {
    flowPropsSpy.calls.push({
      className: props.className,
      ariaLabelConfig: props.ariaLabelConfig,
    });
    return React.createElement(
      "div",
      {
        "data-testid": "rf-mock",
        className: props.className,
      },
      props.children,
    );
  }

  return {
    ...actual,
    Background: () => null,
    MiniMap: () => null,
    ReactFlow,
    useNodesState: () => [[], vi.fn(), vi.fn()],
    useEdgesState: () => [[], vi.fn(), vi.fn()],
  };
});

const sampleNodes: GraphNodeRow[] = [
  { id: "n1", canonical_name: "函数", node_kind: "concept" },
];

const noOp = () => undefined;
const noOpAsync = async () => undefined;

describe("knowledge graph bottom-left flow controls theme and localization", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  it("builds localized aria-label tooltips for zoom, fit-view, lock, and minimap in zh and en", async () => {
    await setupTestI18n("zh");
    const zhT = i18n.getFixedT("zh", "graph");
    expect(buildFlowAriaLabelConfig(zhT)).toEqual({
      "controls.ariaLabel": "画布视图控制",
      "controls.zoomIn.ariaLabel": "放大画布",
      "controls.zoomOut.ariaLabel": "缩小画布",
      "controls.fitView.ariaLabel": "适应画布视图",
      "controls.interactive.ariaLabel": "锁定或解锁画布拖动",
      "minimap.ariaLabel": "画布缩略图",
    });

    const enT = i18n.getFixedT("en", "graph");
    expect(buildFlowAriaLabelConfig(enT)).toEqual({
      "controls.ariaLabel": "Canvas controls",
      "controls.zoomIn.ariaLabel": "Zoom in",
      "controls.zoomOut.ariaLabel": "Zoom out",
      "controls.fitView.ariaLabel": "Fit view",
      "controls.interactive.ariaLabel": "Toggle canvas interactivity",
      "minimap.ariaLabel": "Mini map",
    });
  });

  it("wires or-g50-flow className, localized ariaLabelConfig, and all four control buttons on both canvases", async () => {
    await setupTestI18n("zh");
    flowPropsSpy.calls.length = 0;

    const { ReactFlowProvider } = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");

    const { container } = render(
      <TestI18nProvider>
        <ReactFlowProvider>
          <GraphCanvas
            graphScope="math"
            graphNodes={sampleNodes}
            relations={[]}
            selectedNodeId={null}
            layoutNonce={0}
            connectingFromId={null}
            onNodeClick={noOp}
            onEdgeClick={noOp}
            onPaneClick={noOp}
            onNodeDragStop={noOp}
            onConnect={noOp}
            onAddNode={noOpAsync}
            onStartConnect={noOp}
            onRelayout={noOp}
            onCancelConnect={noOp}
          />
          <MindMapCanvas
            graphNodes={sampleNodes}
            relations={[]}
            selectedNodeId={null}
            layoutNonce={0}
            connectingFromId={null}
            activeGraphName="数学"
            onNodeClick={noOp}
            onEdgeClick={noOp}
            onPaneClick={noOp}
            onNodeDragStop={noOp}
            onConnect={noOp}
            onAddNode={noOpAsync}
            onAddChildNode={noOpAsync}
            onAddSiblingNode={noOpAsync}
            onDeleteSelectedNode={noOpAsync}
            onStartConnect={noOp}
            onRelayout={noOp}
            onCancelConnect={noOp}
            onRenameNode={noOpAsync}
          />
        </ReactFlowProvider>
      </TestI18nProvider>,
    );

    const wrappers = screen.getAllByTestId("rf-mock");
    expect(wrappers).toHaveLength(2);
    for (const wrapper of wrappers) {
      expect(wrapper).toHaveClass("or-g50-flow");
      const controlButtons = wrapper.querySelectorAll(".react-flow__controls .react-flow__controls-button");
      expect(controlButtons).toHaveLength(4);
      controlButtons.forEach((btn) => {
        expect(btn.querySelector("svg")).not.toBeNull();
      });
    }

    expect(container.querySelectorAll(".or-g50-flow .react-flow__controls")).toHaveLength(2);
    expect(flowPropsSpy.calls).toHaveLength(2);
    for (const call of flowPropsSpy.calls) {
      expect(call.className).toBe("or-g50-flow");
      expect(call.ariaLabelConfig?.["controls.zoomIn.ariaLabel"]).toBe("放大画布");
      expect(call.ariaLabelConfig?.["controls.zoomOut.ariaLabel"]).toBe("缩小画布");
      expect(call.ariaLabelConfig?.["controls.fitView.ariaLabel"]).toBe("适应画布视图");
      expect(call.ariaLabelConfig?.["controls.interactive.ariaLabel"]).toBe("锁定或解锁画布拖动");
    }
  });
});
