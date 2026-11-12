import { Pencil } from "lucide-react";
import { Select } from "../../components/ui/select";
/**
 * GraphWorkspace – Main knowledge graph page.
 *
 * Layout:
 *   [Left: SubjectSidebar] [Center: Canvas (mindmap|graph)] [Right: NodePanel]
 *
 * All shared state is managed via useGraphStore (Zustand).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, Network, ChevronLeft } from "lucide-react";
import "../../ui-redesign/g50/g50.css";
import { G50EmptyState } from "../../ui-redesign/g50/G50EmptyState";
import { G50ConnectModal } from "../../ui-redesign/g50/G50ConnectModal";
import {
  apiGraphCreateGraph,
  apiGraphCreateNode,
  apiGraphCreateRelation,
  apiGraphDeleteGraph,
  apiGraphDeleteNode,
  apiGraphDeleteRelation,
  apiGraphExportGraph,
  apiGraphGetTaxonomy,
  apiGraphImportGraph,
  apiGraphListGraphs,
  apiGraphListNodes,
  apiGraphListRelations,
  apiGraphRenameGraph,
  apiGraphUpdateNode,
} from "../../api/client";
import { useAgentActions } from "../../contexts/AgentContext";
import { useToolBarActions } from "../../contexts/ToolBarContext";
import { GraphSubjectSidebar } from "../../graph/GraphSubjectSidebar";
import { GraphCanvas } from "../../graph/GraphCanvas";
import { MindMapCanvas } from "../../graph/MindMapCanvas";
import { apiNodeToGraphRow, apiRelationToGraphRow, graphNodeRowToCreateBody } from "../../graph/graphApiMappers";
import { GraphNodePanel } from "../../graph/GraphNodePanel";
import { useGraphUndoStore } from "../../graph/useUndoStack";
import { useGraphStore, type GraphNodeRow } from "../../graph/useGraphStore";
import i18n from "../../i18n/i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import { cn } from "../../lib/utils";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import { isImeComposingKeyboardEvent } from "../../lib/ime";

type GraphWorkspaceProps = {
  onError: (s: string | null) => void;
  scope?: string;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
};

type GraphListSnapshot = {
  graphs: Awaited<ReturnType<typeof apiGraphListGraphs>>["graphs"];
  requestSeq: number;
};

export function GraphWorkspace(props: GraphWorkspaceProps) {
  const { scope } = props;
  const projectScope = useGraphStore((state) => state.projectScope);
  const bindProjectScope = useGraphStore((state) => state.bindProjectScope);

  useLayoutEffect(() => {
    if (scope === undefined) return;
    if (bindProjectScope(scope)) useGraphUndoStore.getState().clear();
  }, [scope, bindProjectScope]);

  if (scope !== undefined && projectScope !== scope) return null;
  return <GraphWorkspaceContent {...props} />;
}

function GraphWorkspaceContent({
  onError,
  scope,
  focusNodeId = null,
  onFocusConsumed,
}: GraphWorkspaceProps) {
  const { t } = useTranslation(["graph", "common"]);
  const { setPageContext } = useAgentActions();
  const { setToolBar, clearToolBar } = useToolBarActions();

  const {
    graphs, activeSlug, setGraphs, setActiveSlug,
    graphNodes, relations,
    setGraphNodes, setRelations, setSubjects, setLevels, setKindCounts,
    addGraphNode, removeGraphNode, replaceGraphNode, patchGraphNode,
    addGraphRelation, removeGraphRelations,
    selectedNodeId, selectedEdgeId, setSelectedNodeId, setSelectedEdgeId,
    viewMode, setViewMode,
    panelTab, setPanelTab, panelExpanded, setPanelExpanded,
    layoutNonce, triggerRelayout,
    connectingFromId, setConnectingFromId,
    busy, setBusy,
  } = useGraphStore();

  const isCurrentScope = useCallback(
    () => scope === undefined || useGraphStore.getState().projectScope === scope,
    [scope],
  );
  const isCurrentGraphSelection = useCallback(
    (slug: string | null) => isCurrentScope() && useGraphStore.getState().activeSlug === slug,
    [isCurrentScope],
  );
  const isCurrentGraph = useCallback(
    (slug: string | null): slug is string => slug !== null && isCurrentGraphSelection(slug),
    [isCurrentGraphSelection],
  );

  // Connect relation type pending selection
  const [pendingConnectSource, setPendingConnectSource] = useState<string | null>(null);
  const [pendingConnectTarget, setPendingConnectTarget] = useState<string | null>(null);
  const [connectRelType, setConnectRelType] = useState("related");
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarDrawerRef = useRef<HTMLDivElement | null>(null);
  const sidebarOpenTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarOpenTriggerKindRef = useRef<"header" | "toolbar">("header");

  const openMobileSidebar = useCallback((trigger: HTMLButtonElement, kind: "header" | "toolbar") => {
    sidebarOpenTriggerRef.current = trigger;
    sidebarOpenTriggerKindRef.current = kind;
    setMobileSidebarOpen(true);
  }, []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  useEffect(() => {
    if (mobileSidebarOpen) {
      sidebarDrawerRef.current
        ?.querySelector<HTMLButtonElement>("[data-graph-sidebar-close]")
        ?.focus();
      return;
    }

    if (!sidebarOpenTriggerRef.current) return;
    const currentTrigger = sidebarOpenTriggerRef.current;
    const trigger = currentTrigger?.isConnected
      ? currentTrigger
      : document.querySelector<HTMLButtonElement>(`[data-graph-sidebar-trigger="${sidebarOpenTriggerKindRef.current}"]`);
    trigger?.focus();
    sidebarOpenTriggerRef.current = null;
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isImeComposingKeyboardEvent(event)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMobileSidebar();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileSidebarOpen, closeMobileSidebar]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graphNodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [graphNodes, selectedNodeId],
  );

  // Page context for agent
  useEffect(() => {
    if (selectedNodeId && selectedNode) {
      setPageContext({
        current_page: "graph",
        selected_resource_type: "graph_node",
        selected_resource_id: selectedNodeId,
        summary: t("pageSummaryWithNode", { name: selectedNode.canonical_name }),
      });
    } else {
      setPageContext({ current_page: "graph", summary: t("pageSummaryDefault") });
    }
    return () => setPageContext(null);
  }, [selectedNodeId, selectedNode, setPageContext, t]);

  // Focus node from external (e.g. agent)
  useEffect(() => {
    if (!focusNodeId) return;
    setSelectedNodeId(focusNodeId);
    setPanelExpanded(true);
    queueMicrotask(() => onFocusConsumed?.());
  }, [focusNodeId, onFocusConsumed, setSelectedNodeId, setPanelExpanded]);

  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const graphListSeqRef = useRef(0);
  const activeSlugRef = useRef(activeSlug);
  activeSlugRef.current = activeSlug;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      loadSeqRef.current += 1;
      graphListSeqRef.current += 1;
    };
  }, []);

  // Load graph list on mount
  const loadGraphList = useCallback(async () => {
    if (!isCurrentScope() || !isMountedRef.current) return null;
    const requestSeq = ++graphListSeqRef.current;
    try {
      const r = await apiGraphListGraphs();
      if (!isMountedRef.current || requestSeq !== graphListSeqRef.current || !isCurrentScope()) return null;
      setGraphs(r.graphs);
      return { graphs: r.graphs, requestSeq } satisfies GraphListSnapshot;
    } catch (e) {
      if (isMountedRef.current && requestSeq === graphListSeqRef.current && isCurrentScope()) {
        onError(e instanceof Error ? e.message : String(e));
      }
      return null;
    }
  }, [isCurrentScope, setGraphs, onError]);

  const isCurrentGraphList = useCallback((result: GraphListSnapshot | null): result is GraphListSnapshot => (
    result !== null
      && isMountedRef.current
      && result.requestSeq === graphListSeqRef.current
      && isCurrentScope()
  ), [isCurrentScope]);

  // Load graph data for active slug with generation/identity isolation
  const loadGraphData = useCallback(async (slug: string | null) => {
    if (!isCurrentGraphSelection(slug) || slug !== activeSlugRef.current) return;
    const currentSeq = ++loadSeqRef.current;
    if (!slug) {
      if (isMountedRef.current && currentSeq === loadSeqRef.current && isCurrentGraphSelection(slug)) {
        setGraphNodes([]);
        setRelations([]);
        setBusy(false);
      }
      return;
    }
    onError(null);
    setBusy(true);
    try {
      const [n, r, tx] = await Promise.all([
        apiGraphListNodes(undefined, slug),
        apiGraphListRelations(slug),
        apiGraphGetTaxonomy(),
      ]);
      if (!isMountedRef.current || currentSeq !== loadSeqRef.current || activeSlugRef.current !== slug || !isCurrentGraphSelection(slug)) {
        return;
      }
      setGraphNodes(n.nodes);
      setKindCounts(n.kind_counts ?? {});
      setRelations(r.relations);
      setSubjects(tx.subjects?.length ? tx.subjects : [i18n.t("defaultSubject", { ns: "graph" })]);
      setLevels(tx.levels?.length ? tx.levels : [i18n.t("defaultLevel1", { ns: "graph" }), i18n.t("defaultLevel2", { ns: "graph" })]);
    } catch (e) {
      if (!isMountedRef.current || currentSeq !== loadSeqRef.current || activeSlugRef.current !== slug || !isCurrentGraphSelection(slug)) {
        return;
      }
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isMountedRef.current && currentSeq === loadSeqRef.current && activeSlugRef.current === slug && isCurrentGraphSelection(slug)) {
        setBusy(false);
      }
    }
  }, [isCurrentGraphSelection, onError, setBusy, setGraphNodes, setKindCounts, setRelations, setSubjects, setLevels]);

  // Initial load
  useEffect(() => {
    void (async () => {
      const result = await loadGraphList();
      if (!isCurrentGraphList(result)) return;
      const gs = result.graphs;
      const currentSlug = useGraphStore.getState().activeSlug;
      const nextSlug = currentSlug && gs.some((graph) => graph.slug === currentSlug)
        ? currentSlug
        : gs[0]?.slug ?? null;
      if (nextSlug !== currentSlug) setActiveSlug(nextSlug);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentGraphList, loadGraphList, setActiveSlug]);

  // Reload when active slug changes
  useEffect(() => {
    void loadGraphData(activeSlug);
  }, [activeSlug, loadGraphData]);

  const reloadActiveGraphData = useCallback(async () => {
    await loadGraphData(activeSlug);
  }, [loadGraphData, activeSlug]);

  const pushUndoFrame = useCallback((f: { undo: () => Promise<void>; redo: () => Promise<void> }) => {
    if (!isCurrentScope()) return;
    useGraphUndoStore.getState().pushFrame(f);
  }, [isCurrentScope]);

  useEffect(() => {
    useGraphUndoStore.getState().clear();
  }, [activeSlug]);

  // Keyboard save shortcut
  useEffect(() => {
    const onSave = () => { /* panel handles its own save */ };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, []);

  // Create new graph
  const handleCreateGraph = useCallback(async (displayName: string) => {
    if (!isCurrentScope()) return;
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphCreateGraph({ display_name: displayName });
      if (!isCurrentScope()) return;
      const result = await loadGraphList();
      if (!isCurrentGraphList(result)) return;
      setActiveSlug(r.slug);
    } catch (e) {
      if (isCurrentScope()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  }, [isCurrentScope, isCurrentGraphList, setBusy, onError, loadGraphList, setActiveSlug]);

  const handleDeleteGraph = useCallback(async (slug: string) => {
    if (!isCurrentScope()) return;
    const graph = graphs.find((g) => g.slug === slug);
    const ok = await confirmDialog(t("confirmDeleteGraph", { name: graph?.display_name ?? slug }));
    if (!ok || !isCurrentScope()) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphDeleteGraph(slug);
      if (!isCurrentScope()) return;
      const result = await loadGraphList();
      if (!isCurrentGraphList(result)) return;
      if (useGraphStore.getState().activeSlug === slug) {
        setActiveSlug(result.graphs[0]?.slug ?? null);
      }
    } catch (e) {
      if (isCurrentScope()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  }, [isCurrentScope, isCurrentGraphList, graphs, t, setBusy, onError, loadGraphList, setActiveSlug]);

  const handleRenameGraph = useCallback(async (slug: string, newName: string) => {
    if (!isCurrentScope()) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphRenameGraph(slug, newName);
      if (!isCurrentScope()) return;
      await loadGraphList();
    } catch (e) {
      if (isCurrentScope()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  }, [isCurrentScope, setBusy, onError, loadGraphList]);

  const handleExportGraph = useCallback(async () => {
    if (!isCurrentScope() || !activeSlug) return;
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphExportGraph(activeSlug);
      if (!isCurrentScope()) return;
      const graph = graphs.find((g) => g.slug === activeSlug);
      const filename = `${graph?.display_name || activeSlug}-graph.json`;
      const blob = new Blob([JSON.stringify(r.bundle, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (isCurrentScope()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  }, [isCurrentScope, activeSlug, graphs, onError, setBusy]);

  const handleImportGraph = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!isCurrentScope()) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    onError(null);
    try {
      const text = await file.text();
      if (!isCurrentScope()) return;
      const bundle = JSON.parse(text) as Record<string, unknown>;
      const r = await apiGraphImportGraph({ bundle });
      if (!isCurrentScope()) return;
      const result = await loadGraphList();
      if (!isCurrentGraphList(result)) return;
      setActiveSlug(r.slug);
    } catch (e) {
      if (isCurrentScope()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  }, [isCurrentScope, isCurrentGraphList, loadGraphList, onError, setActiveSlug, setBusy]);

  // Add orphan node
  const handleAddNode = useCallback(async () => {
    if (!isCurrentGraph(activeSlug)) return;
    const name = t("newNodeDefaultName");
    const nodeId = `${activeSlug}/node-${Date.now()}`;
    const draft: GraphNodeRow = {
      id: nodeId,
      canonical_name: name,
      node_kind: "concept",
      subject: null,
      level: null,
      primary_parent_id: null,
    };
    addGraphNode(draft);
    setSelectedNodeId(nodeId);
    setPanelExpanded(true);
    setPanelTab("edit");
    onError(null);
    try {
      const r = await apiGraphCreateNode(
        {
          canonical_name: name,
          aliases: [],
          node_kind: "concept",
          subject: null,
          level: null,
          description: null,
          tags: [],
          source: null,
          id: nodeId,
        },
        activeSlug,
      );
      if (!isCurrentGraph(activeSlug)) return;
      const row = apiNodeToGraphRow(r.node as Record<string, unknown>, r.node_id);
      replaceGraphNode(nodeId, row);
      void loadGraphList();
      pushUndoFrame({
        undo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          await apiGraphDeleteNode(row.id, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          removeGraphNode(row.id);
          void loadGraphList();
        },
        redo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          const r2 = await apiGraphCreateNode(
            {
              canonical_name: name,
              aliases: [],
              node_kind: "concept",
              subject: null,
              level: null,
              description: null,
              tags: [],
              source: null,
              id: `${activeSlug}/node-${Date.now()}`,
            },
            activeSlug,
          );
          if (!isCurrentGraph(activeSlug)) return;
          const row2 = apiNodeToGraphRow(r2.node as Record<string, unknown>, r2.node_id);
          addGraphNode(row2);
          setSelectedNodeId(row2.id);
          void loadGraphList();
        },
      });
    } catch (e) {
      if (isCurrentGraph(activeSlug)) {
        removeGraphNode(nodeId);
        onError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [
    isCurrentGraph,
    activeSlug,
    t,
    addGraphNode,
    removeGraphNode,
    replaceGraphNode,
    setSelectedNodeId,
    setPanelExpanded,
    setPanelTab,
    onError,
    loadGraphList,
    pushUndoFrame,
  ]);

  // Add child node (mindmap Tab shortcut)
  const handleAddChildNode = useCallback(async (parentId: string) => {
    if (!isCurrentGraph(activeSlug)) return;
    const parent = graphNodes.find((n) => n.id === parentId);
    if (!parent) return;
    const name = t("newNodeDefaultName");
    const tempId = `__optimistic__/c-${Date.now()}`;
    const draft: GraphNodeRow = {
      id: tempId,
      canonical_name: name,
      node_kind: "concept",
      subject: parent.subject ?? null,
      level: parent.level ?? null,
      primary_parent_id: parentId,
    };
    addGraphNode(draft);
    setSelectedNodeId(tempId);
    setPanelExpanded(true);
    setPanelTab("edit");
    onError(null);
    try {
      const r = await apiGraphCreateNode(
        {
          canonical_name: name,
          aliases: [],
          node_kind: "concept",
          subject: parent.subject ?? null,
          level: parent.level ?? null,
          description: null,
          tags: [],
          source: null,
          parent_node_id: parentId,
          primary_parent_id: parentId,
        },
        activeSlug,
      );
      if (!isCurrentGraph(activeSlug)) return;
      const row = apiNodeToGraphRow(r.node as Record<string, unknown>, r.node_id);
      replaceGraphNode(tempId, row);
      const rel = apiRelationToGraphRow(r.relation as Record<string, unknown> | null | undefined);
      if (rel) addGraphRelation(rel);
      void loadGraphList();
      pushUndoFrame({
        undo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          await apiGraphDeleteNode(row.id, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          removeGraphNode(row.id);
          void loadGraphList();
        },
        redo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          const r2 = await apiGraphCreateNode(
            {
              canonical_name: name,
              aliases: [],
              node_kind: "concept",
              subject: parent.subject ?? null,
              level: parent.level ?? null,
              description: null,
              tags: [],
              source: null,
              parent_node_id: parentId,
              primary_parent_id: parentId,
            },
            activeSlug,
          );
          if (!isCurrentGraph(activeSlug)) return;
          const row2 = apiNodeToGraphRow(r2.node as Record<string, unknown>, r2.node_id);
          addGraphNode(row2);
          const rel2 = apiRelationToGraphRow(r2.relation as Record<string, unknown> | null | undefined);
          if (rel2) addGraphRelation(rel2);
          setSelectedNodeId(row2.id);
          void loadGraphList();
        },
      });
    } catch (e) {
      if (isCurrentGraph(activeSlug)) {
        removeGraphNode(tempId);
        onError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [
    isCurrentGraph,
    activeSlug,
    graphNodes,
    t,
    addGraphNode,
    removeGraphNode,
    replaceGraphNode,
    addGraphRelation,
    setSelectedNodeId,
    setPanelExpanded,
    setPanelTab,
    onError,
    loadGraphList,
    pushUndoFrame,
  ]);

  // Add sibling node (mindmap Enter shortcut)
  const handleAddSiblingNode = useCallback(async (siblingId: string) => {
    const sibling = graphNodes.find((n) => n.id === siblingId);
    if (!sibling) return;
    if (sibling.primary_parent_id) {
      await handleAddChildNode(sibling.primary_parent_id);
    } else {
      await handleAddNode();
    }
  }, [graphNodes, handleAddChildNode, handleAddNode]);

  // Persist layout drag
  const handleNodeDragStop = useCallback(async (nodeId: string, x: number, y: number) => {
    if (!isCurrentGraph(activeSlug)) return;
    const n = graphNodes.find((g) => g.id === nodeId);
    if (!n) return;
    try {
      await apiGraphUpdateNode(nodeId, {
        id: nodeId,
        node_kind: n.node_kind ?? "concept",
        canonical_name: n.canonical_name,
        aliases: n.aliases ?? [],
        subject: n.subject ?? null,
        level: n.level ?? null,
        description: n.description ?? null,
        tags: n.tags ?? [],
        layout_x: x,
        layout_y: y,
        primary_parent_id: n.primary_parent_id ?? null,
      }, activeSlug);
      if (!isCurrentGraph(activeSlug)) return;
      setGraphNodes(graphNodes.map((p) => p.id === nodeId ? { ...p, layout_x: x, layout_y: y } : p));
    } catch (e) {
      if (isCurrentGraph(activeSlug)) onError(e instanceof Error ? e.message : String(e));
    }
  }, [isCurrentGraph, graphNodes, activeSlug, onError, setGraphNodes]);

  // Rename node inline
  const handleRenameNode = useCallback(async (nodeId: string, newName: string) => {
    if (!isCurrentGraph(activeSlug)) return;
    const n = graphNodes.find((g) => g.id === nodeId);
    if (!n) return;
    const prev = n.canonical_name;
    patchGraphNode(nodeId, { canonical_name: newName });
    try {
      await apiGraphUpdateNode(nodeId, {
        ...n,
        id: nodeId,
        canonical_name: newName,
      }, activeSlug);
      if (!isCurrentGraph(activeSlug)) return;
      pushUndoFrame({
        undo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          patchGraphNode(nodeId, { canonical_name: prev });
          await apiGraphUpdateNode(nodeId, {
            ...n,
            id: nodeId,
            canonical_name: prev,
          }, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
        },
        redo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          patchGraphNode(nodeId, { canonical_name: newName });
          await apiGraphUpdateNode(nodeId, {
            ...n,
            id: nodeId,
            canonical_name: newName,
          }, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
        },
      });
    } catch (e) {
      if (isCurrentGraph(activeSlug)) {
        patchGraphNode(nodeId, { canonical_name: prev });
        onError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [isCurrentGraph, graphNodes, activeSlug, onError, patchGraphNode, pushUndoFrame]);

  // Connect
  const handleStartConnect = useCallback(() => {
    if (!selectedNodeId) return;
    setConnectingFromId(selectedNodeId);
  }, [selectedNodeId, setConnectingFromId]);

  const handleCancelConnect = useCallback(() => {
    setConnectingFromId(null);
    setShowConnectDialog(false);
    setPendingConnectSource(null);
    setPendingConnectTarget(null);
  }, [setConnectingFromId]);

  const handleConnect = useCallback((sourceId: string, targetId: string) => {
    setPendingConnectSource(sourceId);
    setPendingConnectTarget(targetId);
    setShowConnectDialog(true);
    setConnectingFromId(null);
  }, [setConnectingFromId]);

  const commitConnect = useCallback(async () => {
    if (!isCurrentGraph(activeSlug) || !pendingConnectSource || !pendingConnectTarget) return;
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphCreateRelation({
        from_node_id: pendingConnectSource,
        to_node_id: pendingConnectTarget,
        relation_type: connectRelType,
      }, activeSlug);
      if (!isCurrentGraph(activeSlug)) return;
      addGraphRelation({
        id: r.relation_id,
        from_node_id: pendingConnectSource,
        to_node_id: pendingConnectTarget,
        relation_type: connectRelType,
      });
      const src = pendingConnectSource;
      const tgt = pendingConnectTarget;
      const rt = connectRelType;
      pushUndoFrame({
        undo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          await apiGraphDeleteRelation(r.relation_id, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          removeGraphRelations((rel) => rel.id === r.relation_id);
        },
        redo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          const r2 = await apiGraphCreateRelation({
            from_node_id: src,
            to_node_id: tgt,
            relation_type: rt,
          }, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          addGraphRelation({
            id: r2.relation_id,
            from_node_id: src,
            to_node_id: tgt,
            relation_type: rt,
          });
        },
      });
    } catch (e) {
      if (isCurrentGraph(activeSlug)) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrentGraph(activeSlug)) {
        setBusy(false);
        setShowConnectDialog(false);
        setPendingConnectSource(null);
        setPendingConnectTarget(null);
      }
    }
  }, [
    isCurrentGraph,
    pendingConnectSource,
    pendingConnectTarget,
    connectRelType,
    activeSlug,
    setBusy,
    onError,
    addGraphRelation,
    removeGraphRelations,
    pushUndoFrame,
  ]);

  const handlePanelDeleteNode = useCallback(async () => {
    if (!isCurrentGraph(activeSlug) || !selectedNode) return;
    const node = selectedNode;
    const ok = await confirmDialog(t("confirmDeleteNode", { name: node.canonical_name, defaultValue: 'Delete node "{{name}}"? This cannot be undone.' }));
    if (!ok || !isCurrentGraph(activeSlug)) return;
    const snapRels = relations.filter(
      (r) => r.from_node_id === node.id || r.to_node_id === node.id,
    );
    removeGraphNode(node.id);
    onError(null);
    try {
      const del = await apiGraphDeleteNode(node.id, activeSlug);
      if (!isCurrentGraph(activeSlug)) return;
      void loadGraphList();
      const saved = del.deleted_node
        ? apiNodeToGraphRow(del.deleted_node as Record<string, unknown>, node.id)
        : node;
      const savedRels = (del.deleted_relations ?? [])
        .map((x) => apiRelationToGraphRow(x as Record<string, unknown>))
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      pushUndoFrame({
        undo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          await apiGraphCreateNode(graphNodeRowToCreateBody(saved), activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          for (const rel of savedRels) {
            if (!isCurrentGraph(activeSlug)) return;
            try {
              await apiGraphCreateRelation(
                {
                  from_node_id: rel.from_node_id,
                  to_node_id: rel.to_node_id,
                  relation_type: rel.relation_type,
                },
                activeSlug,
              );
            } catch {
              if (!isCurrentGraph(activeSlug)) return;
              /* 幂等：可能已由创建节点写入 */
            }
            if (!isCurrentGraph(activeSlug)) return;
          }
          await loadGraphData(activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          void loadGraphList();
        },
        redo: async () => {
          if (!isCurrentGraph(activeSlug)) return;
          await apiGraphDeleteNode(saved.id, activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          removeGraphNode(saved.id);
          await loadGraphData(activeSlug);
          if (!isCurrentGraph(activeSlug)) return;
          void loadGraphList();
        },
      });
    } catch (e) {
      if (!isCurrentGraph(activeSlug)) return;
      addGraphNode(node);
      for (const r of snapRels) addGraphRelation(r);
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [
    isCurrentGraph,
    activeSlug,
    selectedNode,
    t,
    relations,
    removeGraphNode,
    addGraphNode,
    addGraphRelation,
    onError,
    loadGraphList,
    loadGraphData,
    pushUndoFrame,
  ]);

  const handleMindMapDeleteSelectedNode = useCallback(async () => {
    await handlePanelDeleteNode();
    if (isCurrentGraph(activeSlug)) setSelectedNodeId(null);
  }, [handlePanelDeleteNode, isCurrentGraph, activeSlug, setSelectedNodeId]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPanelExpanded(true);
    setPanelTab("edit");
  }, [setSelectedNodeId, setPanelExpanded, setPanelTab]);

  const handleEdgeClick = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    // Find nodes connected to this edge to open panel
    const rel = relations.find((r) => r.id === edgeId);
    if (rel) {
      setSelectedNodeId(rel.from_node_id);
      setPanelExpanded(true);
      setPanelTab("edit");
    }
  }, [setSelectedEdgeId, setSelectedNodeId, relations, setPanelExpanded, setPanelTab]);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const activeGraphInfo = useMemo(
    () => graphs.find((g) => g.slug === activeSlug),
    [graphs, activeSlug],
  );

  // Mind map / graph view toggle in app menubar (ToolBar)
  useEffect(() => {
    const left: ReactNode = (
      <div className="or-g50-mode-tabs items-center rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-0.5 shadow-sm  ">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
            viewMode === "mindmap"
              ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm "
              : "text-[var(--or-muted)] hover:text-[var(--or-text)]  dark:hover:text-[var(--or-text)]",
          )}
          onClick={() => setViewMode("mindmap")}
        >
          <span className="inline-block transform translate-y-[0.5px]">
            {t("viewMindmap")}
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
            viewMode === "graph"
              ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm "
              : "text-[var(--or-muted)] hover:text-[var(--or-text)]  dark:hover:text-[var(--or-text)]",
          )}
          onClick={() => setViewMode("graph")}
        >
          <span className="inline-block transform translate-y-[0.5px]">
            {t("viewGraph")}
          </span>
        </button>
      </div>
    );
    const mobileMode = <div className="or-g50-mode-mobile">
      <Select aria-label="图谱视图" value={viewMode} onValueChange={(value) => setViewMode(value as "mindmap" | "graph")}>
        <option value="mindmap">{t("viewMindmap")}</option><option value="graph">{t("viewGraph")}</option>
      </Select>
    </div>;
    const right = <div className="or-g50-mobile-actions">
      <button type="button" className="or-g50-btn or-g50-btn-secondary" onClick={(event) => openMobileSidebar(event.currentTarget, "toolbar")} title={t("graphsTitle")} aria-label={t("graphsTitle")} aria-expanded={mobileSidebarOpen} aria-controls="graph-subject-sidebar" data-graph-sidebar-trigger="toolbar">
        <Network className="h-4 w-4" />
        {!(selectedNode && !panelExpanded) ? <span className="max-w-16 truncate">{activeGraphInfo?.display_name ?? t("graphsTitle")}</span> : null}
      </button>
      {selectedNode && !panelExpanded ? <button type="button" className="or-g50-btn or-g50-btn-tonal" onClick={() => setPanelExpanded(true)} aria-label={t("expandMaintain")} title={t("expandMaintain")}><Pencil className="h-4 w-4" /></button> : null}
      <button type="button" className="or-g50-btn or-g50-btn-secondary" disabled={busy} onClick={() => importInputRef.current?.click()} aria-label="导入" title="导入"><Upload className="h-4 w-4" /></button>
      <button type="button" className="or-g50-btn or-g50-btn-secondary" disabled={busy || !activeSlug} onClick={() => void handleExportGraph()} aria-label="导出" title="导出"><Download className="h-4 w-4" /></button>
    </div>;
    setToolBar({ left: <>{left}{mobileMode}</>, right });
    return () => clearToolBar();
  }, [viewMode, setViewMode, t, setToolBar, clearToolBar, selectedNode, panelExpanded, activeGraphInfo, busy, activeSlug, handleExportGraph, setPanelExpanded, openMobileSidebar, mobileSidebarOpen]);

  const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;

  return (
    <div className="or-g50-container h-full min-h-[70vh] flex flex-col gap-3 p-3">
          <input
            ref={importInputRef}
            type="file"
            data-testid="graph-import-file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportGraph(event)}
          />
      {/* Top Workspace Header Bar */}
      <div className="or-g50-header or-g50-desktop-header">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile drawer toggle */}
          <button
            type="button"
            className="md:!hidden or-g50-btn or-g50-btn-secondary !h-8 !px-2.5 !text-xs font-medium shrink-0"
            onClick={(event) => openMobileSidebar(event.currentTarget, "header")}
            title={t("graphsTitle")}
            aria-label={t("graphsTitle")}
            aria-expanded={mobileSidebarOpen}
            aria-controls="graph-subject-sidebar"
            data-testid="graph-sidebar-open"
            data-graph-sidebar-trigger="header"
          >
            <Network className="h-3.5 w-3.5 text-[var(--or-on-container)]  shrink-0" />
            <span className="max-w-[120px] truncate">
              {activeGraphInfo?.display_name ?? t("graphsTitle")}
            </span>
          </button>

          <div className="hidden md:flex or-g50-header-title">
            <Network className="h-5 w-5 text-[var(--or-on-container)] " />
            <span>知识图谱</span>
          </div>

          {activeGraphInfo && (
            <span className="hidden md:inline-flex items-center rounded-full bg-[var(--or-block)]  px-2.5 py-0.5 text-xs font-medium text-[var(--or-muted)] ">
              {activeGraphInfo.display_name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile quick-open node panel if a node is selected but panel was collapsed */}
          {selectedNode && !panelExpanded && (
            <button
              type="button"
              onClick={() => setPanelExpanded(true)}
              className="lg:!hidden or-g50-btn or-g50-btn-primary !h-8 !px-2.5 !text-xs font-medium"
              title={t("expandMaintain")}
            >
              <span className="max-w-[80px] truncate">{selectedNode.canonical_name}</span>
            </button>
          )}

          <button
            type="button"
            data-testid="graph-import-button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
            className="or-g50-btn or-g50-btn-secondary !h-8 !px-2 sm:!px-3 !text-xs font-medium"
            title="导入"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导入</span>
          </button>
          <button
            type="button"
            data-testid="graph-export-button"
            disabled={busy || !activeSlug}
            onClick={() => void handleExportGraph()}
            className="or-g50-btn or-g50-btn-secondary !h-8 !px-2 sm:!px-3 !text-xs font-medium"
            title="导出"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导出</span>
          </button>
        </div>
      </div>

      {/* Main 3-column / 2-column workspace */}
      <div className="flex min-h-0 flex-1 flex-row gap-3">
        {/* Left: Subject selector (responsive drawer on mobile, inline on md+) */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
            onClick={closeMobileSidebar}
            aria-hidden="true"
          />
        )}
        <div
          className={cn(
            "md:flex md:w-56 lg:w-60 md:shrink-0",
            mobileSidebarOpen
              ? "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-2xl animate-in slide-in-from-left duration-200 md:!static md:!inset-auto md:!z-auto md:!w-56 md:!max-w-none md:!shadow-none md:!animate-none lg:!w-60"
              : "hidden",
          )}
          ref={sidebarDrawerRef}
          id="graph-subject-sidebar"
        >
          <GraphSubjectSidebar
            graphs={graphs}
            activeSlug={activeSlug}
            onSelect={(slug) => {
              setActiveSlug(slug);
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              closeMobileSidebar();
            }}
            onCreateGraph={handleCreateGraph}
            onDeleteGraph={handleDeleteGraph}
            onRenameGraph={handleRenameGraph}
            busy={busy}
            onClose={closeMobileSidebar}
          />
        </div>

        {/* Center: Canvas Area */}
        <div className="or-g50-canvas-wrapper flex-1 relative">
          {busy && graphNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm font-medium text-[var(--or-muted)] ">
              {t("loading")}
            </div>
          ) : activeSlug === null ? (
            <G50EmptyState
              busy={busy}
              onCreateGraph={handleCreateGraph}
            />
          ) : viewMode === "mindmap" ? (
            <MindMapCanvas
              graphNodes={graphNodes}
              relations={relations}
              selectedNodeId={selectedNodeId}
              layoutNonce={layoutNonce}
              connectingFromId={connectingFromId}
              activeGraphName={activeGraphInfo?.display_name ?? activeSlug ?? ""}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onAddNode={handleAddNode}
              onAddChildNode={handleAddChildNode}
              onAddSiblingNode={handleAddSiblingNode}
              onDeleteSelectedNode={handleMindMapDeleteSelectedNode}
              onStartConnect={handleStartConnect}
              onRelayout={triggerRelayout}
              onCancelConnect={handleCancelConnect}
              onRenameNode={handleRenameNode}
            />
          ) : (
            <GraphCanvas
              graphScope={activeSlug ?? ""}
              graphNodes={graphNodes}
              relations={relations}
              selectedNodeId={selectedNodeId}
              layoutNonce={layoutNonce}
              connectingFromId={connectingFromId}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onAddNode={handleAddNode}
              onStartConnect={handleStartConnect}
              onRelayout={triggerRelayout}
              onCancelConnect={handleCancelConnect}
            />
          )}

          {/* Floating edit button on mobile when a node is selected but panel is collapsed */}
          {selectedNode && !panelExpanded && (
            <div className="absolute bottom-4 right-4 z-20 lg:hidden">
              <button
                type="button"
                className="or-g50-btn or-g50-btn-primary shadow-lg !h-9 !px-3.5 !text-xs font-semibold rounded-full flex items-center gap-1.5"
                onClick={() => setPanelExpanded(true)}
              >
                <span className="max-w-[120px] truncate">{selectedNode.canonical_name}</span>
                <span className="text-white/80">· {t("panelTabEdit")}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: Detail panel or collapse handle (responsive drawer on mobile/tablet, inline on lg+) */}
        {panelExpanded ? (
          <>
            {/* Mobile/tablet backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:hidden"
              onClick={() => setPanelExpanded(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[92vw] sm:max-w-md flex-col shadow-2xl lg:relative lg:inset-auto lg:z-auto lg:w-[380px] lg:max-w-[380px] xl:w-[420px] xl:max-w-[420px] lg:shadow-none animate-in slide-in-from-right duration-200 lg:animate-none">
              <GraphNodePanel
                selectedNode={selectedNode}
                relations={relations}
                graphNodes={graphNodes}
                activeSlug={activeSlug}
                tab={panelTab}
                onTabChange={setPanelTab}
                onSaved={reloadActiveGraphData}
                onDeleteNode={handlePanelDeleteNode}
                onDeleted={() => { setSelectedNodeId(null); }}
                onError={onError}
                onClose={() => setPanelExpanded(false)}
                highlightEdgeId={selectedEdgeId}
              />
            </div>
          </>
        ) : selectedNode ? (
          <button
            type="button"
            className="hidden lg:flex w-10 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] py-4 shadow-sm hover:bg-[var(--or-page)]   dark:hover:bg-[var(--or-primary)] transition-colors"
            onClick={() => setPanelExpanded(true)}
            title={t("expandMaintain")}
          >
            <ChevronLeft className="h-4 w-4 text-[var(--or-muted)]" />
            <span className="[writing-mode:vertical-rl] text-xs font-medium text-[var(--or-muted)]  tracking-wider">
              {t("expandMaintain")}
            </span>
          </button>
        ) : null}
      </div>

      {/* Connect relation type dialog modal */}
      <G50ConnectModal
        isOpen={showConnectDialog}
        sourceNodeName={
          graphNodes.find((n) => n.id === pendingConnectSource)?.canonical_name ??
          pendingConnectSource ??
          ""
        }
        targetNodeName={
          graphNodes.find((n) => n.id === pendingConnectTarget)?.canonical_name ??
          pendingConnectTarget ??
          ""
        }
        connectRelType={connectRelType}
        onSelectRelType={setConnectRelType}
        onConfirm={() => void commitConnect()}
        onCancel={handleCancelConnect}
        busy={busy}
        relKeys={REL_KEYS}
      />
    </div>
  );
}
