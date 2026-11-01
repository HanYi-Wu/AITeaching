import { Handle, Position, type NodeProps } from "@xyflow/react";

/** React Flow node with draggable connection handles (TD: top/bottom, LR: left/right). */
export function FlowchartFlowNode({ data }: NodeProps) {
  const dir = (data as { dir?: "TD" | "LR" }).dir ?? "TD";
  const isLR = dir === "LR";
  const label = String((data as { label?: string }).label ?? "");

  return (
    <div className="min-w-[4.5rem] max-w-[14rem] rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-center text-sm shadow-xs hover:border-[var(--or-outline)] transition-colors">
      <Handle
        type="target"
        position={isLR ? Position.Left : Position.Top}
        className="!h-2.5 !w-2.5 !rounded-full !border !border-[var(--or-outline)] !bg-[var(--or-inset)] hover:!bg-slate-400 transition-colors"
      />
      <div className="break-words font-medium text-[var(--or-text)]">{label}</div>
      <Handle
        type="source"
        position={isLR ? Position.Right : Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-full !border !border-[var(--or-outline)] !bg-[var(--or-inset)] hover:!bg-slate-400 transition-colors"
      />
    </div>
  );
}
