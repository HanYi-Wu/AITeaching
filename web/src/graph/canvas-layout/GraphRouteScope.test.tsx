import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentProvider } from "../../contexts/AgentContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { ProjectInfo } from "../../types/project";

const scopeMock = vi.hoisted(() => ({ nextMountId: 0 }));

vi.mock("../../pages/graph/GraphWorkspace", async () => {
  const React = await import("react");
  function GraphWorkspaceProbe() {
    const [mountId] = React.useState(() => ++scopeMock.nextMountId);
    return React.createElement("div", {
      "data-testid": "graph-workspace-probe",
      "data-mount-id": String(mountId),
    });
  }
  return { GraphWorkspace: GraphWorkspaceProbe };
});

import { GraphRoute } from "../../app/routes";

function route(info: ProjectInfo, accountId: string | null = null) {
  return (
    <TestI18nProvider>
      <AgentProvider>
        <Suspense fallback={<div>loading</div>}>
          <GraphRoute info={info} accountId={accountId} onRefreshInfo={async () => undefined} onError={() => undefined} />
        </Suspense>
      </AgentProvider>
    </TestI18nProvider>
  );
}

describe("GraphRoute project scope", () => {
  beforeAll(async () => setupTestI18n("zh"));

  beforeEach(() => {
    scopeMock.nextMountId = 0;
  });

  it("remounts GraphWorkspace when project root changes and keeps it for route-only prop updates", async () => {
    const projectA: ProjectInfo = {
      bound: true,
      root: "C:/schools/alpha",
      project_id: "same-id",
    };
    const mounted = render(route(projectA, "account-a"));
    await waitFor(() => expect(screen.getByTestId("graph-workspace-probe")).toHaveAttribute("data-mount-id", "1"));

    mounted.rerender(route({ ...projectA }, "account-a"));
    expect(screen.getByTestId("graph-workspace-probe")).toHaveAttribute("data-mount-id", "1");

    mounted.rerender(route({ ...projectA, root: "C:/schools/beta" }, "account-a"));
    await waitFor(() => expect(screen.getByTestId("graph-workspace-probe")).toHaveAttribute("data-mount-id", "2"));

    mounted.rerender(route({ ...projectA, root: "C:/schools/beta" }, "account-b"));
    await waitFor(() => expect(screen.getByTestId("graph-workspace-probe")).toHaveAttribute("data-mount-id", "3"));
  });
});
