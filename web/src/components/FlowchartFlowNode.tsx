import { Handle, Position, useEdges, type NodeProps } from "@xyflow/react";

/** React Flow node with draggable connection handles (TD: top/bottom, LR: left/right). */
export function FlowchartFlowNode({ data, id }: NodeProps) {
  const dir = (data as { dir?: "TD" | "LR" }).dir ?? "TD";
  const isLR = dir === "LR";
  const label = String((data as { label?: string }).label ?? "");
  const edges = useEdges();
  const outgoing = edges.filter((edge) => edge.source === id);
  const isBranch = outgoing.length > 1 && outgoing.some((edge) => typeof edge.label === "string" && edge.label.trim());

  return (
    <div className={`flowchart-flow-node${isBranch ? " flowchart-flow-node--branch" : ""}`}>
      <Handle
        type="target"
        position={isLR ? Position.Left : Position.Top}
        className="flowchart-flow-handle"
      />
      <div className="flowchart-flow-node__label">{label}</div>
      <Handle
        type="source"
        position={isLR ? Position.Right : Position.Bottom}
        className="flowchart-flow-handle"
      />
    </div>
  );
}
