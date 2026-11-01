import { useTranslation } from "react-i18next";
import { Download, Loader2, Pencil, Play } from "lucide-react";
import { downloadPlatformBlob } from "../../platform/auth";
import { formatToolLineLabel } from "./formatTool";
import "../../ui-redesign/g55/g55.css";

export interface AgentToolCardProps {
  tool_name: string;
  summary?: string;
  subagent?: boolean;
  download_url?: string;
  filename?: string;
  isPending?: boolean;
  label?: string;
}

export function AgentToolCard({
  tool_name,
  summary,
  subagent,
  download_url,
  filename,
  isPending,
  label,
}: AgentToolCardProps) {
  const { t } = useTranslation("agent");

  if (isPending) {
    return (
      <div className="ml-2 sm:ml-6 flex items-center gap-2 rounded-xl border border-dashed border-or-primary/25 bg-or-primary-container px-3 py-2 text-xs text-or-on-container">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-or-primary" />
        <span className="font-medium">{label || formatToolLineLabel(tool_name)}</span>
      </div>
    );
  }

  return (
    <div
      className={`ml-2 sm:ml-6 rounded-xl border p-3 text-xs ${
        subagent
          ? "border-or-primary/30 bg-or-primary-container text-or-on-container"
          : "border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] text-[var(--or-muted)]   "
      }`}
    >
      <div className="font-semibold text-[var(--or-text)] ">
        {subagent ? t("subtaskPrefix") : ""}
        {formatToolLineLabel(tool_name)}
      </div>
      {summary && <div className="mt-1 leading-relaxed text-[var(--or-muted)] ">{summary}</div>}
      {download_url ? (
        <button
          type="button"
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-or-primary px-3 py-1.5 text-xs font-semibold text-or-on-primary transition hover:brightness-95"
          onClick={() =>
            void downloadPlatformBlob(download_url).then((blob) => {
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = filename || "EH-export.yaml";
              anchor.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          <Download className="h-3.5 w-3.5" />
          <span>下载已梳理文件</span>
        </button>
      ) : null}
    </div>
  );
}

export interface AgentConfirmCardProps {
  action_id: string;
  tool_name: string;
  description: string;
  resolved?: "accepted" | "rejected";
  busy: boolean;
  onConfirm: (actionId: string, accepted: boolean) => Promise<void>;
}

export function AgentConfirmCard({
  action_id,
  tool_name,
  description,
  resolved,
  busy,
  onConfirm,
}: AgentConfirmCardProps) {
  const { t } = useTranslation("agent");

  return (
    <div className="or-g55-status-warning ml-2 sm:ml-6 rounded-xl p-3 text-xs">
      <div className="font-semibold">{t("needConfirm", { name: tool_name })}</div>
      <div className="mt-1 leading-relaxed">{description}</div>
      {resolved ? (
        <div className="mt-2.5 font-medium">
          {resolved === "accepted" ? t("accepted") : t("rejected")}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(action_id, true)}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-or-primary px-3.5 text-xs font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {t("confirmBtn")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(action_id, false)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-or-outline bg-or-card px-3.5 text-xs font-medium text-or-text transition hover:bg-or-block disabled:opacity-50"
          >
            {t("cancelBtn")}
          </button>
        </div>
      )}
    </div>
  );
}

export interface AgentPlanCardProps {
  plan_file_path: string;
  content: string;
  resolved?: "execute" | "modify" | "cancel";
  busy: boolean;
  onPlanAction: (action: "execute" | "modify" | "cancel", planPath: string) => Promise<void>;
}

export function AgentPlanCard({
  plan_file_path,
  content,
  resolved,
  busy,
  onPlanAction,
}: AgentPlanCardProps) {
  const { t } = useTranslation("agent");

  return (
    <div className="or-g55-status-success ml-2 sm:ml-6 rounded-xl p-3 text-xs">
      <div className="font-semibold">{t("planGenerated")}</div>
      {content && (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-or-card/70 p-2.5 font-mono text-xs text-or-text">
          {content.slice(0, 3000)}
        </pre>
      )}
      {resolved ? (
        <div className="mt-2.5 font-medium">
          {resolved === "execute"
            ? t("planExecute")
            : resolved === "modify"
              ? t("planModify")
              : t("planCancelled")}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("execute", plan_file_path)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-or-primary px-3.5 text-xs font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            <span>{t("execute")}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("modify", plan_file_path)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-or-outline bg-or-card px-3.5 text-xs font-medium text-or-text transition hover:bg-or-block disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" />
            <span>{t("modify")}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("cancel", plan_file_path)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-or-outline bg-or-card px-3.5 text-xs font-medium text-or-text transition hover:bg-or-block disabled:opacity-50"
          >
            {t("cancelBtn")}
          </button>
        </div>
      )}
    </div>
  );
}
