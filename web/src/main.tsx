import { createRoot } from "react-dom/client";
import { BootstrapShell } from "./BootstrapShell";
import { initI18n } from "./i18n/i18n";
import { readStoredLocale, resolveInitialLocale, tauriGetLocale, writeStoredLocale } from "./i18n/tauriLocale";
import { installGlobalLogging } from "./lib/appLog";
import { isTauriShell } from "./lib/tauriEnv";
import "./index.css";

if (typeof document !== "undefined" && isTauriShell()) {
  document.documentElement.classList.add("tauri-shell");
}

installGlobalLogging();

void (async () => {
  const fromTauri = await tauriGetLocale();
  const stored = readStoredLocale();
  if (fromTauri) {
    writeStoredLocale(fromTauri);
  }
  const lng = resolveInitialLocale(fromTauri, stored);
  await initI18n(lng);
  createRoot(document.getElementById("root")!).render(<BootstrapShell />);
})();
