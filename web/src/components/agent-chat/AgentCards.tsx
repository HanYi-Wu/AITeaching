import { useTranslation } from "react-i18next";
import { Download, Loader2, Pencil, Play } from "lucide-react";
import { downloadPlatformBlob } from "../../platform/auth";
import { formatToolLineLabel } from "./formatTool";

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
      <div className="ml-6 flex items-center gap-2 rounded border border-dashed border-violet-200 bg-violet-50/50 px-2 py-1.5 text-[11px] text-violet-900">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
        <span>{label || formatToolLineLabel(tool_name)}</span>
      </div>
    );
  }

  return (
    <div
      className={`ml-6 rounded border px-2 py-1 text-[11px] ${
        subagent
          ? "border-indigo-200 bg-indigo-50/90 text-indigo-950"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      <span className="font-medium text-slate-600">
        {subagent ? t("subtaskPrefix") : ""}
        {formatToolLineLabel(tool_name)}
      </span>
      <div className="mt-0.5 text-slate-700">{summary}</div>
      {download_url ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 font-semibold text-white hover:bg-violet-700"
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
          <Download className="h-3.5 w-3.5" /> 下载已梳理文件
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
    <div className="ml-6 rounded-md border border-orange-200 bg-orange-50 p-2 text-[11px] text-orange-950">
      <div className="font-medium">{t("needConfirm", { name: tool_name })}</div>
      <div className="mt-1 text-orange-900">{description}</div>
      {resolved ? (
        <div className="mt-2 font-medium text-orange-900">
          {resolved === "accepted" ? t("accepted") : t("rejected")}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(action_id, true)}
            className="rounded bg-orange-600 px-2 py-1 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {t("confirmBtn")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(action_id, false)}
            className="rounded border border-orange-300 bg-white px-2 py-1 hover:bg-orange-100 disabled:opacity-50"
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
    <div className="ml-6 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-950">
      <div className="font-medium">{t("planGenerated")}</div>
      {content && (
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-white/60 p-1.5 text-[10px] text-emerald-900">
          {content.slice(0, 3000)}
        </pre>
      )}
      {resolved ? (
        <div className="mt-2 font-medium text-emerald-900">
          {resolved === "execute"
            ? t("planExecute")
            : resolved === "modify"
              ? t("planModify")
              : t("planCancelled")}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("execute", plan_file_path)}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Play className="h-3 w-3" /> {t("execute")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("modify", plan_file_path)}
            className="flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-100 disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" /> {t("modify")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPlanAction("cancel", plan_file_path)}
            className="rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-100 disabled:opacity-50"
          >
            {t("cancelBtn")}
          </button>
        </div>
      )}
    </div>
  );
}
