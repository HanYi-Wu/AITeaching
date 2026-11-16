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
import "../ui-redesign/g50/g50.css";
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
import { buildFlowAriaLabelConfig } from "./flowAriaLabels";
import {
  layoutMindMapPositions,
  MIND_MAP_NODE_H as NODE_H,
  MIND_MAP_NODE_W as NODE_W,
} from "./mindMapLayout";
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
// Node component
// ---------------------------------------------------------------------------

function MindMapNodeInner({ id, data, selected }: NodeProps) {
  const kind = String(data.nodeKind ?? "concept");
  const isVirtualRoot = Boolean((data as { isVirtualRoot?: boolean }).isVirtualRoot);
  const isCollapsed = Boolean((data as { isCollapsed?: boolean }).isCollapsed);
  const hasChildren = Boolean((data as { hasChildren?: boolean }).hasChildren);
  const isInlineEditing = Boolean((data as { isInlineEditing?: boolean }).isInlineEditing);
  const inlineValue = String((data as { inlineValue?: string }).inlineValue ?? data.label ?? "");
  const onInlineChange = (data as { onInlineChange?: (v: string) => void }).onInlineChange;
  const onInlineCommit = (data as { onInlineCommit?: (value: string) => void }).onInlineCommit;
  const onToggleCollapse = (data as { onToggleCollapse?: (nodeId: string) => void }).onToggleCollapse;

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
            onToggleCollapse?.(id);
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

type MindMapProjectionData = {
  label: string;
  sourceIndex?: number;
  isVirtualRoot?: boolean;
  nodeKind?: string;
  hasChildren?: boolean;
  isCollapsed?: boolean;
  isInlineEditing?: boolean;
  inlineValue?: string;
  onInlineChange?: (value: string) => void;
  onInlineCommit?: (value: string) => Promise<void>;
  onToggleCollapse?: (nodeId: string) => void;
};

type MindMapTopology = {
  childrenByParent: Map<string, string[]>;
  primaryParentById: Map<string, string | null | undefined>;
  treeEdges: Edge[];
};

const NODE_STYLE = { width: NODE_W, height: NODE_H, zIndex: 1 };

function hasSameMindMapTopology(previous: GraphNodeRow[], current: GraphNodeRow[]) {
  if (previous.length !== current.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (
      previous[index].id !== current[index].id ||
      previous[index].primary_parent_id !== current[index].primary_parent_id
    ) {
      return false;
    }
  }
  return true;
}

function buildMindMapTopology(graphNodes: GraphNodeRow[]): MindMapTopology {
  const childrenByParent = new Map<string, string[]>();
  childrenByParent.set(VIRTUAL_ROOT_ID, []);
  const primaryParentById = new Map<string, string | null | undefined>();
  const treeEdges: Edge[] = [];

  for (const node of graphNodes) {
    if (!node.primary_parent_id) {
      childrenByParent.get(VIRTUAL_ROOT_ID)!.push(node.id);
    } else {
      if (!childrenByParent.has(node.primary_parent_id)) {
        childrenByParent.set(node.primary_parent_id, []);
      }
      childrenByParent.get(node.primary_parent_id)!.push(node.id);
    }
    // Map.set intentionally keeps the same last-row-wins primary-parent lookup
    // as the previous graphNodes-to-nodeById projection.
    primaryParentById.set(node.id, node.primary_parent_id);
    const parentId = node.primary_parent_id ?? VIRTUAL_ROOT_ID;
    treeEdges.push({
      id: `tree-${parentId}-${node.id}`,
      source: parentId,
      target: node.id,
      sourceHandle: "s",
      targetHandle: "t",
      type: "default",
      style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    });
  }

  return { childrenByParent, primaryParentById, treeEdges };
}

function buildCrossReferenceEdges(
  graphHasNodes: boolean,
  relations: GraphRelationRow[],
  primaryParentById: Map<string, string | null | undefined>,
  crossRelTypeFilter: Record<string, boolean>,
  t: (key: string, options?: { defaultValue?: string }) => string,
): Edge[] {
  if (!graphHasNodes) return [];
  const edges: Edge[] = [];
  for (const relation of relations) {
    const isPrimaryEdge =
      relation.relation_type === "part_of" &&
      primaryParentById.has(relation.to_node_id) &&
      primaryParentById.get(relation.to_node_id) === relation.from_node_id;
    if (isPrimaryEdge || crossRelTypeFilter[relation.relation_type] !== true) continue;

    const color = REL_COLOR[relation.relation_type] ?? "#64748b";
    edges.push({
      id: `cross-${relation.id}`,
      source: relation.from_node_id,
      target: relation.to_node_id,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: {
        stroke: color,
        strokeWidth: 1,
        strokeDasharray: "5,4",
        opacity: 0.6,
      },
      label: t(`edgeKind.${relation.relation_type}`, { defaultValue: relation.relation_type }),
      labelStyle: { fontSize: 11, fill: color },
      labelShowBg: true,
      labelBgStyle: { fill: "white", opacity: 0.8 },
    });
  }
  return edges;
}

function sameShallowStyle(left: unknown, right: unknown) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function sameEdgeProjection(previous: Edge, next: Edge) {
  return previous.id === next.id &&
    previous.source === next.source &&
    previous.target === next.target &&
    previous.sourceHandle === next.sourceHandle &&
    previous.targetHandle === next.targetHandle &&
    previous.type === next.type &&
    previous.label === next.label &&
    previous.labelShowBg === next.labelShowBg &&
    sameShallowStyle(previous.markerEnd, next.markerEnd) &&
    sameShallowStyle(previous.style, next.style) &&
    sameShallowStyle(previous.labelStyle, next.labelStyle) &&
    sameShallowStyle(previous.labelBgStyle, next.labelBgStyle);
}

function reconcileMindMapEdges(previous: Edge[], projected: Edge[]): Edge[] {
  const previousById = new Map<string, Edge[]>();
  for (const edge of previous) {
    const matches = previousById.get(edge.id);
    if (matches) matches.push(edge);
    else previousById.set(edge.id, [edge]);
  }

  const offsetsById = new Map<string, number>();
  let unchanged = previous.length === projected.length;
  const next = projected.map((edge, index) => {
    const matches = previousById.get(edge.id);
    const offset = offsetsById.get(edge.id) ?? 0;
    offsetsById.set(edge.id, offset + 1);
    const prior = matches?.[offset];
    if (!prior) {
      unchanged = false;
      return edge;
    }
    if (sameEdgeProjection(prior, edge)) {
      if (prior !== previous[index]) unchanged = false;
      return prior;
    }
    unchanged = false;
    return { ...prior, ...edge, selected: prior.selected };
  });
  return unchanged ? previous : next;
}

function sameMindMapNodeData(previous: Node["data"], next: MindMapProjectionData) {
  const current = previous as MindMapProjectionData;
  if (Boolean(current.isVirtualRoot) !== Boolean(next.isVirtualRoot)) return false;
  if (next.isVirtualRoot) {
    return current.label === next.label &&
      current.hasChildren === next.hasChildren &&
      current.isCollapsed === next.isCollapsed &&
      current.onToggleCollapse === next.onToggleCollapse;
  }
  return current.label === next.label &&
    current.sourceIndex === next.sourceIndex &&
    current.nodeKind === next.nodeKind &&
    current.hasChildren === next.hasChildren &&
    current.isCollapsed === next.isCollapsed &&
    current.isInlineEditing === next.isInlineEditing &&
    current.inlineValue === next.inlineValue &&
    current.onInlineChange === next.onInlineChange &&
    current.onInlineCommit === next.onInlineCommit &&
    current.onToggleCollapse === next.onToggleCollapse;
}

function projectMindMapNode(
  previous: Node | undefined,
  id: string,
  position: { x: number; y: number },
  data: MindMapProjectionData,
): Node {
  if (
    previous &&
    previous.id === id &&
    previous.type === "mindmap" &&
    previous.position.x === position.x &&
    previous.position.y === position.y &&
    previous.width === NODE_W &&
    previous.height === NODE_H &&
    previous.zIndex === 1 &&
    previous.style?.width === NODE_W &&
    previous.style?.height === NODE_H &&
    previous.style?.zIndex === 1 &&
    sameMindMapNodeData(previous.data, data)
  ) {
    return previous;
  }
  return {
    ...(previous ?? {}),
    id,
    type: "mindmap",
    position,
    data,
    width: NODE_W,
    height: NODE_H,
    zIndex: 1,
    style: NODE_STYLE,
  };
}

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
  const ariaLabelConfig = useMemo(() => buildFlowAriaLabelConfig(t), [t]);
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
  const topologyCacheRef = useRef<{ rows: GraphNodeRow[]; topology: MindMapTopology } | null>(null);
  const previousLayoutPositionsRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  const previousInlineEditIdRef = useRef<string | null>(null);
  const graphNodesRef = useRef(graphNodes);
  graphNodesRef.current = graphNodes;
  const inlineCommitHandlersRef = useRef(new Map<number, {
    nodeId: string;
    canonicalName: string;
    generation: number;
    handler: (value: string) => Promise<void>;
  }>());
  const onRenameNodeRef = useRef(onRenameNode);
  onRenameNodeRef.current = onRenameNode;

  const updateInlineEditValue = useCallback((value: string) => {
    inlineEditValueRef.current = value;
    setInlineEditValue(value);
  }, []);

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const getInlineCommitHandler = useCallback((
    node: GraphNodeRow,
    sourceIndex: number,
    isEditing: boolean,
  ) => {
    const previous = inlineCommitHandlersRef.current.get(sourceIndex);
    const currentGeneration = inlineEditGenerationRef.current;
    if (
      previous &&
      previous.nodeId === node.id &&
      previous.canonicalName === node.canonical_name &&
      (!isEditing || previous.generation === currentGeneration)
    ) {
      return previous.handler;
    }

    const generation = isEditing ? currentGeneration : previous?.generation ?? currentGeneration;
    const canonicalName = node.canonical_name;
    const handler = async (value: string) => {
      const nextName = value.trim();
      if (nextName && nextName !== canonicalName) {
        await onRenameNodeRef.current(node.id, nextName);
      }
      if (inlineEditGenerationRef.current === generation) setInlineEditId(null);
    };
    inlineCommitHandlersRef.current.set(sourceIndex, {
      nodeId: node.id,
      canonicalName,
      generation,
      handler,
    });
    return handler;
  }, []);

  // Keep topology, layout, tree edges, node data, and relation edges on separate
  // dependency paths. Label and editor changes can then reuse the tree geometry.
  const graphTopology = useMemo(() => {
    const cached = topologyCacheRef.current;
    if (cached && hasSameMindMapTopology(cached.rows, graphNodes)) return cached.topology;
    return buildMindMapTopology(graphNodes);
  }, [graphNodes]);

  useEffect(() => {
    topologyCacheRef.current = { rows: graphNodes, topology: graphTopology };
  }, [graphNodes, graphTopology]);

  const positionById = useMemo(() => {
    if (!graphNodes.length) return new Map<string, { x: number; y: number }>();
    // layoutNonce remains an explicit relayout trigger; unrelated projections
    // never call the layout engine.
    return layoutMindMapPositions(VIRTUAL_ROOT_ID, graphTopology.childrenByParent, collapsed);
  }, [graphNodes.length, graphTopology, collapsed, layoutNonce]);

  const crossReferenceEdges = useMemo(
    () => buildCrossReferenceEdges(
      graphNodes.length > 0,
      relations,
      graphTopology.primaryParentById,
      crossRelTypeFilter,
      t,
    ),
    [graphNodes.length, relations, graphTopology, crossRelTypeFilter, t],
  );

  const projectedEdges = useMemo(
    () => [...graphTopology.treeEdges, ...crossReferenceEdges],
    [graphTopology, crossReferenceEdges],
  );

  useEffect(() => {
    setEdges((previous) => reconcileMindMapEdges(previous, projectedEdges));
  }, [projectedEdges, setEdges]);

  // inlineEditId is excluded so an editor transition patches only its old/new
  // rows below instead of re-projecting the full graph.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const applyLayout = previousLayoutPositionsRef.current !== positionById;
    setNodes((previous) => {
      if (!graphNodes.length) return previous.length ? [] : previous;

      const previousById = new Map<string, Node[]>();
      for (const node of previous) {
        const matches = previousById.get(node.id);
        if (matches) matches.push(node);
        else previousById.set(node.id, [node]);
      }
      const offsetsById = new Map<string, number>();
      const takePrevious = (id: string) => {
        const matches = previousById.get(id);
        const offset = offsetsById.get(id) ?? 0;
        offsetsById.set(id, offset + 1);
        return matches?.[offset];
      };

      const next: Node[] = [];
      const virtualRootPosition = positionById.get(VIRTUAL_ROOT_ID);
      next.push(projectMindMapNode(
        takePrevious(VIRTUAL_ROOT_ID),
        VIRTUAL_ROOT_ID,
        { x: 0, y: virtualRootPosition?.y ?? 0 },
        {
          label: activeGraphName,
          isVirtualRoot: true,
          hasChildren: (graphTopology.childrenByParent.get(VIRTUAL_ROOT_ID) ?? []).length > 0,
          isCollapsed: collapsed.has(VIRTUAL_ROOT_ID),
          onToggleCollapse: toggleCollapse,
        },
      ));

      graphNodes.forEach((node, sourceIndex) => {
        const position = positionById.get(node.id);
        if (!position) return;
        const hasChildren = (graphTopology.childrenByParent.get(node.id) ?? []).length > 0;
        const isEditing = inlineEditId === node.id;
        const previousNode = takePrevious(node.id);
        const nodePosition = previousNode && !applyLayout ? previousNode.position : position;
        next.push(projectMindMapNode(previousNode, node.id, nodePosition, {
          label: node.canonical_name,
          sourceIndex,
          nodeKind: node.node_kind ?? "concept",
          hasChildren,
          isCollapsed: collapsed.has(node.id),
          isInlineEditing: isEditing,
          inlineValue: isEditing ? inlineEditValueRef.current : node.canonical_name,
          onInlineChange: updateInlineEditValue,
          onInlineCommit: getInlineCommitHandler(node, sourceIndex, isEditing),
          onToggleCollapse: toggleCollapse,
        }));
      });

      for (const sourceIndex of inlineCommitHandlersRef.current.keys()) {
        if (sourceIndex >= graphNodes.length) inlineCommitHandlersRef.current.delete(sourceIndex);
      }

      if (next.length === previous.length && next.every((node, index) => node === previous[index])) {
        return previous;
      }
      return next;
    });
    previousLayoutPositionsRef.current = positionById;
  }, [
    graphNodes,
    graphTopology,
    positionById,
    collapsed,
    activeGraphName,
    updateInlineEditValue,
    getInlineCommitHandler,
    toggleCollapse,
    setNodes,
  ]);

  // Editor open/close changes only the previous and current editor rows. The
  // graph-node projection above handles actual graph data refreshes separately.
  // The current graph rows are read only during the editor transition; graph
  // data refreshes are handled by the projection effect above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const previousEditId = previousInlineEditIdRef.current;
    const changedIds = new Set([previousEditId, inlineEditId].filter((id): id is string => id !== null));
    if (!changedIds.size) return;
    setNodes((previous) => {
      let changed = false;
      const next = previous.map((node) => {
        if (!changedIds.has(node.id) || node.data.isVirtualRoot) return node;
        const sourceIndex = Number(node.data.sourceIndex);
        const graphNode = graphNodes[sourceIndex];
        if (!graphNode || graphNode.id !== node.id) return node;
        const isEditing = inlineEditId === node.id;
        const inlineValue = isEditing ? inlineEditValueRef.current : graphNode.canonical_name;
        const onInlineCommit = getInlineCommitHandler(graphNode, sourceIndex, isEditing);
        if (
          node.data.isInlineEditing === isEditing &&
          node.data.inlineValue === inlineValue &&
          node.data.onInlineCommit === onInlineCommit
        ) {
          return node;
        }
        changed = true;
        return {
          ...node,
          data: { ...node.data, isInlineEditing: isEditing, inlineValue, onInlineCommit },
        };
      });
      return changed ? next : previous;
    });
    previousInlineEditIdRef.current = inlineEditId;
  }, [inlineEditId, inlineEditGeneration, setNodes, getInlineCommitHandler]);

  // Draft keystrokes patch only the active custom node. Tree geometry and edges
  // do not depend on draft text and stay on their own projection paths.
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
    const gn = graphNodesRef.current.find((n) => n.id === node.id);
    updateInlineEditValue(gn?.canonical_name ?? "");
  }, [updateInlineEditValue]);

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
          className="or-g50-flow"
          ariaLabelConfig={ariaLabelConfig}
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
