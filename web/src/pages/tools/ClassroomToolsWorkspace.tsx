import { useCallback } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentActions } from "../../contexts/AgentContext";
import { ClassroomToolsPanel, type ClassroomToolTab } from "./ClassroomToolsPanel";

export type { ClassroomToolTab } from "./ClassroomToolsPanel";

export interface ClassroomToolsWorkspaceProps {
  active?: boolean;
  initialTool?: ClassroomToolTab;
  onError?: (msg: string | null) => void;
}

export function ClassroomToolsWorkspace({
  active = true,
  initialTool = "rollCall",
  onError,
}: ClassroomToolsWorkspaceProps) {
  const { t } = useTranslation(["tools", "common"]);
  const { setPageContext } = useAgentActions();

  const handleSummaryChange = useCallback(
    (summary: string | null) => {
      setPageContext(active && summary ? { current_page: "tools", summary } : null);
    },
    [active, setPageContext],
  );

  const downloadAction = (
    <a
      href={`${import.meta.env.BASE_URL}classroom-tools.html`}
      download={t("tools:offline.filename")}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm font-medium text-[var(--or-text)] transition-colors hover:bg-[var(--or-block)]"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      <span>{t("tools:offline.downloadLabel")}</span>
    </a>
  );

  return (
    <ClassroomToolsPanel
      active={active}
      initialTool={initialTool}
      onSummaryChange={handleSummaryChange}
      onError={onError}
      headerAction={downloadAction}
    />
  );
}
