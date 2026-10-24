import { lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAgentContext } from "../contexts/AgentContext";
import { ProjectPanel } from "../components/ProjectPanel";
import type { ProjectInfo } from "../types/project";

const BankWorkspace = lazy(() =>
  import("../pages/bank/BankWorkspace").then((module) => ({ default: module.BankWorkspace })),
);
const ComposeWorkspace = lazy(() =>
  import("../pages/compose/ComposeWorkspace").then((module) => ({ default: module.ComposeWorkspace })),
);
const GraphWorkspace = lazy(() =>
  import("../pages/graph/GraphWorkspace").then((module) => ({ default: module.GraphWorkspace })),
);
const TemplateWorkspace = lazy(() =>
  import("../pages/template/TemplateWorkspace").then((module) => ({ default: module.TemplateWorkspace })),
);

export function ComposeRoute({
  info,
  accountId,
  onRefreshInfo,
  onError,
  toolBarActive = true,
  openExamId = null,
  onOpenExamConsumed,
  onOpenPapers,
}: {
  info: ProjectInfo | null;
  accountId?: string | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
  /** 为 false 时不向顶栏注册工具栏（例如组卷页被隐藏但仍挂载时，避免覆盖其它页） */
  toolBarActive?: boolean;
  openExamId?: string | null;
  onOpenExamConsumed?: () => void;
  onOpenPapers?: () => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "compose",
      summary: t("route.composeSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return (
    <ComposeWorkspace
      key={info.root ?? "unbound"}
      onError={onError}
      accountId={accountId}
      projectRoot={info.root ?? null}
      toolBarActive={toolBarActive}
      openExamId={openExamId}
      onOpenExamConsumed={onOpenExamConsumed}
      onOpenPapers={onOpenPapers}
    />
  );
}

export function BankRoute({
  info,
  onRefreshInfo,
  onError,
  onOpenGraphNode,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
  onOpenGraphNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "bank",
      summary: t("route.bankSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return <BankWorkspace onError={onError} onOpenGraphNode={onOpenGraphNode} />;
}

export function TemplateRoute({
  info,
  onRefreshInfo,
  onError,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "template",
      summary: t("route.templateSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return <TemplateWorkspace onError={onError} />;
}

export function GraphRoute({
  info,
  onRefreshInfo,
  onError,
  focusNodeId,
  onFocusConsumed,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "graph",
      summary: t("route.graphSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return (
    <GraphWorkspace
      onError={onError}
      focusNodeId={focusNodeId ?? null}
      onFocusConsumed={onFocusConsumed}
    />
  );
}
