/**
 * GraphCanvas: The ReactFlow-based knowledge graph view.
 * Includes a top toolbar for actions and layout switching.
 */
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ConnectionLineType,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
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
import { CircleChordEdge } from "./CircleChordEdge";
import { buildFlowAriaLabelConfig } from "./flowAriaLabels";
import { nodeBoxSizeFromMaterialCount } from "./layoutGraph";
import { canvasGeometry, sameCanvasGeometry, updateCanvasLabels, type CanvasGeometry } from "./canvas-layout/canvasGeometry";
import { computeKHopNodes } from "./canvas-layout/focusNeighborhood";
import { projectCanvasNodes } from "./canvas-layout/canvasProjection";
import { computeCanvasLayout, type CanvasLayoutInput } from "./canvas-layout/layoutComputation";
import { LayoutTaskClient } from "./canvas-layout/layoutTaskClient";
import { cn } from "../lib/utils";
import type { GraphNodeRow, GraphRelationRow } from "./useGraphStore";
import i18n from "../i18n/i18n";
import { Select as AppSelect } from "../components/ui/select";

const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;
const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

function KnowledgeNode({ data, selected }: NodeProps) {
  const kind = String(data.nodeKind ?? "concept");
  const dim = Boolean((data as { focusDimmed?: boolean }).focusDimmed);
  const sizePx =
    typeof (data as { sizePx?: number }).sizePx === "number"
      ? (data as { sizePx: number }).sizePx
      : 140;
  const pad = Math.max(10, Math.round(sizePx * 0.08));
  const kindCls =
    kind === "skill"
      ? "border-violet-300 bg-violet-50/90 dark:border-violet-700 dark:bg-violet-950/60"
      : kind === "causal"
        ? "border-amber-300 bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] dark:border-amber-700 dark:bg-amber-950/60"
        : "border-[var(--or-outline)] bg-[var(--or-card)]  ";
  const kindFill =
    kind === "skill"
      ? "bg-violet-50/90 dark:bg-violet-950/60"
      : kind === "causal"
        ? "bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] dark:bg-amber-950/60"
        : "bg-[var(--or-card)] ";
  const handleCls =
    "!z-0 !h-3 !w-3 !border-2 !border-[var(--or-outline)] !bg-[var(--or-card)] dark:!border-[var(--or-outline)] dark:!bg-[var(--or-primary)]";

  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-full border text-center shadow-sm transition-opacity or-g50-static-card",
        kindCls,
        selected ? "ring-2 ring-[var(--or-focus)] ring-offset-2  " : "",
        dim ? "opacity-[0.2]" : "opacity-100",
      )}
      style={{
        width: sizePx,
        height: sizePx,
        minWidth: sizePx,
        minHeight: sizePx,
        maxWidth: sizePx,
        maxHeight: sizePx,
        padding: `${pad}px`,
      }}
    >
      <Handle
        type="target"
        id="t"
        position={Position.Top}
        isConnectable={true}
        className={handleCls}
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      />
      <Handle
        type="source"
        id="s"
        position={Position.Bottom}
        isConnectable={true}
        className={handleCls}
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      />
      <div
        className={cn(
          "absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 rounded-full",
          kindFill,
        )}
        style={{ padding: `${pad}px` }}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none shrink-0",
            kind === "skill"
              ? "bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-200"
              : kind === "causal"
                ? "bg-[var(--or-warning-container)] text-[var(--or-on-warning)] dark:bg-amber-900 dark:text-amber-200"
                : "bg-[var(--or-block)] text-[var(--or-text)]  ",
          )}
        >
          <span className="inline-block transform translate-y-[0.5px]">
            {i18n.t(`nodeKind.${kind}`, { ns: "graph", defaultValue: kind })}
          </span>
        </span>
        <div className="line-clamp-3 w-full max-w-[min(92%,11rem)] text-sm font-semibold leading-snug text-[var(--or-text)] ">
          {String(data.label ?? "")}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { knowledge: KnowledgeNode };
const edgeTypes = { circleChord: CircleChordEdge };
const WORKER_LAYOUT_MIN_NODES = 40;

interface Props {
  graphScope?: string;
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  selectedNodeId: string | null;
  layoutNonce: number;
  connectingFromId: string | null;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  onNodeDragStop: (nodeId: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onAddNode: () => void;
  onStartConnect: () => void;
  onRelayout: () => void;
  onCancelConnect: () => void;
}

export function GraphCanvas({
  graphScope = "",
  graphNodes,
  relations,
  selectedNodeId,
  layoutNonce,
  connectingFromId,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onAddNode,
  onStartConnect,
  onRelayout,
  onCancelConnect,
}: Props) {
  const { t } = useTranslation("graph");
  const ariaLabelConfig = useMemo(() => buildFlowAriaLabelConfig(t), [t]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusHops, setFocusHops] = useState<0 | 1 | 2>(0);
  const [focusCenterId, setFocusCenterId] = useState<string | null>(null);
  const [relTypeFilter, setRelTypeFilter] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const k of REL_KEYS) o[k] = true;
    return o;
  });
  const [nodeKindFilter] = useState<Record<string, boolean>>({
    concept: true, skill: true, causal: true,
  });
  const nonFocusForceBootstrappedRef = useRef(false);
  const geometryRef = useRef<CanvasGeometry | null>(null);
  const rfRef = useRef<{ fitView: (opts?: { nodes?: { id: string }[]; duration?: number; padding?: number }) => void } | null>(null);
  const layoutClientRef = useRef<LayoutTaskClient | null>(null);
  const layoutRequestRef = useRef(0);

  const filteredRelations = useMemo(() => {
    const nodeIds = new Set(graphNodes.filter((n) => nodeKindFilter[n.node_kind ?? "concept"] !== false).map((n) => n.id));
    return relations.filter((r) => {
      if (relTypeFilter[r.relation_type] === false) return false;
      return nodeIds.has(r.from_node_id) && nodeIds.has(r.to_node_id);
    });
  }, [graphNodes, relations, relTypeFilter, nodeKindFilter]);

  const filteredGraphNodes = useMemo(
    () => graphNodes.filter((n) => nodeKindFilter[n.node_kind ?? "concept"] !== false),
    [graphNodes, nodeKindFilter],
  );

  const nodeSizes = useMemo(() => {
    const m = new Map<string, { w: number; h: number }>();
    for (const n of filteredGraphNodes) {
      m.set(n.id, nodeBoxSizeFromMaterialCount(n.file_link_count ?? 0));
    }
    return m;
  }, [filteredGraphNodes]);

  const savedPositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of graphNodes) {
      if (n.layout_x != null && n.layout_y != null) {
        m.set(n.id, { x: n.layout_x, y: n.layout_y });
      }
    }
    return m;
  }, [graphNodes]);

  const focusForceLayout = focusHops > 0 && focusCenterId != null;
  const focusSet = useMemo(
    () => computeKHopNodes(focusCenterId, focusHops, filteredRelations),
    [focusCenterId, focusHops, filteredRelations],
  );

  useEffect(() => () => {
    layoutRequestRef.current += 1;
    layoutClientRef.current?.dispose();
    layoutClientRef.current = null;
  }, []);

  useEffect(() => {
    const gn = filteredGraphNodes;
    const rel = filteredRelations;
    if (!gn.length) {
      layoutRequestRef.current += 1;
      layoutClientRef.current?.cancel();
      setNodes([]);
      setEdges([]);
      geometryRef.current = null;
      return;
    }

    if (sameCanvasGeometry(geometryRef.current, gn, rel, nodeSizes, focusForceLayout, layoutNonce, graphScope)) {
      setNodes((current) => updateCanvasLabels(current, gn));
      return;
    }
    const geometry = canvasGeometry(gn, rel, nodeSizes, focusForceLayout, layoutNonce, graphScope);
    const scopeChanged = geometryRef.current !== null && geometryRef.current.scope !== graphScope;
    if (scopeChanged) {
      // Do not show the previous project's graph while its replacement is
      // being solved in a Worker.  Same-scope relayouts keep the old frame.
      setNodes([]);
      setEdges([]);
      nonFocusForceBootstrappedRef.current = false;
    }

    const baseEdges: Edge[] = rel.map((r) => ({
      id: r.id,
      source: r.from_node_id,
      target: r.to_node_id,
      data: { relationType: r.relation_type },
      zIndex: 0,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: REL_COLOR[r.relation_type] ?? "#64748b",
        strokeWidth: r.relation_type === "prerequisite" ? 1.75 : 1.25,
        opacity: 0.5,
      },
    }));

    const rfNodes: Node[] = gn.map((n) => {
      const box = nodeSizes.get(n.id) ?? nodeBoxSizeFromMaterialCount(0);
      return {
        id: n.id,
        type: "knowledge",
        position: { x: 0, y: 0 },
        width: box.w,
        height: box.h,
        zIndex: 1,
        style: { width: box.w, height: box.h, zIndex: 1 },
        data: { label: n.canonical_name, nodeKind: n.node_kind ?? "concept", sizePx: box.w },
      };
    });

    const runNonFocusForce = !nonFocusForceBootstrappedRef.current || layoutNonce > 0;
    const input: CanvasLayoutInput = {
      nodes: rfNodes,
      edges: baseEdges,
      nodeSizes: Array.from(nodeSizes.entries()),
      savedPositions: Array.from(savedPositions.entries()),
      focusForceLayout,
      runNonFocusForce,
    };
    const requestId = ++layoutRequestRef.current;
    const commit = (result: ReturnType<typeof computeCanvasLayout>) => {
      if (requestId !== layoutRequestRef.current) return;
      setNodes(result.nodes);
      setEdges(result.edges);
      geometryRef.current = geometry;
      if (runNonFocusForce && !focusForceLayout) nonFocusForceBootstrappedRef.current = true;
    };

    if (gn.length >= WORKER_LAYOUT_MIN_NODES) {
      const client = layoutClientRef.current ?? new LayoutTaskClient();
      layoutClientRef.current = client;
      const workerRequestId = client.request(
        input,
        commit,
        () => commit(computeCanvasLayout(input)),
      );
      if (workerRequestId !== null) {
        return () => {
          if (requestId === layoutRequestRef.current) layoutClientRef.current?.cancel();
        };
      }
    }

    commit(computeCanvasLayout(input));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGraphNodes, filteredRelations, savedPositions, focusForceLayout, layoutNonce, nodeSizes, graphScope]);

  // Reset focus bootstrap when graph changes
  useEffect(() => {
    nonFocusForceBootstrappedRef.current = false;
  }, [graphNodes]);

  const nodesForRender = useMemo(
    () => projectCanvasNodes(nodes, focusSet),
    [nodes, focusSet],
  );

  const edgesForRender = useMemo(
    () => edges.map((e) => {
      const dim = focusSet !== null && !(focusSet.has(e.source) && focusSet.has(e.target));
      const rt = (e.data as { relationType?: string } | undefined)?.relationType;
      const inFocusEdge = focusSet !== null && focusSet.has(e.source) && focusSet.has(e.target);
      const showRelationLabel = Boolean(focusSet && inFocusEdge && rt);
      const baseOp = focusSet === null ? 0.5 : dim ? 0.12 : 1;
      return {
        ...e,
        zIndex: 0,
        label: showRelationLabel ? i18n.t(`edgeKind.${rt}`, { ns: "graph", defaultValue: rt }) : undefined,
        labelShowBg: showRelationLabel,
        style: { ...e.style, opacity: baseOp },
      };
    }),
    [edges, focusSet],
  );

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (connectingFromId && connectingFromId !== node.id) {
      onConnect(connectingFromId, node.id);
    } else {
      onNodeClick(node.id);
    }
  }, [connectingFromId, onConnect, onNodeClick]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    onEdgeClick(edge.id);
  }, [onEdgeClick]);

  const handlePaneClick = useCallback(() => {
    if (connectingFromId) {
      onCancelConnect();
    } else {
      onPaneClick();
    }
  }, [connectingFromId, onCancelConnect, onPaneClick]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeDragStop(node.id, node.position.x, node.position.y);
  }, [onNodeDragStop]);

  return (
    <div className="flex h-full flex-col">
      {/* Canvas toolbar with mobile horizontal scroll */}
      <div className="flex items-center gap-2 border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_95%,transparent)] px-3 py-2 backdrop-blur-sm   overflow-x-auto scrollbar-none touch-pan-x sm:flex-wrap">
        {/* Action buttons */}
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

        {/* Relation type filters */}
        <div className="flex items-center gap-x-2.5 gap-y-1 text-xs shrink-0 whitespace-nowrap">
          <span className="text-[var(--or-muted)]  font-medium">{t("relTypeCanvas")}</span>
          {REL_KEYS.map((k) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 font-medium shrink-0">
              <input
                type="checkbox"
                className="rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]  "
                checked={relTypeFilter[k] !== false}
                onChange={(e) => setRelTypeFilter((prev) => ({ ...prev, [k]: e.target.checked }))}
              />
              <span style={{ color: REL_COLOR[k] ?? "#64748b" }}>{t(`edgeKind.${k}`)}</span>
            </label>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-[var(--or-inset)]  sm:inline shrink-0" aria-hidden />

        {/* Neighborhood focus */}
        <label className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0 whitespace-nowrap">
          <span className="text-[var(--or-muted)] ">{t("focusNeighborhood")}</span>
          <AppSelect
            className="or-g50-input !h-8 !text-xs !py-0"
            value={focusHops}
            onValueChange={(value) => {
              const v = Number(value) as 0 | 1 | 2;
              setFocusHops(v);
              if (v === 0) setFocusCenterId(null);
              else if (selectedNodeId) setFocusCenterId(selectedNodeId);
            }}
          >
            <option value={0}>{t("focusOff")}</option>
            <option value={1}>{t("focus1")}</option>
            <option value={2}>{t("focus2")}</option>
          </AppSelect>
        </label>
      </div>

      {/* Connection mode banner */}
      {connectingFromId ? (
        <div className="flex items-center gap-2 border-b border-[var(--or-warning)] bg-[var(--or-warning-container)] px-4 py-2 text-xs font-medium text-[var(--or-on-warning)] dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <LinkIcon className="h-4 w-4 shrink-0 text-[var(--or-on-warning)]" />
          <span>
            {t("connectModeHint")} {graphNodes.find((n) => n.id === connectingFromId)?.canonical_name ?? connectingFromId}
          </span>
        </div>
      ) : null}

      {/* ReactFlow canvas */}
      <div className="relative flex-1">
        <ReactFlow
          className="or-g50-flow"
          ariaLabelConfig={ariaLabelConfig}
          nodes={nodesForRender}
          edges={edgesForRender}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.Straight}
          elevateEdgesOnSelect={false}
          fitView
          minZoom={0.2}
          maxZoom={1.4}
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
