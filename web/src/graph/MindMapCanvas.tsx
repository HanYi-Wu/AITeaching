/**
 * MindMapCanvas: Tree-based mind map view using ReactFlow with LR tree layout.
 * - Uses primary_parent_id for tree structure
 * - Nodes without primary_parent_id are direct children of the virtual root
 * - Cross-references (non-primary part_of, prerequisite, related, causal): dashed curves + labels, off by default; toolbar toggles per relation type
 * - Supports keyboard shortcuts: Tab (child), Enter (sibling), Delete (delete)
 * - Supports inline rename on double-click
 * - Supports collapse/expand
 */
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Plus, Link as LinkIcon, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import type { GraphNodeRow, GraphRelationRow } from "./useGraphStore";
import { useGraphUndoStore } from "./useUndoStack";
import { isImeComposingKeyboardEvent } from "../lib/ime";
import i18n from "../i18n/i18n";

// Virtual root sentinel
const VIRTUAL_ROOT_ID = "__virtual_root__";

const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;

const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

// ---------------------------------------------------------------------------
// Tree layout (LR, horizontal)
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string;
  children: TreeNode[];
  y: number;
  x: number;
  subtreeHeight: number;
}

const NODE_W = 168;
const NODE_H = 48;
const H_GAP = 80;
const V_GAP = 16;

function buildTree(
  nodes: GraphNodeRow[],
  rootId: string,
  childrenByParent: Map<string, string[]>,
  collapsed: Set<string>,
): TreeNode {
  const children = collapsed.has(rootId)
    ? []
    : (childrenByParent.get(rootId) ?? []).map((cid) =>
        buildTree(nodes, cid, childrenByParent, collapsed),
      );

  const subtreeHeight =
    children.length === 0
      ? NODE_H
      : children.reduce((acc, c) => acc + c.subtreeHeight + V_GAP, -V_GAP);

  return { id: rootId, children, y: 0, x: 0, subtreeHeight };
}

function assignPositions(
  node: TreeNode,
  x: number,
  y: number,
  isVirtualRoot = false,
): void {
  node.x = x;
  node.y = y + node.subtreeHeight / 2 - NODE_H / 2;

  let curY = y;
  for (const child of node.children) {
    assignPositions(child, x + NODE_W + H_GAP, curY, isVirtualRoot);
    curY += child.subtreeHeight + V_GAP;
  }
}

function flattenTree(node: TreeNode): { id: string; x: number; y: number }[] {
  const result: { id: string; x: number; y: number }[] = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    result.push({ id: n.id, x: n.x, y: n.y });
    for (const c of n.children) stack.push(c);
  }
  return result;
}

type TreePosition = { id: string; x: number; y: number };

/** Build an ID index with Array.find's first-match behavior for duplicate IDs. */
function indexFirstPositionById(positions: TreePosition[]): Map<string, TreePosition> {
  const byId = new Map<string, TreePosition>();
  for (const position of positions) {
    if (!byId.has(position.id)) byId.set(position.id, position);
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Node component
// ---------------------------------------------------------------------------

function MindMapNodeInner({ data, selected }: NodeProps) {
  const kind = String(data.nodeKind ?? "concept");
  const isVirtualRoot = Boolean((data as { isVirtualRoot?: boolean }).isVirtualRoot);
  const isCollapsed = Boolean((data as { isCollapsed?: boolean }).isCollapsed);
  const hasChildren = Boolean((data as { hasChildren?: boolean }).hasChildren);
  const isInlineEditing = Boolean((data as { isInlineEditing?: boolean }).isInlineEditing);
  const inlineValue = String((data as { inlineValue?: string }).inlineValue ?? data.label ?? "");
  const onInlineChange = (data as { onInlineChange?: (v: string) => void }).onInlineChange;
  const onInlineCommit = (data as { onInlineCommit?: (value: string) => void }).onInlineCommit;
  const onToggleCollapse = (data as { onToggleCollapse?: () => void }).onToggleCollapse;

  if (isVirtualRoot) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border-2 border-[var(--or-primary)] bg-[var(--or-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] shadow-md   or-g50-static-card",
          selected ? "ring-2 ring-[var(--or-focus)] ring-offset-2" : "",
        )}
        style={{ minWidth: NODE_W, minHeight: NODE_H }}
      >
        <Handle
          type="source"
          id="s"
          position={Position.Right}
          isConnectable={true}
          className="!border-0 !bg-slate-500"
        />
        <span className="line-clamp-2 text-center">{String(data.label ?? "")}</span>
      </div>
    );
  }

  const kindBorder =
    kind === "skill"
      ? "border-violet-300 bg-violet-50/90 dark:border-violet-700 dark:bg-violet-950/50"
      : kind === "causal"
        ? "border-amber-300 bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] dark:border-amber-700 dark:bg-amber-950/50"
        : "border-[var(--or-outline)] bg-[var(--or-card)]  ";

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-xl border shadow-sm transition-all or-g50-static-card",
        kindBorder,
        selected
          ? "ring-2 ring-[var(--or-focus)] ring-offset-2  "
          : "hover:border-[var(--or-outline)] dark:hover:border-[var(--or-outline)]",
      )}
      style={{ minWidth: NODE_W, minHeight: NODE_H, width: NODE_W, height: NODE_H }}
    >
      <Handle
        type="target"
        id="t"
        position={Position.Left}
        isConnectable={true}
        className="!h-2.5 !w-2.5 !border-2 !border-[var(--or-outline)] !bg-[var(--or-card)] dark:!border-[var(--or-outline)] dark:!bg-[var(--or-primary)]"
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1">
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none shrink-0",
            kind === "skill"
              ? "bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-200"
              : kind === "causal"
                ? "bg-[var(--or-warning-container)] text-[var(--or-on-warning)] dark:bg-amber-900 dark:text-amber-200"
                : "bg-[var(--or-block)] text-[var(--or-muted)]  ",
          )}
          style={{ width: "fit-content", marginBottom: 3 }}
        >
          <span className="inline-block transform translate-y-[0.5px]">
            {i18n.t(`nodeKind.${kind}`, { ns: "graph", defaultValue: kind })}
          </span>
        </span>

        {isInlineEditing ? (
          <input
            className="w-full rounded-lg border border-[var(--or-primary)] px-1.5 py-0.5 text-sm font-medium outline-none  "
            autoFocus
            value={inlineValue}
            onChange={(e) => onInlineChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposingKeyboardEvent(e)) return;
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                onInlineCommit?.(e.currentTarget.value);
              }
            }}
            onBlur={(e) => onInlineCommit?.(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="line-clamp-2 text-sm font-medium text-[var(--or-text)] ">
            {String(data.label ?? "")}
          </span>
        )}
      </div>

      <Handle
        type="source"
        id="s"
        position={Position.Right}
        isConnectable={true}
        className="!h-2.5 !w-2.5 !border-2 !border-[var(--or-outline)] !bg-[var(--or-card)] dark:!border-[var(--or-outline)] dark:!bg-[var(--or-primary)]"
      />

      {hasChildren ? (
        <button
          type="button"
          className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] text-xs font-bold text-[var(--or-muted)] shadow-sm hover:bg-[var(--or-block)]    dark:hover:bg-slate-700"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
        >
          <span className="inline-block transform -translate-y-[0.5px]">
            {isCollapsed ? "+" : "−"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

const nodeTypes = { mindmap: MindMapNodeInner };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  selectedNodeId: string | null;
  layoutNonce: number;
  connectingFromId: string | null;
  activeGraphName: string;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  onNodeDragStop: (nodeId: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onAddNode: () => void;
  onAddChildNode: (parentId: string) => void;
  onAddSiblingNode: (siblingId: string) => void;
  /** Delete/Backspace — same behavior as sidebar delete; React Flow built-in delete is disabled */
  onDeleteSelectedNode?: () => void | Promise<void>;
  onStartConnect: () => void;
  onRelayout: () => void;
  onCancelConnect: () => void;
  onRenameNode: (nodeId: string, newName: string) => Promise<void>;
}

export function MindMapCanvas({
  graphNodes,
  relations,
  selectedNodeId,
  layoutNonce,
  connectingFromId,
  activeGraphName,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onAddNode,
  onAddChildNode,
  onAddSiblingNode,
  onDeleteSelectedNode,
  onStartConnect,
  onRelayout,
  onCancelConnect,
  onRenameNode,
}: Props) {
  const { t } = useTranslation("graph");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [crossRelTypeFilter, setCrossRelTypeFilter] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const k of REL_KEYS) o[k] = false;
    return o;
  });
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const inlineEditValueRef = useRef("");
  // The state rebuilds callbacks for same-node re-edits; the ref stays current across async saves.
  const [inlineEditGeneration, setInlineEditGeneration] = useState(0);
  const inlineEditGenerationRef = useRef(0);
  const rfRef = useRef<{ fitView: (opts?: any) => void } | null>(null);

  const updateInlineEditValue = useCallback((value: string) => {
    inlineEditValueRef.current = value;
    setInlineEditValue(value);
  }, []);

  // Build children map by primary_parent_id
  const childrenByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    // Virtual root children = nodes without primary_parent_id
    m.set(VIRTUAL_ROOT_ID, []);
    for (const n of graphNodes) {
      if (!n.primary_parent_id) {
        m.get(VIRTUAL_ROOT_ID)!.push(n.id);
      } else {
        if (!m.has(n.primary_parent_id)) m.set(n.primary_parent_id, []);
        m.get(n.primary_parent_id)!.push(n.id);
      }
    }
    return m;
  }, [graphNodes]);

  // Layout
  useEffect(() => {
    if (!graphNodes.length) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));

    // Build tree
    const tree = buildTree(graphNodes, VIRTUAL_ROOT_ID, childrenByParent, collapsed);
    assignPositions(tree, 0, 0, true);
    const positions = flattenTree(tree);
    const positionById = indexFirstPositionById(positions);

    // Build RF nodes
    const rfNodes: Node[] = [
      {
        id: VIRTUAL_ROOT_ID,
        type: "mindmap",
        position: { x: 0, y: positionById.get(VIRTUAL_ROOT_ID)?.y ?? 0 },
        data: {
          label: activeGraphName,
          isVirtualRoot: true,
          hasChildren: (childrenByParent.get(VIRTUAL_ROOT_ID) ?? []).length > 0,
          isCollapsed: collapsed.has(VIRTUAL_ROOT_ID),
          onToggleCollapse: () =>
            setCollapsed((prev) => {
              const n = new Set(prev);
              if (n.has(VIRTUAL_ROOT_ID)) n.delete(VIRTUAL_ROOT_ID);
              else n.add(VIRTUAL_ROOT_ID);
              return n;
            }),
        },
        width: NODE_W,
        height: NODE_H,
        zIndex: 1,
        style: { width: NODE_W, height: NODE_H, zIndex: 1 },
      },
    ];

    const editGeneration = inlineEditGenerationRef.current;
    for (const n of graphNodes) {
      const pos = positionById.get(n.id);
      if (!pos) continue;
      const hasChildren = (childrenByParent.get(n.id) ?? []).length > 0;
      const isCollapsedNode = collapsed.has(n.id);
      const isEditing = inlineEditId === n.id;
      rfNodes.push({
        id: n.id,
        type: "mindmap",
        position: { x: pos.x, y: pos.y },
        data: {
          label: n.canonical_name,
          nodeKind: n.node_kind ?? "concept",
          hasChildren,
          isCollapsed: isCollapsedNode,
          isInlineEditing: isEditing,
          inlineValue: isEditing ? inlineEditValueRef.current : n.canonical_name,
          onInlineChange: updateInlineEditValue,
          onInlineCommit: async (value: string) => {
            const nextName = value.trim();
            if (nextName && nextName !== n.canonical_name) {
              await onRenameNode(n.id, nextName);
            }
            if (inlineEditGenerationRef.current === editGeneration) setInlineEditId(null);
          },
          onToggleCollapse: () =>
            setCollapsed((prev) => {
              const ns = new Set(prev);
              if (ns.has(n.id)) ns.delete(n.id);
              else ns.add(n.id);
              return ns;
            }),
        },
        width: NODE_W,
        height: NODE_H,
        zIndex: 1,
        style: { width: NODE_W, height: NODE_H, zIndex: 1 },
      });
    }

    // Tree edges
    const rfEdges: Edge[] = [];
    for (const n of graphNodes) {
      const parentId = n.primary_parent_id ?? VIRTUAL_ROOT_ID;
      rfEdges.push({
        id: `tree-${parentId}-${n.id}`,
        source: parentId,
        target: n.id,
        sourceHandle: "s",
        targetHandle: "t",
        type: "default",
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      });
    }

    // Cross-reference edges (non-primary relations)
    for (const r of relations) {
      const isPrimaryEdge = (() => {
        const targetNode = nodeById.get(r.to_node_id);
        if (!targetNode) return false;
        return (
          r.relation_type === "part_of" &&
          targetNode.primary_parent_id === r.from_node_id
        );
      })();

      if (isPrimaryEdge) continue;
      if (crossRelTypeFilter[r.relation_type] !== true) continue;

      rfEdges.push({
        id: `cross-${r.id}`,
        source: r.from_node_id,
        target: r.to_node_id,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: {
          stroke: REL_COLOR[r.relation_type] ?? "#64748b",
          strokeWidth: 1,
          strokeDasharray: "5,4",
          opacity: 0.6,
        },
        label: t(`edgeKind.${r.relation_type}`, { defaultValue: r.relation_type }),
        labelStyle: { fontSize: 11, fill: REL_COLOR[r.relation_type] ?? "#64748b" },
        labelShowBg: true,
        labelBgStyle: { fill: "white", opacity: 0.8 },
      });
    }

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [
    graphNodes,
    relations,
    childrenByParent,
    collapsed,
    crossRelTypeFilter,
    inlineEditId,
    inlineEditGeneration,
    activeGraphName,
    layoutNonce,
    t,
    onRenameNode,
    updateInlineEditValue,
  ]);

  // Draft keystrokes update only the active custom node. Tree geometry and edges do not depend
  // on the draft text, so keep their full rebuild tied to edit start/end and graph state changes.
  useEffect(() => {
    if (!inlineEditId) return;
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((node) => {
        if (node.id !== inlineEditId || node.data.inlineValue === inlineEditValue) return node;
        changed = true;
        return { ...node, data: { ...node.data, inlineValue: inlineEditValue } };
      });
      return changed ? next : prev;
    });
  }, [inlineEditId, inlineEditValue, setNodes]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isImeComposingKeyboardEvent(e)) return;
      if (inlineEditId) return; // editing mode, ignore
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            void useGraphUndoStore.getState().redo();
          } else {
            void useGraphUndoStore.getState().undo();
          }
          return;
        }
        if (k === "y") {
          e.preventDefault();
          void useGraphUndoStore.getState().redo();
          return;
        }
      }

      if (!selectedNodeId || selectedNodeId === VIRTUAL_ROOT_ID) return;

      if (e.key === "Tab") {
        e.preventDefault();
        onAddChildNode(selectedNodeId);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onAddSiblingNode(selectedNodeId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void onDeleteSelectedNode?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId, inlineEditId, onAddChildNode, onAddSiblingNode, onDeleteSelectedNode]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === VIRTUAL_ROOT_ID) {
      onPaneClick();
      return;
    }
    if (connectingFromId && connectingFromId !== node.id) {
      onConnect(connectingFromId, node.id);
    } else {
      onNodeClick(node.id);
    }
  }, [connectingFromId, onConnect, onNodeClick, onPaneClick]);

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === VIRTUAL_ROOT_ID) return;
    const nextEditGeneration = inlineEditGenerationRef.current + 1;
    inlineEditGenerationRef.current = nextEditGeneration;
    setInlineEditGeneration(nextEditGeneration);
    setInlineEditId(node.id);
    const gn = graphNodes.find((n) => n.id === node.id);
    updateInlineEditValue(gn?.canonical_name ?? "");
  }, [graphNodes, updateInlineEditValue]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (edge.id.startsWith("cross-")) {
      onEdgeClick(edge.id.slice(6));
    }
  }, [onEdgeClick]);

  const handlePaneClick = useCallback(() => {
    setInlineEditId(null);
    if (connectingFromId) {
      onCancelConnect();
    } else {
      onPaneClick();
    }
  }, [connectingFromId, onCancelConnect, onPaneClick]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id !== VIRTUAL_ROOT_ID) {
      onNodeDragStop(node.id, node.position.x, node.position.y);
    }
  }, [onNodeDragStop]);

  return (
    <div className="flex h-full flex-col">
      {/* Canvas toolbar with mobile horizontal scroll */}
      <div className="flex items-center gap-2 border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_95%,transparent)] px-3 py-2 backdrop-blur-sm   overflow-x-auto scrollbar-none touch-pan-x sm:flex-wrap">
        <button
          type="button"
          className="or-g50-btn or-g50-btn-secondary !h-8 !text-xs font-medium shrink-0 whitespace-nowrap"
          onClick={onAddNode}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span>{t("addNode")}</span>
        </button>

        {connectingFromId ? (
          <button
            type="button"
            className="or-g50-btn or-g50-btn-tonal !h-8 !text-xs font-medium !bg-[var(--or-warning-container)] !text-[var(--or-on-warning)] hover:!bg-[var(--or-warning-container)] dark:!bg-amber-950/70 dark:!text-amber-200 shrink-0 whitespace-nowrap"
            onClick={onCancelConnect}
          >
            <X className="h-3.5 w-3.5 shrink-0" />
            <span>{t("cancelConnect")}</span>
          </button>
        ) : (
          <button
            type="button"
            className="or-g50-btn or-g50-btn-secondary !h-8 !text-xs font-medium shrink-0 whitespace-nowrap"
            onClick={onStartConnect}
            disabled={!selectedNodeId}
          >
            <LinkIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{t("addRelation")}</span>
          </button>
        )}

        <button
          type="button"
          className="or-g50-btn or-g50-btn-secondary !h-8 !text-xs font-medium shrink-0 whitespace-nowrap"
          onClick={onRelayout}
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          <span>{t("relayout")}</span>
        </button>

        <span className="hidden h-4 w-px bg-[var(--or-inset)]  sm:inline shrink-0" aria-hidden />

        <div className="flex items-center gap-x-2.5 gap-y-1 text-xs shrink-0 whitespace-nowrap">
          <span className="text-[var(--or-muted)]  font-medium">{t("relTypeMindmap")}</span>
          {REL_KEYS.map((k) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 font-medium shrink-0">
              <input
                type="checkbox"
                className="rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]  "
                checked={crossRelTypeFilter[k] === true}
                onChange={(e) => setCrossRelTypeFilter((prev) => ({ ...prev, [k]: e.target.checked }))}
              />
              <span style={{ color: REL_COLOR[k] ?? "#64748b" }}>{t(`edgeKind.${k}`)}</span>
            </label>
          ))}
        </div>

        <span className="hidden text-xs text-[var(--or-muted)]  sm:inline shrink-0 whitespace-nowrap">
          {t("mindmapHint")}
        </span>
      </div>

      {connectingFromId ? (
        <div className="flex items-center gap-2 border-b border-[var(--or-warning)] bg-[var(--or-warning-container)] px-4 py-2 text-xs font-medium text-[var(--or-on-warning)] dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <LinkIcon className="h-4 w-4 shrink-0 text-[var(--or-on-warning)]" />
          <span>
            {t("connectModeHint")} {graphNodes.find((n) => n.id === connectingFromId)?.canonical_name ?? connectingFromId}
          </span>
        </div>
      ) : null}

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          deleteKeyCode={null}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.Straight}
          fitView
          minZoom={0.15}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  );
}
