import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  apiAgentLlmSettingsGet,
  apiAgentSafetyModeGet,
  apiAgentSafetyModePut,
  type AgentLlmSettingsResponse,
  type AgentSafetyModeOption,
} from "../../api/client";
import { AgentModelSettingsForm } from "../settings/AgentModelSettingsForm";
import { changeAppLanguage } from "../../i18n/changeLanguage";
import i18n from "../../i18n/i18n";
import type { AppLang } from "../../i18n/tauriLocale";
import "../../ui-redesign/g55/g55.css";
import { Select as AppSelect } from "../ui/select";

/** 全局模型与安全策略配置（与设置页模型分区一致） */
export function ModelConfigPane({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AgentLlmSettingsResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [safetyMode, setSafetyMode] = useState("allegro");
  const [safetyOptions, setSafetyOptions] = useState<AgentSafetyModeOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    onError(null);
    try {
      const [r, safety] = await Promise.all([apiAgentLlmSettingsGet(), apiAgentSafetyModeGet()]);
      setData(r);
      setSafetyMode(safety.mode);
      setSafetyOptions(safety.options ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveSafetyMode = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentSafetyModePut(safetyMode);
      setMsg(t("settings:updatedSafety"));
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const uiLang: AppLang = i18n.language.startsWith("en") ? "en" : "zh";

  return (
    <div className="max-h-full overflow-auto pr-1 text-[var(--or-text)]">
      {loading ? (
        <div className="flex items-center gap-2.5 py-8 text-sm text-[var(--or-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-or-primary" />
          <span>{t("settings:loading")}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Language Selection Card */}
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] bg-slate-950/60 p-4">
            <label className="block text-sm font-semibold text-[var(--or-text)]">{t("settings:uiLanguage")}</label>
            <AppSelect
              className="mt-2.5 h-10 w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-primary)] px-3 text-sm text-[var(--or-on-primary)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus"
              value={uiLang}
              onValueChange={(value) => void changeAppLanguage(value as AppLang)}
            >
              <option value="zh">{t("settings:langZh")}</option>
              <option value="en">{t("settings:langEn")}</option>
            </AppSelect>
          </div>

          {/* Persist Scope Hint */}
          {data ? (
            data.persist_scope === "global" ? (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--or-primary)_70%,transparent)] bg-slate-950/40 px-4 py-2.5 text-xs text-[var(--or-muted)]">
                {t("settings:saveScopeGlobalHint")}
              </div>
            ) : (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--or-primary)_70%,transparent)] bg-slate-950/40 px-4 py-2.5 text-xs text-[var(--or-muted)]">
                {t("settings:saveScopeProjectHint")}
              </div>
            )
          ) : null}

          {/* Model Settings Form */}
          <AgentModelSettingsForm
            variant="welcome"
            data={data}
            loading={false}
            saving={saving}
            onError={onError}
            onReload={load}
          />

          {/* Safety Mode Settings */}
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] bg-slate-950/60 p-4">
            <label className="block text-sm font-semibold text-[var(--or-text)]">{t("settings:safetyTitle")}</label>
            <p className="mt-1 text-xs text-[var(--or-muted)]">{t("settings:safetyHint")}</p>
            <div className="mt-3 space-y-2">
              {safetyOptions.map((op) => (
                <label
                  key={op.id}
                  className={`block cursor-pointer rounded-lg border p-3 transition ${
                    safetyMode === op.id
                      ? "border-or-primary/80 bg-or-primary-container"
                      : "border-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)] hover:border-[var(--or-outline)]"
                  } ${loading || !data || saving ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="welcome-agent-safety-mode"
                      value={op.id}
                      checked={safetyMode === op.id}
                      disabled={loading || !data || saving}
                      onChange={(e) => setSafetyMode(e.target.value)}
                      className="text-or-primary focus:ring-or-focus"
                    />
                    <span className="text-sm font-medium text-[var(--or-text)]">
                      {t(`safetyOption.${op.id}.label`, { defaultValue: op.label })}
                    </span>
                  </div>
                  <div className="mt-1 pl-6 text-xs text-[var(--or-muted)]">
                    {t(`safetyOption.${op.id}.desc`, { defaultValue: op.description })}
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={loading || !data || saving}
                onClick={() => void handleSaveSafetyMode()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-or-primary px-4 text-xs font-semibold text-or-on-primary transition hover:brightness-95 disabled:opacity-50"
              >
                {t("settings:saveSafety")}
              </button>
            </div>
          </div>

          {msg ? <p className="text-xs font-medium text-or-success">{msg}</p> : null}
        </div>
      )}
    </div>
  );
}
