import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, Loader2, PlugZap, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  apiAgentLlmSettingsPut,
  apiAgentLlmSettingsTest,
  type AgentLlmProvider,
  type AgentLlmReasoningEffort,
  type AgentLlmSettingsResponse,
} from "../../api/client";
import { confirmDialog } from "../../lib/confirmDialog";
import { isImeCompositionActive } from "../../lib/ime";
import "../../ui-redesign/g55/g55.css";

const PRESETS: Record<AgentLlmProvider, { baseUrl: string; main: string; fast: string }> = {
  openai: { baseUrl: "", main: "gpt-4o-mini", fast: "gpt-4o-mini" },
  anthropic: {
    baseUrl: "",
    main: "claude-sonnet-4-20250514",
    fast: "claude-3-5-haiku-20241022",
  },
  openai_compat: { baseUrl: "", main: "gpt-4o-mini", fast: "gpt-4o-mini" },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    main: "deepseek-v4-pro",
    fast: "deepseek-v4-flash",
  },
};

const PROVIDER_DISPLAY_ORDER: AgentLlmProvider[] = ["deepseek", "openai", "anthropic", "openai_compat"];

function sortProviderIds(ids: AgentLlmProvider[]): AgentLlmProvider[] {
  const rank = new Map(PROVIDER_DISPLAY_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

function providerLabelKey(id: AgentLlmProvider): string {
  switch (id) {
    case "openai":
      return "settings:providerOpenai";
    case "anthropic":
      return "settings:providerAnthropic";
    case "openai_compat":
      return "settings:providerOpenaiCompat";
    case "deepseek":
      return "settings:providerDeepseek";
    default:
      return "settings:providerOpenaiCompat";
  }
}

function providerDescKey(id: AgentLlmProvider): string {
  switch (id) {
    case "openai":
      return "settings:providerOpenaiDesc";
    case "anthropic":
      return "settings:providerAnthropicDesc";
    case "openai_compat":
      return "settings:providerOpenaiCompatDesc";
    case "deepseek":
      return "settings:providerDeepseekDesc";
    default:
      return "settings:providerOpenaiCompatDesc";
  }
}

type Variant = "welcome" | "settings";

export type AgentModelSettingsFormHandle = {
  save: () => Promise<void>;
};

export const AgentModelSettingsForm = forwardRef(function AgentModelSettingsForm(
  {
    variant,
    data,
    loading,
    saving,
    onError,
    onReload,
  }: {
    variant: Variant;
    data: AgentLlmSettingsResponse | null;
    loading: boolean;
    saving: boolean;
    onError: (msg: string | null) => void;
    onReload: () => Promise<void>;
  },
  ref: Ref<AgentModelSettingsFormHandle>,
) {
  const { t } = useTranslation(["settings", "common"]);
  const [provider, setProvider] = useState<AgentLlmProvider>("openai_compat");
  const [mainModel, setMainModel] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<AgentLlmReasoningEffort>("high");
  const [msg, setMsg] = useState<string | null>(null);
  const [savingLocal, setSavingLocal] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setMainModel(data.main_model);
    setFastModel(data.fast_model);
    setBaseUrl(data.base_url);
    setAccessSecret("");
    setReasoningEffort(data.reasoning_effort === "max" ? "max" : "high");
  }, [data?.provider, data?.main_model, data?.fast_model, data?.base_url, data?.reasoning_effort]);

  const keySourceNote = useMemo(() => {
    if (!data) return "";
    if (data.has_project_api_key_override && data.has_user_api_key_override) {
      return t("settings:accessKeySourceBoth");
    }
    if (data.has_project_api_key_override) return t("settings:accessKeySourceProject");
    if (data.has_user_api_key_override) return t("settings:accessKeySourceUser");
    return "";
  }, [data, t]);

  const selectProvider = useCallback((p: AgentLlmProvider) => {
    setProvider(p);
    const pr = PRESETS[p];
    setBaseUrl(pr.baseUrl);
    setMainModel(pr.main);
    setFastModel(pr.fast);
  }, []);

  const applyRecommended = useCallback(() => {
    const pr = PRESETS[provider];
    setBaseUrl(pr.baseUrl);
    setMainModel(pr.main);
    setFastModel(pr.fast);
  }, [provider]);

  const busy = saving || savingLocal || testingConnection;

  const card =
    variant === "welcome"
      ? "rounded-xl border border-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] bg-slate-950/60 p-4"
      : "rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 shadow-sm  ";
  const labelCls =
    variant === "welcome"
      ? "block text-sm font-semibold text-[var(--or-text)]"
      : "block text-sm font-semibold text-[var(--or-text)] ";
  const hintCls =
    variant === "welcome"
      ? "mt-1 text-xs text-[var(--or-muted)]"
      : "mt-1 text-xs text-[var(--or-muted)] ";
  const inputCls =
    variant === "welcome"
      ? "mt-2.5 h-10 w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-primary)] px-3 text-sm text-[var(--or-on-primary)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus disabled:opacity-50"
      : "mt-2.5 h-10 w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 text-sm text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus disabled:bg-[var(--or-page)]   ";
  const monoInput = `${inputCls} font-mono`;

  const radioBorder = (active: boolean) =>
    variant === "welcome"
      ? active
        ? "border-or-primary/80 bg-or-primary-container"
        : "border-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)] hover:border-[var(--or-outline)]"
      : active
        ? "border-or-primary bg-or-primary-container"
        : "border-[var(--or-outline)] bg-[var(--or-card)] hover:border-[var(--or-outline)]  ";

  const ids = useMemo(() => {
    const raw =
      data?.provider_options?.length && data.provider_options.length > 0
        ? data.provider_options.map((o) => o.id as AgentLlmProvider)
        : PROVIDER_DISPLAY_ORDER;
    return sortProviderIds(raw);
  }, [data?.provider_options]);

  const handleSave = useCallback(async () => {
    if (isImeCompositionActive()) return;
    if (!data) return;
    setSavingLocal(true);
    setMsg(null);
    onError(null);
    try {
      const body: Parameters<typeof apiAgentLlmSettingsPut>[0] = {
        provider,
        main_model: mainModel,
        fast_model: fastModel,
        base_url: baseUrl,
      };
      if (provider === "deepseek") {
        body.reasoning_effort = reasoningEffort;
      }
      if (accessSecret.trim()) {
        body.api_key = accessSecret.trim();
      }
      await apiAgentLlmSettingsPut(body);
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:savedProject") : t("settings:savedGlobal"));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLocal(false);
    }
  }, [
    data,
    provider,
    mainModel,
    fastModel,
    baseUrl,
    accessSecret,
    reasoningEffort,
    onError,
    onReload,
    t,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
    }),
    [handleSave],
  );

  const handleClearSecret = async () => {
    if (!data) return;
    const confirmKey =
      data.persist_scope === "project" ? "settings:confirmClearKey" : "settings:confirmClearKeyUser";
    if (!(await confirmDialog(t(confirmKey)))) return;
    setSavingLocal(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentLlmSettingsPut({ clear_api_key_override: true });
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:clearedKey") : t("settings:clearedKeyUser"));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLocal(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    onError(null);
    try {
      const result = await apiAgentLlmSettingsTest();
      setConnectionResult(
        t("settings:connectionSuccess", {
          provider: result.provider,
          model: result.model,
          latency: result.latency_ms,
        }),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingConnection(false);
    }
  };

  if (loading || !data) {
    return (
      <div
        className={
          variant === "welcome"
            ? "flex items-center gap-2 py-4 text-sm text-[var(--or-muted)]"
            : "mt-4 flex items-center gap-2 py-4 text-sm text-[var(--or-muted)]"
        }
      >
        <Loader2 className="h-5 w-5 animate-spin text-or-primary" />
        <span>{t("settings:loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <label className={labelCls}>{t("settings:providerTitle")}</label>
        <p className={hintCls}>{t("settings:providerHint")}</p>
        <div className="mt-3 space-y-2">
          {ids.map((id) => (
            <label
              key={id}
              className={`block cursor-pointer rounded-xl border p-3 transition ${
                provider === id ? radioBorder(true) : radioBorder(false)
              } ${busy ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name={`model-provider-${variant}`}
                  value={id}
                  checked={provider === id}
                  disabled={busy}
                  onChange={() => selectProvider(id as AgentLlmProvider)}
                  className="text-or-primary focus:ring-or-focus"
                />
                <span
                  className={
                    variant === "welcome"
                      ? "text-sm font-medium text-[var(--or-text)]"
                      : "text-sm font-medium text-[var(--or-text)] "
                  }
                >
                  {t(providerLabelKey(id as AgentLlmProvider))}
                </span>
              </div>
              <div
                className={`mt-1 pl-6 text-xs leading-relaxed ${
                  variant === "welcome" ? "text-[var(--or-muted)]" : "text-[var(--or-muted)] "
                }`}
              >
                {t(providerDescKey(id as AgentLlmProvider))}
              </div>
            </label>
          ))}
        </div>

        {provider === "deepseek" ? (
          <div className="mt-4 border-t border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] pt-3 ">
            <span className={labelCls}>{t("settings:thinkingEffortTitle")}</span>
            <p className={hintCls}>{t("settings:thinkingEffortHint")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={reasoningEffort === "high"}
                data-testid="thinking-effort-high"
                onClick={() => setReasoningEffort("high")}
                className={`or-g55-pill px-4 py-1.5 transition ${
                  reasoningEffort === "high"
                    ? "bg-or-primary text-or-on-primary shadow-sm"
                    : "border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] hover:bg-[var(--or-page)]   "
                }`}
              >
                {t("settings:thinkingEffortHigh")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={reasoningEffort === "max"}
                data-testid="thinking-effort-max"
                onClick={() => setReasoningEffort("max")}
                className={`or-g55-pill px-4 py-1.5 transition ${
                  reasoningEffort === "max"
                    ? "bg-or-primary text-or-on-primary shadow-sm"
                    : "border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] hover:bg-[var(--or-page)]   "
                }`}
              >
                {t("settings:thinkingEffortMax")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-3.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyRecommended()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-or-primary hover:text-or-primary disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t("settings:applyRecommended")}</span>
          </button>
        </div>
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:modelBaseUrl")}</label>
        <p className={hintCls}>{t("settings:modelBaseUrlHint")}</p>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={busy}
          placeholder="https://…"
          className={inputCls}
        />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:mainModel")}</label>
        <input
          type="text"
          value={mainModel}
          onChange={(e) => setMainModel(e.target.value)}
          disabled={busy}
          className={monoInput}
        />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:fastModel")}</label>
        <p className={hintCls}>{t("settings:fastModelHint")}</p>
        <input
          type="text"
          value={fastModel}
          onChange={(e) => setFastModel(e.target.value)}
          disabled={busy}
          className={monoInput}
        />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:accessKey")}</label>
        <p className={hintCls}>
          {t("settings:accessKeyHint", {
            masked: data?.api_key_masked ?? t("settings:notConfigured"),
          })}
          {keySourceNote ? ` ${keySourceNote}` : ""}
        </p>
        <input
          type="password"
          value={accessSecret}
          onChange={(e) => setAccessSecret(e.target.value)}
          disabled={busy}
          placeholder={data ? t("settings:accessKeyPlaceholder") : ""}
          autoComplete="off"
          className={inputCls}
        />
      </div>

      <p className="text-xs text-[var(--or-muted)] ">
        {t("settings:footerNote")}
      </p>

      {msg ? (
        <p className="or-g55-status-success rounded-lg p-2.5 text-xs font-medium">
          {msg}
        </p>
      ) : null}

      {connectionResult ? (
        <div
          role="status"
          className="or-g55-status-success flex items-start gap-2.5 rounded-xl p-3 text-xs"
        >
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-or-success" />
          <span className="leading-relaxed">{connectionResult}</span>
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSave()}
          className="inline-flex h-11 sm:h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-or-primary px-5 text-sm font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{data?.persist_scope === "project" ? t("settings:saveToProject") : t("settings:saveToProfile")}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleTestConnection()}
          className="inline-flex h-11 sm:h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-4 text-sm font-medium text-[var(--or-muted)] shadow-sm transition hover:bg-[var(--or-page)] disabled:opacity-50    dark:hover:bg-slate-700"
        >
          {testingConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4 text-or-primary" />}
          <span>{testingConnection ? t("settings:testingConnection") : t("settings:testConnection")}</span>
        </button>
        {data?.persist_scope === "project" && data.has_project_api_key_override && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearSecret()}
            className="inline-flex h-11 sm:h-10 w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-or-outline bg-or-card px-4 text-sm font-medium text-or-text transition hover:border-or-error/30 hover:bg-[var(--or-error-container)] hover:text-or-error disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>{t("settings:clearProjectKey")}</span>
          </button>
        )}
        {data?.persist_scope === "global" && data.has_user_api_key_override && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearSecret()}
            className="inline-flex h-11 sm:h-10 w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-or-outline bg-or-card px-4 text-sm font-medium text-or-text transition hover:border-or-error/30 hover:bg-[var(--or-error-container)] hover:text-or-error disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>{t("settings:clearUserKey")}</span>
          </button>
        )}
      </div>
    </div>
  );
});
