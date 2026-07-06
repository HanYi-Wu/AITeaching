import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  ClipboardList,
  FileStack,
  Layers,
  LogOut,
  Network,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { AgentSidebar } from "./components/AgentSidebar";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { ToolBar } from "./components/layout/ToolBar";
import { AgentProvider, useAgentContext } from "./contexts/AgentContext";
import { ToolBarProvider, useToolBar } from "./contexts/ToolBarContext";
import { AnalysisWorkspace } from "./pages/AnalysisWorkspace";
import { HelpWorkspace } from "./pages/HelpWorkspace";
import { AdminWorkspace } from "./pages/platform/AdminWorkspace";
import { PapersWorkspace } from "./pages/platform/PapersWorkspace";
import { PlatformLogin } from "./pages/platform/PlatformLogin";
import { SchoolWorkspace } from "./pages/platform/SchoolWorkspace";
import { StudentWorkspace } from "./pages/platform/StudentWorkspace";
import { TeacherWorkspace } from "./pages/platform/TeacherWorkspace";
import { SettingsWorkspace } from "./pages/SettingsWorkspace";
import { apiGet } from "./api/client";
import { dispatchSolaireSave } from "./lib/saveEvents";
import { installImeCompositionTracker, isImeComposingKeyboardEvent } from "./lib/ime";
import { cn } from "./lib/utils";
import { isTauriShell } from "./lib/tauriEnv";
import type { AppPage } from "./app/appPages";
import { BankRoute, ComposeRoute, GraphRoute, TemplateRoute } from "./app/routes";
import {
  getCurrentUser,
  getPlatformStatus,
  logoutPlatform,
  setPlatformProjectRoot,
  type PlatformStatus,
  type PlatformUser,
} from "./platform/auth";
import { resolvePlatformRoute } from "./platform/routing";
import type { ProjectInfo } from "./types/project";

export default function App() {
  return (
    <AgentProvider>
      <ToolBarProvider>
        <AppShell />
      </ToolBarProvider>
    </AgentProvider>
  );
}

function AppShell() {
  const { t } = useTranslation(["app", "common"]);
  const { toggleSidebar, sidebarOpen, setSidebarOpen } = useAgentContext();
  const { left: toolBarLeft, right: toolBarRight } = useToolBar();
  const [page, setPage] = useState<AppPage>("compose");
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [composeOpenExamId, setComposeOpenExamId] = useState<string | null>(null);
  const [assistantOverlayHost, setAssistantOverlayHost] = useState<HTMLDivElement | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null);
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [adminProjectMode, setAdminProjectMode] = useState(false);

  const refreshInfo = useCallback(async () => {
    try {
      setErr(null);
      const i = await apiGet<ProjectInfo>("/api/project/info");
      setInfo(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    setPlatformProjectRoot(info?.bound ? info.root : null);
  }, [info?.bound, info?.root]);

  const refreshPlatform = useCallback(async () => {
    setPlatformLoading(true);
    try {
      setErr(null);
      const status = await getPlatformStatus();
      setPlatformStatus(status);
      if (status.admin_exists) {
        const me = await getCurrentUser();
        setCurrentUser(me.user);
      } else {
        setCurrentUser(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPlatformStatus(null);
      setCurrentUser(null);
    } finally {
      setPlatformLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlatform();
  }, [refreshPlatform]);

  /**
   * 侧栏开关生命周期：
   * - 内容目录尚未就绪时强制关闭；
   * - 平台状态从未就绪进入就绪时强制关闭，避免沿用旧状态导致误开；
   * - 首次启动即已就绪时不走状态切换分支，避免多余一次 setState。
   */
  const prevBoundRef = useRef<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    const bound = Boolean(info?.bound);
    if (!bound) {
      setSidebarOpen(false);
    } else if (prevBoundRef.current === false) {
      setSidebarOpen(false);
    }
    prevBoundRef.current = bound;
  }, [info?.bound, setSidebarOpen]);

  useEffect(() => {
    return installImeCompositionTracker();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposingKeyboardEvent(e)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        dispatchSolaireSave();
      }
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  const onAuthenticated = useCallback((user: PlatformUser) => {
    setCurrentUser(user);
    setAdminProjectMode(false);
    setPage(user.role === "teacher" ? "papers" : user.role);
  }, []);

  const onLogout = useCallback(async () => {
    try {
      await logoutPlatform();
    } finally {
      setCurrentUser(null);
      setAdminProjectMode(false);
      setPage("papers");
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  const openPapersPage = useCallback(() => {
    setPage("papers");
  }, []);

  const platformRoute = resolvePlatformRoute({
    loading: platformLoading,
    adminExists: Boolean(platformStatus?.admin_exists),
    userRole: currentUser?.role ?? null,
    adminProjectMode,
  });

  return (
    <div
      className={cn(
        "flex h-screen min-h-0 flex-col bg-slate-50 text-slate-900",
        isTauriShell() && "box-border overflow-hidden rounded-lg",
      )}
    >
      <DesktopTitleBar />

      <div className="relative flex min-h-0 flex-1">
        {platformRoute === "loading" ? (
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-slate-500">
            正在加载平台权限...
          </div>
        ) : platformRoute === "bootstrap" ? (
          <PlatformLogin mode="bootstrap" onAuthenticated={onAuthenticated} onError={setErr} />
        ) : platformRoute === "login" ? (
          <PlatformLogin mode="login" onAuthenticated={onAuthenticated} onError={setErr} />
        ) : platformRoute === "admin" && currentUser ? (
          <AdminWorkspace
            user={currentUser}
            onLogout={() => void onLogout()}
            onError={setErr}
          />
        ) : platformRoute === "school" && currentUser ? (
          <SchoolWorkspace user={currentUser} onLogout={() => void onLogout()} onError={setErr} />
        ) : platformRoute === "student" && currentUser ? (
          <StudentWorkspace user={currentUser} onLogout={() => void onLogout()} />
        ) : (
          <TeacherWorkspace>
            <aside className="flex w-16 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
              {currentUser ? <TeacherUserBadge user={currentUser} /> : null}
              <nav className="flex flex-1 flex-col gap-1 p-2">
                <div className="flex flex-1 flex-col gap-1">
                  <SidebarNavButton
                    icon={Network}
                    label={t("app:nav.graph")}
                    active={page === "graph"}
                    onClick={() => setPage("graph")}
                  />
                  <SidebarNavButton
                    icon={BookMarked}
                    label={t("app:nav.bank")}
                    active={page === "bank"}
                    onClick={() => setPage("bank")}
                  />
                  <SidebarNavButton
                    icon={FileStack}
                    label={t("app:nav.template")}
                    active={page === "template"}
                    onClick={() => setPage("template")}
                  />
                  <SidebarNavButton
                    icon={Layers}
                    label={t("app:nav.compose")}
                    active={page === "compose"}
                    onClick={() => setPage("compose")}
                  />
                  <SidebarNavButton
                    icon={ClipboardList}
                    label="试卷"
                    active={page === "papers"}
                    onClick={() => setPage("papers")}
                    testId="nav-papers"
                    title="试卷管理"
                  />
                  <SidebarNavButton
                    icon={BarChart3}
                    label={t("app:nav.analysis")}
                    active={page === "analysis"}
                    onClick={() => setPage("analysis")}
                    title={t("app:nav.analysisTitle")}
                  />
                  <SidebarNavButton
                    icon={Sparkles}
                    label={t("app:nav.assistant")}
                    active={sidebarOpen}
                    onClick={() => toggleSidebar()}
                    title={t("app:nav.assistantTitle")}
                  />
                </div>
                <div className="mt-auto flex flex-col gap-1 border-t border-slate-800 pt-2">
                  <SidebarNavButton
                    icon={BookOpen}
                    label={t("app:nav.help")}
                    active={page === "help"}
                    onClick={() => setPage("help")}
                    title={t("app:nav.helpTitle")}
                  />
                  <SidebarNavButton
                    icon={Settings}
                    label="设置"
                    active={page === "settings"}
                    onClick={() => setPage("settings")}
                    title="设置"
                  />
                  <SidebarNavButton
                    icon={LogOut}
                    label="退出"
                    onClick={() => void onLogout()}
                    title="退出登录"
                  />
                </div>
              </nav>
            </aside>

            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <ToolBar left={toolBarLeft} right={toolBarRight} />

              {err && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5"
                  role="alert"
                >
                  <p className="min-w-0 flex-1 truncate text-sm leading-snug text-red-800">{err}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs text-red-600/90">
                    {t("app:errorBannerLogHint")}
                  </span>
                </div>
              )}

              <div
                ref={setAssistantOverlayHost}
                className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  {info?.bound && (
                    <div
                      className={cn(
                        "h-full min-h-0 min-w-0 overflow-hidden",
                        page !== "compose" && "hidden",
                      )}
                      aria-hidden={page !== "compose"}
                    >
                      <ComposeRoute
                        info={info}
                        onRefreshInfo={refreshInfo}
                        onError={setErr}
                        toolBarActive={page === "compose"}
                        openExamId={composeOpenExamId}
                        onOpenExamConsumed={() => setComposeOpenExamId(null)}
                        onOpenPapers={openPapersPage}
                      />
                    </div>
                  )}
                  {page === "bank" && (
                    <BankRoute
                      info={info}
                      onRefreshInfo={refreshInfo}
                      onError={setErr}
                      onOpenGraphNode={(nodeId) => {
                        setGraphFocusNodeId(nodeId);
                        setPage("graph");
                      }}
                    />
                  )}
                  {page === "template" && <TemplateRoute info={info} onRefreshInfo={refreshInfo} onError={setErr} />}
                  {page === "graph" && (
                    <GraphRoute
                      info={info}
                      onRefreshInfo={refreshInfo}
                      onError={setErr}
                      focusNodeId={graphFocusNodeId}
                      onFocusConsumed={() => setGraphFocusNodeId(null)}
                    />
                  )}
                  {page === "papers" && (
                    <PapersWorkspace
                      onOpenAnalysis={() => {
                        setPage("analysis");
                      }}
                      onError={setErr}
                    />
                  )}
                  {page === "settings" && (
                    <SettingsWorkspace onError={setErr} userRole={currentUser?.role} />
                  )}
                  {page === "help" && <HelpWorkspace onError={setErr} />}
                  {page === "analysis" && (
                    <AnalysisWorkspace
                      onOpenExamInCompose={(examId) => {
                        setComposeOpenExamId(examId);
                        setPage("compose");
                      }}
                    />
                  )}
                </main>
                <AgentSidebar projectBound mode="overlay" overlayHost={assistantOverlayHost} />
              </div>
            </div>
          </TeacherWorkspace>
        )}
      </div>
    </div>
  );
}

function TeacherUserBadge({ user }: { user: PlatformUser }) {
  const displayName = user.display_name || user.username;
  const initial = (displayName.trim()[0] || user.username.trim()[0] || "U").toUpperCase();
  return (
    <div className="border-b border-slate-800 p-2">
      <div
        className="flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-center"
        title={`${displayName} / ${user.username}`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-900">
          {initial}
        </span>
        <span className="block max-w-12 truncate text-[10px] font-medium leading-tight text-slate-200">
          {displayName}
        </span>
      </div>
    </div>
  );
}

function SidebarNavButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  title,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title ?? label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && !active && "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
        active && "bg-slate-800 text-white shadow-inner",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      <span className="leading-tight">{label}</span>
    </button>
  );
}
