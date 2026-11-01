import { StrictMode, useEffect, useState } from "react";
import App from "./App";
import { ensureApiBase } from "./api/client";
import i18n from "./i18n/i18n";

type Phase = "loading" | "ready" | "error";

/**
 * 桌面壳内：先完成本地服务握手再进入主界面；浏览器开发环境不走此分支。
 */
export function BootstrapShell() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureApiBase();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--or-page)] text-[var(--or-muted)] text-[15px] select-none">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--or-primary)] border-t-transparent" />
          <span>{i18n.t("connectingLocalService", { ns: "common" })}</span>
        </div>
      </div>
    );
  }

  if (phase === "error" && errorMessage) {
    const title = i18n.t("couldNotReachLocalService", { ns: "common" });
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--or-page)] p-6">
        <div className="w-full max-w-md rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-6 shadow-sm">
          <p className="text-base font-semibold text-[var(--or-text)]">{title}</p>
          <p className="mt-2 text-sm text-[var(--or-muted)] leading-relaxed">
            {errorMessage.replace(/</g, "\u003c")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <StrictMode>
      <App />
    </StrictMode>
  );
}
