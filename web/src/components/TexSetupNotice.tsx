import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { apiGet, apiPost, ensureApiBase } from "../api/client";
import { openExternalUrl } from "../lib/openExternalUrl";

type TexStatus = {
  platform: string;
  latexmk_on_path: boolean;
  xelatex_on_path: boolean;
  winget_on_path: boolean | null;
  pdf_engine_ready: boolean;
};

type Props = {
  onError: (msg: string | null) => void;
};

const MIKTEX_DOWNLOAD = "https://miktex.org/download";

export function TexSetupNotice({ onError }: Props) {
  const { t } = useTranslation(["compose", "common"]);
  const [status, setStatus] = useState<TexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      await ensureApiBase();
      const data = await apiGet<TexStatus>("/api/system/tex-status");
      setStatus(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstall = async () => {
    setExpanded(true);
    setInstallBusy(true);
    setInstallMsg(null);
    onError(null);
    try {
      await ensureApiBase();
      const r = await apiPost<{ ok: boolean; message: string }>("/api/system/tex-install", {});
      setInstallMsg(r.message);
      if (!r.ok) {
        onError(r.message);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setInstallMsg(m);
      onError(m);
    } finally {
      setInstallBusy(false);
    }
  };

  if (loading || !status) {
    return null;
  }

  if (status.pdf_engine_ready) {
    return null;
  }

  const showOneClick = status.platform === "win32" && status.winget_on_path;

  return (
    <div className="or-g49-tex-notice">
      <div className="or-g49-tex-notice-row">
        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--or-on-warning)]" aria-hidden />
        <p className="min-w-0 flex-1 truncate font-semibold text-[var(--or-on-warning)]">
          {t("compose:texNoticeTitle")}
        </p>
        <button
          type="button"
          className="or-g49-tex-notice-toggle"
          aria-expanded={expanded}
          aria-controls="compose-tex-setup-actions"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("compose:texNoticeCollapse") : t("compose:texNoticeActions")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform${expanded ? " rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      <div
        id="compose-tex-setup-actions"
        className="or-g49-tex-notice-details"
        hidden={!expanded}
      >
        <p className="text-sm leading-relaxed text-[color-mix(in_srgb,var(--or-on-warning)_90%,transparent)]">
          {t("compose:texNoticeBody")}
        </p>
        {installMsg ? (
          <p role="status" className="text-sm font-medium text-[var(--or-on-warning)]">
            {installMsg}
          </p>
        ) : null}
        <div className="or-g49-tex-notice-actions">
          <button
            type="button"
            onClick={() => void openExternalUrl(MIKTEX_DOWNLOAD)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-[var(--or-card)] px-3 py-1.5 text-sm font-semibold text-[var(--or-on-warning)] hover:bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 text-[var(--or-on-warning)]" />
            {t("compose:texNoticeOpenGuide")}
          </button>
          {showOneClick ? (
            <button
              type="button"
              disabled={installBusy}
              onClick={() => void handleInstall()}
              className="rounded-lg border border-amber-400 bg-[color-mix(in_srgb,var(--or-warning-container)_60%,transparent)] px-3 py-1.5 text-sm font-semibold text-[var(--or-on-warning)] hover:bg-[var(--or-warning-container)] transition-colors disabled:opacity-50"
            >
              {installBusy ? t("common:loading") : t("compose:texNoticeOneClick")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-[var(--or-card)] px-3 py-1.5 text-sm font-semibold text-[var(--or-on-warning)] hover:bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[var(--or-on-warning)]" />
            {t("compose:texNoticeRecheck")}
          </button>
        </div>
      </div>
    </div>
  );
}
