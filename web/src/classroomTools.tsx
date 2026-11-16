import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import "./index.css";
import zhTools from "./i18n/locales/zh/tools.json";
import enTools from "./i18n/locales/en/tools.json";
import { ClassroomToolsPanel } from "./pages/tools/ClassroomToolsPanel";
import classroomToolsLogo from "../public/splash-logo.png?inline";

function getSystemLanguage(): "zh" | "en" {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function OfflineClassroomTools() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--or-page)] text-[var(--or-text)]">
      <header className="shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-5 py-3.5 md:px-8">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          <img
            src={classroomToolsLogo}
            alt=""
            width={42}
            height={42}
            draggable={false}
            className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-0.5"
          />
          <p className="min-w-0 truncate text-base font-bold tracking-tight text-[var(--or-text)] md:text-lg">
            源远教学平台
          </p>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <ClassroomToolsPanel />
      </main>
    </div>
  );
}

const language = getSystemLanguage();
document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
  document.documentElement.dataset.ehTheme = "night";
}

const offlineI18n = i18next.createInstance();
void offlineI18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { tools: zhTools },
      en: { tools: enTools },
    },
    lng: language,
    fallbackLng: "zh",
    defaultNS: "tools",
    ns: ["tools"],
    interpolation: { escapeValue: false },
  })
  .then(() => {
    const mount = document.getElementById("root");
    if (mount) {
      createRoot(mount).render(
        <I18nextProvider i18n={offlineI18n}>
          <OfflineClassroomTools />
        </I18nextProvider>,
      );
    }
  });
