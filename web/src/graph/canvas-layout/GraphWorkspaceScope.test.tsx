import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProvider } from "../../contexts/AgentContext";
import { ToolBarProvider } from "../../contexts/ToolBarContext";
import * as clientApi from "../../api/client";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { useGraphStore } from "../useGraphStore";
import { useGraphUndoStore } from "../useUndoStack";
import { confirmDialog } from "../../lib/confirmDialog";

vi.mock("../GraphCanvas", () => ({
  GraphCanvas: ({ onAddNode }: { onAddNode: () => Promise<void> }) => (
    <button type="button" data-testid="add-node" onClick={() => void onAddNode()}>Add node</button>
  ),
}));
vi.mock("../MindMapCanvas", () => ({ MindMapCanvas: () => null }));
vi.mock("../GraphSubjectSidebar", () => ({
  GraphSubjectSidebar: ({
    activeSlug,
    onSelect,
    onRenameGraph,
  }: {
    activeSlug: string | null;
    onSelect: (slug: string) => void;
    onRenameGraph: (slug: string, name: string) => Promise<void>;
  }) => (
    <div>
      <div data-testid="active-slug">{activeSlug ?? "none"}</div>
      <button type="button" data-testid="switch-to-graph-b" onClick={() => onSelect("graph-b")}>Switch graph</button>
      {activeSlug && (
        <button type="button" data-testid="rename-current-graph" onClick={() => void onRenameGraph(activeSlug, "Renamed")}>Rename graph</button>
      )}
    </div>
  ),
}));
vi.mock("../GraphNodePanel", () => ({
  GraphNodePanel: ({
    selectedNode,
    onDeleteNode,
  }: {
    selectedNode: { id: string } | null;
    onDeleteNode: () => Promise<void>;
  }) => selectedNode
    ? <button type="button" data-testid="delete-selected" onClick={() => void onDeleteNode()}>Delete selected</button>
    : null,
}));
vi.mock("../../api/client", () => ({
  apiGraphListGraphs: vi.fn(),
  apiGraphListNodes: vi.fn(),
  apiGraphListRelations: vi.fn(),
  apiGraphGetTaxonomy: vi.fn(),
  apiGraphCreateGraph: vi.fn(),
  apiGraphDeleteGraph: vi.fn(),
  apiGraphRenameGraph: vi.fn(),
  apiGraphExportGraph: vi.fn(),
  apiGraphImportGraph: vi.fn(),
  apiGraphCreateNode: vi.fn(),
  apiGraphDeleteNode: vi.fn(),
  apiGraphUpdateNode: vi.fn(),
  apiGraphCreateRelation: vi.fn(),
  apiGraphDeleteRelation: vi.fn(),
}));
vi.mock("../../lib/confirmDialog", () => ({ confirmDialog: vi.fn() }));

import { GraphWorkspace } from "../../pages/graph/GraphWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderWorkspace(scope: string, onError: (message: string | null) => void = () => undefined) {
  return render(
    <TestI18nProvider>
      <AgentProvider>
        <ToolBarProvider>
          <GraphWorkspace scope={scope} onError={onError} />
        </ToolBarProvider>
      </AgentProvider>
    </TestI18nProvider>,
  );
}

const graph = (slug: string, displayName: string) => ({
  slug,
  display_name: displayName,
  node_count: 1,
});

const node = (id: string, canonical_name: string) => ({
  id,
  canonical_name,
  node_kind: "concept",
});

function setPriorScopeState() {
  useGraphStore.setState({
    projectScope: "scope-a",
    graphs: [graph("only-in-a", "Project A graph")],
    activeSlug: "only-in-a",
    graphNodes: [node("a-node", "A node")],
    relations: [{ id: "a-edge", from_node_id: "a-node", to_node_id: "a-other", relation_type: "related" }],
    kindCounts: { concept: 1 },
    subjects: ["A subject"],
    levels: ["A level"],
    selectedNodeId: "a-node",
    selectedEdgeId: "a-edge",
    viewMode: "graph",
    panelTab: "notes",
    panelExpanded: true,
    layoutNonce: 7,
    connectingFromId: "a-node",
    pendingNewNodeId: "pending-a",
    busy: true,
    error: "A error",
  });
}

describe("GraphWorkspace project scope isolation", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    vi.clearAllMocks();
    useGraphUndoStore.getState().clear();
    setPriorScopeState();

    vi.mocked(clientApi.apiGraphListGraphs).mockResolvedValue({ graphs: [graph("only-in-a", "Project A graph")] });
    vi.mocked(clientApi.apiGraphListNodes).mockResolvedValue({ nodes: [node("a-node", "A node")], kind_counts: { concept: 1 } });
    vi.mocked(clientApi.apiGraphListRelations).mockResolvedValue({ relations: [] });
    vi.mocked(clientApi.apiGraphGetTaxonomy).mockResolvedValue({ subjects: ["Math"], levels: ["High school"] });
    vi.mocked(clientApi.apiGraphCreateNode).mockResolvedValue({ ok: true, node: node("created-a", "Created A"), node_id: "created-a" });
    vi.mocked(clientApi.apiGraphDeleteNode).mockResolvedValue({ ok: true });
    vi.mocked(confirmDialog).mockResolvedValue(true);
  });

  it("clears project data when no old slug exists in the new project but retains display preferences", async () => {
    const oldUndoFrame = { undo: vi.fn(async () => undefined), redo: vi.fn(async () => undefined) };
    useGraphUndoStore.getState().pushFrame(oldUndoFrame);
    vi.mocked(clientApi.apiGraphListGraphs).mockResolvedValue({ graphs: [graph("new-only", "Project B graph")] });
    vi.mocked(clientApi.apiGraphListNodes).mockImplementation(async (_kind, slug) => ({
      nodes: [node(`${slug}-node`, "B node")],
      kind_counts: { concept: 1 },
    }));

    renderWorkspace("scope-b");

    await waitFor(() => expect(useGraphStore.getState().graphNodes).toEqual([node("new-only-node", "B node")]));
    expect(useGraphStore.getState()).toMatchObject({
      projectScope: "scope-b",
      graphs: [graph("new-only", "Project B graph")],
      activeSlug: "new-only",
      selectedNodeId: null,
      selectedEdgeId: null,
      connectingFromId: null,
      pendingNewNodeId: null,
      busy: false,
      layoutNonce: 0,
      error: null,
      viewMode: "graph",
      panelTab: "notes",
      panelExpanded: true,
    });
    expect(useGraphStore.getState().relations).toEqual([]);
    expect(useGraphStore.getState().kindCounts).toEqual({ concept: 1 });
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(clientApi.apiGraphListNodes).not.toHaveBeenCalledWith(undefined, "only-in-a");
  });

  it("loads a same-named slug in the new scope and ignores the old scope's late response", async () => {
    setPriorScopeState();
    useGraphStore.setState({
      activeSlug: "shared",
      graphs: [graph("shared", "A shared slug")],
      graphNodes: [node("old-shared-node", "Old project data")],
    });
    const oldGraphs = deferred<{ graphs: ReturnType<typeof graph>[] }>();
    let graphListCalls = 0;
    vi.mocked(clientApi.apiGraphListGraphs).mockImplementation(() => {
      graphListCalls += 1;
      if (graphListCalls === 1) return oldGraphs.promise;
      return Promise.resolve({ graphs: [graph("shared", "B shared slug")] });
    });
    const oldNodes = deferred<{ nodes: ReturnType<typeof node>[]; kind_counts: Record<string, number> }>();
    const oldRelations = deferred<{ relations: Array<{ id: string; from_node_id: string; to_node_id: string; relation_type: string }> }>();
    let nodeCalls = 0;
    let relationCalls = 0;
    vi.mocked(clientApi.apiGraphListNodes).mockImplementation(() => {
      nodeCalls += 1;
      if (nodeCalls === 1) return oldNodes.promise;
      return Promise.resolve({ nodes: [node("b-shared-node", "New project data")], kind_counts: { concept: 1 } });
    });
    vi.mocked(clientApi.apiGraphListRelations).mockImplementation(() => {
      relationCalls += 1;
      if (relationCalls === 1) return oldRelations.promise;
      return Promise.resolve({ relations: [] });
    });

    const mounted = renderWorkspace("scope-a");
    await waitFor(() => expect(clientApi.apiGraphListNodes).toHaveBeenCalledWith(undefined, "shared"));
    mounted.rerender(
      <TestI18nProvider>
        <AgentProvider>
          <ToolBarProvider>
            <GraphWorkspace scope="scope-b" onError={() => undefined} />
          </ToolBarProvider>
        </AgentProvider>
      </TestI18nProvider>,
    );

    await waitFor(() => expect(useGraphStore.getState().graphNodes).toEqual([node("b-shared-node", "New project data")]));
    expect(useGraphStore.getState().projectScope).toBe("scope-b");
    expect(useGraphStore.getState().activeSlug).toBe("shared");

    await act(async () => {
      oldGraphs.resolve({ graphs: [graph("stale-only-a", "Stale A list")] });
      oldNodes.resolve({ nodes: [node("stale-a-node", "Stale project A")], kind_counts: { concept: 1 } });
      oldRelations.resolve({ relations: [{ id: "stale-a-edge", from_node_id: "stale-a-node", to_node_id: "x", relation_type: "related" }] });
    });
    expect(useGraphStore.getState().graphNodes).toEqual([node("b-shared-node", "New project data")]);
    expect(useGraphStore.getState().graphs).toEqual([graph("shared", "B shared slug")]);
    expect(useGraphStore.getState().relations).toEqual([]);
  });

  it("blocks a pending confirmation and an old undo callback from writing into the next project", async () => {
    setPriorScopeState();
    vi.mocked(clientApi.apiGraphListGraphs).mockImplementation(async () => ({
      graphs: [graph("only-in-a", "Project A graph")],
    }));
    const mounted = renderWorkspace("scope-a");
    await waitFor(() => expect(useGraphStore.getState().projectScope).toBe("scope-a"));

    fireEvent.click(screen.getByTestId("add-node"));
    await waitFor(() => expect(useGraphUndoStore.getState().undoStack).toHaveLength(1));
    const staleUndo = useGraphUndoStore.getState().undoStack[0].undo;

    const confirmation = deferred<boolean>();
    vi.mocked(confirmDialog).mockReturnValueOnce(confirmation.promise);
    fireEvent.click(screen.getByTestId("delete-selected"));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    vi.mocked(clientApi.apiGraphListGraphs).mockResolvedValue({ graphs: [] });

    mounted.rerender(
      <TestI18nProvider>
        <AgentProvider>
          <ToolBarProvider>
            <GraphWorkspace scope="scope-b" onError={() => undefined} />
          </ToolBarProvider>
        </AgentProvider>
      </TestI18nProvider>,
    );
    await waitFor(() => expect(useGraphStore.getState().projectScope).toBe("scope-b"));
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);

    await act(async () => { await staleUndo(); });
    await act(async () => { confirmation.resolve(true); await confirmation.promise; });

    expect(clientApi.apiGraphDeleteNode).not.toHaveBeenCalled();
    expect(useGraphStore.getState().projectScope).toBe("scope-b");
    expect(useGraphStore.getState().graphNodes).toEqual([]);
  });

  it("keeps selection when the same scope leaves and returns", async () => {
    useGraphStore.setState({ selectedNodeId: "a-node", selectedEdgeId: null });
    const first = renderWorkspace("scope-a");
    await waitFor(() => expect(useGraphStore.getState().selectedNodeId).toBe("a-node"));
    first.unmount();

    renderWorkspace("scope-a");
    await waitFor(() => expect(useGraphStore.getState().selectedNodeId).toBe("a-node"));
    expect(useGraphStore.getState().projectScope).toBe("scope-a");
  });

  it("ignores a graph-list response from an unmounted workspace in the same scope", async () => {
    const oldList = deferred<{ graphs: ReturnType<typeof graph>[] }>();
    let calls = 0;
    vi.mocked(clientApi.apiGraphListGraphs).mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? oldList.promise
        : Promise.resolve({ graphs: [graph("only-in-a", "Current list")] });
    });

    const first = renderWorkspace("scope-a");
    await waitFor(() => expect(clientApi.apiGraphListGraphs).toHaveBeenCalledTimes(1));
    first.unmount();
    renderWorkspace("scope-a");
    await waitFor(() => expect(useGraphStore.getState().graphs).toEqual([graph("only-in-a", "Current list")]));

    await act(async () => {
      oldList.resolve({ graphs: [graph("stale-only-a", "Stale list")] });
    });
    expect(useGraphStore.getState().graphs).toEqual([graph("only-in-a", "Current list")]);
    expect(useGraphStore.getState().activeSlug).toBe("only-in-a");
  });

  it("ignores an old list failure after a newer list succeeds in the same workspace", async () => {
    const oldList = deferred<{ graphs: ReturnType<typeof graph>[] }>();
    let calls = 0;
    vi.mocked(clientApi.apiGraphListGraphs).mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? oldList.promise
        : Promise.resolve({ graphs: [graph("only-in-a", "Fresh list")] });
    });
    const onError = vi.fn();

    renderWorkspace("scope-a", onError);
    await waitFor(() => expect(clientApi.apiGraphListGraphs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("rename-current-graph"));
    await waitFor(() => expect(useGraphStore.getState().graphs).toEqual([graph("only-in-a", "Fresh list")]));

    await act(async () => {
      oldList.reject(new Error("old list failed"));
    });
    expect(useGraphStore.getState().activeSlug).toBe("only-in-a");
    expect(useGraphStore.getState().graphs).toEqual([graph("only-in-a", "Fresh list")]);
    expect(onError).not.toHaveBeenCalledWith("old list failed");
  });

  it("keeps the current graph selected when the graph-list request fails", async () => {
    const onError = vi.fn();
    vi.mocked(clientApi.apiGraphListGraphs).mockRejectedValueOnce(new Error("offline"));

    renderWorkspace("scope-a", onError);

    await waitFor(() => expect(onError).toHaveBeenCalledWith("offline"));
    expect(useGraphStore.getState().activeSlug).toBe("only-in-a");
  });

  it("does not apply a late node creation result after switching to another graph", async () => {
    const createRequest = deferred<{
      ok: boolean;
      node: ReturnType<typeof node>;
      node_id: string;
    }>();
    useGraphStore.setState({
      activeSlug: "graph-a",
      graphs: [graph("graph-a", "Graph A"), graph("graph-b", "Graph B")],
    });
    vi.mocked(clientApi.apiGraphListGraphs).mockResolvedValue({
      graphs: [graph("graph-a", "Graph A"), graph("graph-b", "Graph B")],
    });
    vi.mocked(clientApi.apiGraphListNodes).mockImplementation(async (_kind, slug) => ({
      nodes: [node(slug === "graph-b" ? "b-node" : "a-node", slug === "graph-b" ? "Project B data" : "Project A data")],
      kind_counts: { concept: 1 },
    }));
    vi.mocked(clientApi.apiGraphCreateNode).mockReturnValue(createRequest.promise);

    renderWorkspace("scope-a");
    await waitFor(() => expect(useGraphStore.getState().graphNodes).toEqual([node("a-node", "Project A data")]));
    fireEvent.click(screen.getByTestId("add-node"));
    await waitFor(() => expect(clientApi.apiGraphCreateNode).toHaveBeenCalledWith(expect.any(Object), "graph-a"));

    fireEvent.click(screen.getByTestId("switch-to-graph-b"));
    await waitFor(() => expect(useGraphStore.getState().graphNodes).toEqual([node("b-node", "Project B data")]));

    await act(async () => {
      createRequest.resolve({ ok: true, node: node("a-created", "Created in A"), node_id: "a-created" });
      await createRequest.promise;
    });
    expect(useGraphStore.getState().activeSlug).toBe("graph-b");
    expect(useGraphStore.getState().graphNodes).toEqual([node("b-node", "Project B data")]);
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
  });

  it("does not restore old undo stacks when an in-flight frame finishes after clear", async () => {
    const undoCall = deferred<void>();
    useGraphUndoStore.getState().pushFrame({ undo: () => undoCall.promise, redo: async () => undefined });

    const pendingUndo = useGraphUndoStore.getState().undo();
    useGraphUndoStore.getState().clear();
    undoCall.resolve();
    await act(async () => { await pendingUndo; });

    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([]);
  });
});
