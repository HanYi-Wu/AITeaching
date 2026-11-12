import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProvider } from "../../contexts/AgentContext";
import { ToolBarProvider } from "../../contexts/ToolBarContext";
import { useGraphStore } from "../../graph/useGraphStore";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { GraphWorkspace } from "./GraphWorkspace";
import * as clientApi from "../../api/client";

const graphPanelTestState = vi.hoisted(() => ({
  initialOnSaved: null as null | (() => void | Promise<void>),
}));

// Mock child components to isolate GraphWorkspace request orchestration
vi.mock("../../graph/GraphCanvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}));
vi.mock("../../graph/MindMapCanvas", () => ({
  MindMapCanvas: () => <div data-testid="mindmap-canvas" />,
}));
vi.mock("../../graph/GraphNodePanel", () => ({
  GraphNodePanel: ({ onSaved }: { onSaved: () => void | Promise<void> }) => {
    graphPanelTestState.initialOnSaved ??= onSaved;
    return <div data-testid="graph-node-panel" />;
  },
}));
vi.mock("../../graph/GraphSubjectSidebar", () => ({
  GraphSubjectSidebar: ({
    graphs,
    activeSlug,
    onSelectGraph,
    onClose,
  }: {
    graphs: Array<{ slug: string; display_name: string }>;
    activeSlug: string | null;
    onSelectGraph: (slug: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="graph-sidebar">
      <span data-testid="active-slug">{activeSlug}</span>
      <button type="button" data-graph-sidebar-close onClick={onClose}>Close sidebar</button>
      {graphs.map((g) => (
        <button
          key={g.slug}
          data-testid={`select-${g.slug}`}
          onClick={() => onSelectGraph(g.slug)}
        >
          {g.display_name}
        </button>
      ))}
    </div>
  ),
}));

// Mock API client calls
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderWorkspace(onError: (err: string | null) => void) {
  return render(
    <TestI18nProvider>
      <AgentProvider>
        <ToolBarProvider>
          <GraphWorkspace onError={onError} />
        </ToolBarProvider>
      </AgentProvider>
    </TestI18nProvider>,
  );
}

describe("GraphWorkspace request isolation across graph switching", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    vi.clearAllMocks();
    graphPanelTestState.initialOnSaved = null;
    useGraphStore.setState({
      graphs: [
        { slug: "math", display_name: "数学", node_count: 2 },
        { slug: "physics", display_name: "物理", node_count: 2 },
      ],
      activeSlug: "math",
      graphNodes: [],
      relations: [],
      busy: false,
    });

    vi.mocked(clientApi.apiGraphListGraphs).mockResolvedValue({
      graphs: [
        { slug: "math", display_name: "数学", node_count: 2 },
        { slug: "physics", display_name: "物理", node_count: 2 },
      ],
    });

    vi.mocked(clientApi.apiGraphGetTaxonomy).mockResolvedValue({
      subjects: ["数学", "物理"],
      levels: ["高中", "高考"],
    });
  });

  it("closes the mobile graph drawer with Escape and restores focus for reopening", async () => {
    renderWorkspace(vi.fn());

    const openButton = screen.getByTestId("graph-sidebar-open");
    fireEvent.click(openButton);
    expect(openButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Close sidebar")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    expect(openButton).toHaveFocus();

    fireEvent.click(openButton);
    expect(openButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Close sidebar")).toHaveFocus();
    fireEvent.click(screen.getByText("Close sidebar"));
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    expect(openButton).toHaveFocus();
  });

  it("isolates late successful response of graph A from overwriting graph B data", async () => {
    const onError = vi.fn();
    const deferredA_nodes = createDeferred<{ nodes: any[]; kind_counts: Record<string, number> }>();
    const deferredA_rels = createDeferred<{ relations: any[] }>();

    vi.mocked(clientApi.apiGraphListNodes).mockImplementation((_kind, slug) => {
      if (slug === "math") {
        return deferredA_nodes.promise as any;
      }
      if (slug === "physics") {
        return Promise.resolve({
          nodes: [{ id: "p1", canonical_name: "牛顿力学", node_kind: "concept" }],
          kind_counts: { concept: 1 },
        }) as any;
      }
      return Promise.resolve({ nodes: [], kind_counts: {} }) as any;
    });

    vi.mocked(clientApi.apiGraphListRelations).mockImplementation((slug) => {
      if (slug === "math") {
        return deferredA_rels.promise as any;
      }
      if (slug === "physics") {
        return Promise.resolve({
          relations: [{ id: "r-phys", from_node_id: "p1", to_node_id: "p2", relation_type: "related" }],
        }) as any;
      }
      return Promise.resolve({ relations: [] }) as any;
    });

    renderWorkspace(onError);

    // Initial load starts for "math" (deferred A is pending)
    expect(useGraphStore.getState().busy).toBe(true);

    // Switch to "physics"
    await act(async () => {
      useGraphStore.getState().setActiveSlug("physics");
    });

    // Physics completes immediately
    expect(useGraphStore.getState().activeSlug).toBe("physics");
    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p1", canonical_name: "牛顿力学", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().relations).toEqual([
      { id: "r-phys", from_node_id: "p1", to_node_id: "p2", relation_type: "related" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);

    // Now release Graph A's delayed success response
    await act(async () => {
      deferredA_nodes.resolve({
        nodes: [{ id: "m1", canonical_name: "函数", node_kind: "concept" }],
        kind_counts: { concept: 1 },
      });
      deferredA_rels.resolve({
        relations: [{ id: "r-math", from_node_id: "m1", to_node_id: "m2", relation_type: "related" }],
      });
    });

    // Quantified acceptance: Graph A's late response must NOT overwrite Graph B's data or busy state
    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p1", canonical_name: "牛顿力学", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().relations).toEqual([
      { id: "r-phys", from_node_id: "p1", to_node_id: "p2", relation_type: "related" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("error"));
  });

  it("isolates late error response of graph A from setting error or clearing busy on graph B", async () => {
    const onError = vi.fn();
    const deferredA_nodes = createDeferred<{ nodes: any[]; kind_counts: Record<string, number> }>();

    vi.mocked(clientApi.apiGraphListNodes).mockImplementation((_kind, slug) => {
      if (slug === "math") {
        return deferredA_nodes.promise as any;
      }
      if (slug === "physics") {
        return Promise.resolve({
          nodes: [{ id: "p-dyn", canonical_name: "动力学", node_kind: "concept" }],
          kind_counts: { concept: 1 },
        }) as any;
      }
      return Promise.resolve({ nodes: [], kind_counts: {} }) as any;
    });

    vi.mocked(clientApi.apiGraphListRelations).mockImplementation((slug) => {
      if (slug === "math") {
        return Promise.resolve({ relations: [] }) as any;
      }
      return Promise.resolve({
        relations: [{ id: "r-phys-dyn", from_node_id: "p-dyn", to_node_id: "p-other", relation_type: "related" }],
      }) as any;
    });

    renderWorkspace(onError);

    // Switch to "physics" before math finishes
    await act(async () => {
      useGraphStore.getState().setActiveSlug("physics");
    });

    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p-dyn", canonical_name: "动力学", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);

    // Now fail graph A's delayed request
    await act(async () => {
      deferredA_nodes.reject(new Error("Network timeout loading math graph"));
    });

    // Quantified acceptance: Late error on graph A must NOT trigger onError with error message or mutate physics
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p-dyn", canonical_name: "动力学", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);
  });

  it("ignores a stale panel refresh callback after switching to another graph", async () => {
    const onError = vi.fn();
    const deferredPhysicsNodes = createDeferred<{ nodes: any[]; kind_counts: Record<string, number> }>();
    const deferredPhysicsRelations = createDeferred<{ relations: any[] }>();

    useGraphStore.setState({
      graphNodes: [{ id: "m1", canonical_name: "函数", node_kind: "concept" }],
      selectedNodeId: "m1",
      panelExpanded: true,
    });
    vi.mocked(clientApi.apiGraphListNodes).mockImplementation((_kind, slug) => {
      if (slug === "physics") return deferredPhysicsNodes.promise as any;
      return Promise.resolve({ nodes: [{ id: "m1", canonical_name: "函数", node_kind: "concept" }], kind_counts: { concept: 1 } }) as any;
    });
    vi.mocked(clientApi.apiGraphListRelations).mockImplementation((slug) => {
      if (slug === "physics") return deferredPhysicsRelations.promise as any;
      return Promise.resolve({ relations: [] }) as any;
    });

    renderWorkspace(onError);
    const stalePanelRefresh = graphPanelTestState.initialOnSaved;
    expect(stalePanelRefresh).toBeTypeOf("function");

    await act(async () => {
      useGraphStore.getState().setActiveSlug("physics");
    });
    expect(useGraphStore.getState().busy).toBe(true);

    // A save callback captured while math was active can finish after the user switches to physics.
    await act(async () => {
      await stalePanelRefresh?.();
    });

    await act(async () => {
      deferredPhysicsNodes.resolve({
        nodes: [{ id: "p1", canonical_name: "牛顿力学", node_kind: "concept" }],
        kind_counts: { concept: 1 },
      });
      deferredPhysicsRelations.resolve({ relations: [] });
    });

    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p1", canonical_name: "牛顿力学", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("handles normal load and error recovery on the current active graph", async () => {
    const onError = vi.fn();

    vi.mocked(clientApi.apiGraphListNodes).mockRejectedValueOnce(new Error("Failed to load active graph"));
    vi.mocked(clientApi.apiGraphListRelations).mockResolvedValue({ relations: [] });

    renderWorkspace(onError);

    await act(async () => {
      // Allow initial effect to run
    });

    // Error on current graph is properly dispatched
    expect(onError).toHaveBeenCalledWith("Failed to load active graph");
    expect(useGraphStore.getState().busy).toBe(false);

    // Recover by switching to physics
    vi.mocked(clientApi.apiGraphListNodes).mockResolvedValueOnce({
      nodes: [{ id: "p-rec", canonical_name: "恢复物理", node_kind: "concept" }],
      kind_counts: { concept: 1 },
    });

    await act(async () => {
      useGraphStore.getState().setActiveSlug("physics");
    });

    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "p-rec", canonical_name: "恢复物理", node_kind: "concept" },
    ]);
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(useGraphStore.getState().busy).toBe(false);
  });

  it("drops late response safely when component unmounts", async () => {
    const onError = vi.fn();
    const deferred = createDeferred<{ nodes: any[]; kind_counts: Record<string, number> }>();

    vi.mocked(clientApi.apiGraphListNodes).mockReturnValue(deferred.promise as any);
    vi.mocked(clientApi.apiGraphListRelations).mockResolvedValue({ relations: [] });

    const { unmount } = renderWorkspace(onError);

    // Unmount while request in flight
    unmount();

    // Now resolve deferred
    await act(async () => {
      deferred.resolve({
        nodes: [{ id: "unmounted-node", canonical_name: "Unmounted", node_kind: "concept" }],
        kind_counts: {},
      });
    });

    // State not committed post-unmount
    expect(useGraphStore.getState().graphNodes).not.toContainEqual(
      expect.objectContaining({ id: "unmounted-node" }),
    );
  });

  it("handles rapid multi-subject switching without stale view flashing or data mixing", async () => {
    const onError = vi.fn();
    const deferreds: Record<string, ReturnType<typeof createDeferred>> = {
      math: createDeferred(),
      physics: createDeferred(),
      chemistry: createDeferred(),
    };

    useGraphStore.setState({
      graphs: [
        { slug: "math", display_name: "数学", node_count: 1 },
        { slug: "physics", display_name: "物理", node_count: 1 },
        { slug: "chemistry", display_name: "化学", node_count: 1 },
      ],
      activeSlug: "math",
    });

    vi.mocked(clientApi.apiGraphListNodes).mockImplementation((_kind, slug) => {
      const def = deferreds[slug ?? ""];
      if (def) return def.promise as any;
      return Promise.resolve({ nodes: [], kind_counts: {} }) as any;
    });

    vi.mocked(clientApi.apiGraphListRelations).mockResolvedValue({ relations: [] });

    renderWorkspace(onError);

    // User rapidly clicks from math -> physics -> chemistry
    await act(async () => {
      useGraphStore.getState().setActiveSlug("physics");
    });
    await act(async () => {
      useGraphStore.getState().setActiveSlug("chemistry");
    });

    // Chemistry is the latest active slug
    expect(useGraphStore.getState().activeSlug).toBe("chemistry");

    // Out-of-order network response arrives: Math (oldest) resolves first
    await act(async () => {
      deferreds.math.resolve({
        nodes: [{ id: "m-stale", canonical_name: "旧数学节点", node_kind: "concept" }],
        kind_counts: { concept: 1 },
      });
    });

    // Chemistry view must NOT be contaminated by stale Math data
    expect(useGraphStore.getState().graphNodes).toEqual([]);

    // Physics (second oldest) resolves next
    await act(async () => {
      deferreds.physics.resolve({
        nodes: [{ id: "p-stale", canonical_name: "旧物理节点", node_kind: "concept" }],
        kind_counts: { concept: 1 },
      });
    });

    expect(useGraphStore.getState().graphNodes).toEqual([]);

    // Finally, Chemistry (current active) resolves
    await act(async () => {
      deferreds.chemistry.resolve({
        nodes: [{ id: "c-active", canonical_name: "化学分子", node_kind: "concept" }],
        kind_counts: { concept: 1 },
      });
    });

    // Chemistry data is cleanly presented to the user
    expect(useGraphStore.getState().graphNodes).toEqual([
      { id: "c-active", canonical_name: "化学分子", node_kind: "concept" },
    ]);
    expect(useGraphStore.getState().busy).toBe(false);
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("clears workspace state when switching to an empty graph without errors", async () => {
    const onError = vi.fn();

    vi.mocked(clientApi.apiGraphListNodes).mockResolvedValue({ nodes: [], kind_counts: {} });
    vi.mocked(clientApi.apiGraphListRelations).mockResolvedValue({ relations: [] });

    renderWorkspace(onError);

    await act(async () => {
      useGraphStore.getState().setActiveSlug("empty-graph");
    });

    expect(useGraphStore.getState().graphNodes).toEqual([]);
    expect(useGraphStore.getState().relations).toEqual([]);
    expect(useGraphStore.getState().busy).toBe(false);
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
  });
});
