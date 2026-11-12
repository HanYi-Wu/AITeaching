import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  ClipboardList,
  FileStack,
  Layers,
  LogOut,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { WorkspaceLoadBoundary } from './components/WorkspaceLoadBoundary';
import { TeacherFirstUseGuide } from './components/TeacherFirstUseGuide';
import { LoginHandoff } from './pages/platform/login/LoginHandoff';
import { ToolBar } from "./components/layout/ToolBar";
import { AgentSidebar } from "./components/AgentSidebar";
import { AgentProvider, useAgentSidebar } from "./contexts/AgentContext";
import { ToolBarProvider, useToolBar } from "./contexts/ToolBarContext";
import { apiGet } from "./api/client";
import { dispatchSolaireSave } from "./lib/saveEvents";
import { installImeCompositionTracker, isImeComposingKeyboardEvent } from "./lib/ime";
import { installAppearance } from "./design-system/appearance";
import { SelectionIndicator } from "./design-system/SelectionIndicator";
import { cn } from "./lib/utils";
import { isTauriShell } from "./lib/tauriEnv";
import { trackWorkspaceAnimation } from "./lib/workspaceWorkScheduler";
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

const AnalysisWorkspace = lazy(() =>
  import("./pages/analysis/AnalysisWorkspace").then((module) => ({ default: module.AnalysisWorkspace })),
);
const HelpWorkspace = lazy(() =>
  import("./pages/help/HelpWorkspace").then((module) => ({ default: module.HelpWorkspace })),
);
const SettingsWorkspace = lazy(() =>
  import("./pages/settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);
const AdminWorkspace = lazy(() =>
  import("./pages/platform/admin/AdminWorkspace").then((module) => ({ default: module.AdminWorkspace })),
);
const PapersWorkspace = lazy(() =>
  import("./pages/platform/papers/PapersWorkspace").then((module) => ({ default: module.PapersWorkspace })),
);
const TeacherStudentInsightsWorkspace = lazy(() =>
  import("./pages/platform/insights/TeacherStudentInsightsWorkspace").then((module) => ({ default: module.TeacherStudentInsightsWorkspace })),
);
const PlatformLogin = lazy(() =>
  import("./pages/platform/login/PlatformLogin").then((module) => ({ default: module.PlatformLogin })),
);
const SchoolWorkspace = lazy(() =>
  import("./pages/platform/school/SchoolWorkspace").then((module) => ({ default: module.SchoolWorkspace })),
);
const StudentWorkspace = lazy(() =>
  import("./pages/platform/student/StudentWorkspace").then((module) => ({ default: module.StudentWorkspace })),
);
const TeacherWorkspace = lazy(() =>
  import("./pages/platform/TeacherWorkspace").then((module) => ({ default: module.TeacherWorkspace })),
);

function preloadAuthenticatedWorkspace(user: PlatformUser): Promise<unknown>[] {
  switch (user.role) {
    case "teacher":
      return [
        import("./pages/platform/TeacherWorkspace"),
        import("./pages/platform/papers/PapersWorkspace"),
      ];
    case "student":
      return [import("./pages/platform/student/StudentWorkspace")];
    case "school":
      return [import("./pages/platform/school/SchoolWorkspace")];
    case "admin":
      return [import("./pages/platform/admin/AdminWorkspace")];
  }
}

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
  const { t, i18n } = useTranslation(["app", "common"]);
  const { toggleSidebar, sidebarOpen, setSidebarOpen, resetAgentContext } = useAgentSidebar();
  const [page, setPage] = useState<AppPage>("compose");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isMobileNavigation, setIsMobileNavigation] = useState(
    () => window.matchMedia?.("(max-width: 767px)").matches ?? false,
  );
  const pageBodyRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [composeOwner, setComposeOwner] = useState<string | null>(null);
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [composeOpenExamId, setComposeOpenExamId] = useState<string | null>(null);
  const [paperOpenTarget, setPaperOpenTarget] = useState<{ paperId: string; attemptId: string; title: string } | null>(null);
  const [studentPracticeTarget, setStudentPracticeTarget] = useState<{ classId: string; studentId: string; name: string } | null>(null);
  const [assistantOverlayHost, setAssistantOverlayHost] = useState<HTMLDivElement | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null);
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [infoAccountId, setInfoAccountId] = useState<string | null>(null);
  const [assistantMounted, setAssistantMounted] = useState(false);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [loginHandoff, setLoginHandoff] = useState(false);
  const [adminProjectMode, setAdminProjectMode] = useState(false);
  const projectInfoRequestId = useRef(0);
  const platformRequestId = useRef(0);
  const assistantScope = JSON.stringify([
    currentUser?.id ?? null,
    infoAccountId === (currentUser?.id ?? "local") && info?.bound ? info.root || info.project_id || null : null,
  ]);

  useLayoutEffect(() => {
    resetAgentContext?.();
  }, [assistantScope, resetAgentContext]);

  useLayoutEffect(() => installAppearance(currentUser), [currentUser?.id, currentUser?.preferences]);

  useLayoutEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = pageBodyRef.current?.animate?.([{ opacity: 0.6 }, { opacity: 1 }], { duration: 220, easing: "ease-in-out" });
    const stopTracking = trackWorkspaceAnimation(animation ?? null);
    return () => {
      stopTracking();
      animation?.cancel();
    };
  }, [page]);

  const refreshInfo = useCallback(async () => {
    const requestId = ++projectInfoRequestId.current;
    setInfoAccountId(null);
    try {
      setErr(null);
      const i = await apiGet<ProjectInfo>("/api/project/info");
      if (requestId === projectInfoRequestId.current) {
        setInfo(i);
        setInfoAccountId(currentUser?.id ?? "local");
      }
    } catch (e) {
      if (requestId === projectInfoRequestId.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (sidebarOpen) setAssistantMounted(true);
  }, [sidebarOpen]);

  useEffect(() => {
    const invalidate = () => { projectInfoRequestId.current += 1; };
    invalidate();
    if (platformLoading || platformStatus === null) return invalidate;
    if (currentUser?.role === "school" || currentUser?.role === "student") {
      setInfo(null);
      return invalidate;
    }
    if (platformStatus.public_mode && currentUser === null) {
      setInfo(null);
      return invalidate;
    }
    void refreshInfo();
    return invalidate;
  }, [currentUser, platformLoading, platformStatus, refreshInfo]);

  useEffect(() => {
    setPlatformProjectRoot(info?.bound ? info.root : null);
  }, [info?.bound, info?.root]);

  const refreshPlatform = useCallback(async () => {
    const requestId = ++platformRequestId.current;
    setPlatformLoading(true);
    try {
      setErr(null);
      const status = await getPlatformStatus();
      if (requestId !== platformRequestId.current) return;
      const user = status.admin_exists ? (await getCurrentUser()).user : null;
      if (requestId !== platformRequestId.current) return;
      setPlatformStatus(status);
      setCurrentUser(user);
    } catch (e) {
      if (requestId !== platformRequestId.current) return;
      setErr(e instanceof Error ? e.message : String(e));
      setPlatformStatus(null);
      setCurrentUser(null);
    } finally {
      if (requestId === platformRequestId.current) setPlatformLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlatform();
    return () => { platformRequestId.current += 1; };
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
    const media = window.matchMedia?.("(max-width: 767px)");
    if (!media) return;
    const sync = () => setIsMobileNavigation(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
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
    setAssistantMounted(false);
    setPlatformLoading(false);
    setErr(null);
    setPlatformStatus((status) => status ? { ...status, admin_exists: true } : status);
    setCurrentUser(user);
    setAdminProjectMode(false);
    setPage(user.role === "teacher" ? "papers" : user.role);
  }, []);

  const onLoginAuthenticated = useCallback(async (user: PlatformUser) => {
    platformRequestId.current += 1;
    await Promise.allSettled(preloadAuthenticatedWorkspace(user));
    setLoginHandoff(true);
    onAuthenticated(user);
  }, [onAuthenticated]);
  const finishLoginHandoff = useCallback(() => setLoginHandoff(false), []);

  const onManagementProfileUpdated = useCallback((profile: PlatformUser) => {
    setCurrentUser((current) => current?.id === profile.id ? { ...current, ...profile } : current);
  }, []);

  const onLogout = useCallback(async () => {
    setAssistantMounted(false);
    platformRequestId.current += 1;
    setCurrentUser(null);
    setAdminProjectMode(false);
    setPage("papers");
    setSidebarOpen(false);
    await logoutPlatform();
  }, [setSidebarOpen]);

  const openPapersPage = useCallback(() => {
    setPage("papers");
  }, []);
  const onOpenExamConsumed = useCallback(() => {
    setComposeOpenExamId(null);
  }, []);

  const platformRoute = resolvePlatformRoute({
    loading: platformLoading,
    statusAvailable: platformStatus !== null,
    adminExists: Boolean(platformStatus?.admin_exists),
    userRole: currentUser?.role ?? null,
    adminProjectMode,
  });

  useLayoutEffect(() => {
    if (platformRoute !== "loading" && platformRoute !== "login" && platformRoute !== "bootstrap") {
      delete document.documentElement.dataset.orBootLogin;
    }
  }, [platformRoute]);

  const mobileMoreActive = sidebarOpen || ["template", "students", "analysis", "help", "settings"].includes(page);
  const navigationSelector = isMobileNavigation
    ? '[data-mobile-primary="true"][aria-current="page"], [data-mobile-more][aria-current="page"]'
    : '[aria-current="page"]';

  const closeMoreAnd = (action: () => void) => () => {
    setMoreOpen(false);
    action();
  };
  const moreLabel = t("app:nav.more", {
    defaultValue: (i18n.language || "zh").startsWith("zh") ? "更多" : "More",
  });
  const closeMoreLabel = (i18n.language || "zh").startsWith("zh") ? "关闭更多菜单" : "Close more menu";

  useEffect(() => {
    if (info?.bound && currentUser && page === 'compose') setComposeOwner(currentUser.id);
  }, [info?.bound, currentUser?.id, page]);

  // Opening navigation or the assistant must not re-render the active editor.
  // Its own data, account, project and route changes still update normally.
  const workspaceContent = useMemo(() => (
    <WorkspaceLoadBoundary resetKey={page}>
      <Suspense fallback={<AppLoadingFallback />}>
        {info?.bound && (page === "compose" || Boolean(composeOwner && composeOwner === currentUser?.id)) && (
          <div className={cn("h-full min-h-0 min-w-0 overflow-hidden", page !== "compose" && "hidden")} aria-hidden={page !== "compose"}>
            <ComposeRoute
              key={currentUser?.id ?? "local"} info={info} accountId={currentUser?.id ?? null}
              onRefreshInfo={refreshInfo} onError={setErr} toolBarActive={page === "compose"}
              openExamId={composeOpenExamId} onOpenExamConsumed={onOpenExamConsumed} onOpenPapers={openPapersPage}
            />
          </div>
        )}
        {page === "bank" && <BankRoute info={info} onRefreshInfo={refreshInfo} onError={setErr} onOpenGraphNode={(nodeId) => { setGraphFocusNodeId(nodeId); setPage("graph"); }} />}
        {page === "template" && <TemplateRoute info={info} onRefreshInfo={refreshInfo} onError={setErr} />}
        {page === "graph" && <GraphRoute info={info} accountId={currentUser?.id ?? null} onRefreshInfo={refreshInfo} onError={setErr} focusNodeId={graphFocusNodeId} onFocusConsumed={() => setGraphFocusNodeId(null)} />}
        {page === "papers" && (
          <PapersWorkspace
            projectScope={infoAccountId === (currentUser?.id ?? "local")
              ? { ready: true, value: info?.bound ? info.root ?? null : null }
              : { ready: false, value: null }}
            openTarget={paperOpenTarget} assignStudent={studentPracticeTarget}
            onAssignStudentConsumed={() => setStudentPracticeTarget(null)} onOpenTargetConsumed={() => setPaperOpenTarget(null)}
            onOpenBank={() => setPage("bank")} onOpenTemplates={() => setPage("template")} onOpenCompose={() => setPage("compose")}
            onOpenAnalysis={() => setPage("analysis")} onError={setErr}
          />
        )}
        {page === "students" && <TeacherStudentInsightsWorkspace onError={setErr} onOpenPaper={(target) => { setPaperOpenTarget(target); setPage("papers"); }} onAssignStudent={(target) => { setStudentPracticeTarget(target); setPage("papers"); }} />}
        {page === "settings" && <SettingsWorkspace onError={setErr} userRole={currentUser?.role} onProfileUpdated={setCurrentUser} />}
        {page === "help" && <HelpWorkspace onError={setErr} />}
        {page === "analysis" && (
          <AnalysisWorkspace
            allowHostTools={!platformStatus?.public_mode && currentUser?.role === "admin"}
            ownerId={currentUser?.id ?? null} projectId={info?.bound ? info.root || info.project_id : null}
            onOpenExamInCompose={(examId) => { setComposeOpenExamId(examId); setPage("compose"); }}
          />
        )}
      </Suspense>
    </WorkspaceLoadBoundary>
  ), [page, info, infoAccountId, currentUser?.id, currentUser?.role, composeOwner, composeOpenExamId, graphFocusNodeId, paperOpenTarget, studentPracticeTarget, platformStatus?.public_mode, refreshInfo, openPapersPage, onOpenExamConsumed]);

  return (
    <div
      className={cn(
        "or-app flex h-screen h-[100dvh] min-h-0 flex-col bg-[var(--or-page)] text-[var(--or-text)]",
        isTauriShell() && "box-border overflow-hidden rounded-lg",
      )}
    >
      <DesktopTitleBar />

      <div className={cn("relative flex min-h-0 flex-1 flex-col md:flex-row", loginHandoff && "or-login-workspace-entering")}>
        <Suspense fallback={<AppLoadingFallback />}>
        {platformRoute === "loading" ? (
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-[var(--or-muted)]">
            {t("app:loading.permissions")}
          </div>
        ) : platformRoute === "unavailable" ? (
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-[var(--or-page)] p-6">
            <div className="w-full max-w-md rounded-[16px] border border-[var(--or-warning)] bg-[var(--or-card)] p-6 text-center shadow-sm">
              <h1 className="text-lg font-semibold text-[var(--or-text)]">平台服务暂时不可用</h1>
              <p className="mt-2 text-sm text-[var(--or-muted)]">后端服务尚未启动或正在重启，请稍后重试。</p>
              {err ? <p className="mt-2 break-words text-xs sm:text-sm text-[var(--or-on-warning)] dark:text-[var(--or-on-warning)]">{err}</p> : null}
              <button
                type="button"
                onClick={() => void refreshPlatform()}
                className="or-button or-button-primary mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold"
              >
                重新连接
              </button>
            </div>
          </div>
        ) : platformRoute === "bootstrap" ? (
          <PlatformLogin mode="bootstrap" onAuthenticated={onLoginAuthenticated} onError={setErr} />
        ) : platformRoute === "login" ? (
          <PlatformLogin mode="login" onAuthenticated={onLoginAuthenticated} onError={setErr} />
        ) : platformRoute === "admin" && currentUser ? (
          <WorkspaceLoadBoundary resetKey={`${platformRoute}:${currentUser.id}`}>
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <WorkspaceErrorBanner error={err} />
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <AdminWorkspace
                  user={currentUser}
                  onLogout={() => void onLogout()}
                  onError={setErr}
                  onProfileUpdated={onManagementProfileUpdated}
                />
              </div>
            </div>
          </WorkspaceLoadBoundary>
        ) : platformRoute === "school" && currentUser ? (
          <WorkspaceLoadBoundary resetKey={`${platformRoute}:${currentUser.id}`}>
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <WorkspaceErrorBanner error={err} />
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <SchoolWorkspace user={currentUser} onLogout={() => void onLogout()} onError={setErr} onProfileUpdated={onManagementProfileUpdated} />
              </div>
            </div>
          </WorkspaceLoadBoundary>
        ) : platformRoute === "student" && currentUser ? (
          <WorkspaceLoadBoundary resetKey={`${platformRoute}:${currentUser.id}`}>
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <WorkspaceErrorBanner error={err} />
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <StudentWorkspace user={currentUser} onLogout={() => void onLogout()} />
              </div>
            </div>
          </WorkspaceLoadBoundary>
        ) : (
          <TeacherWorkspace>
            <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <aside
              className={cn("or-sidebar or-mobile-nav", navCollapsed && "is-collapsed")}
              aria-hidden={moreOpen || undefined}
            >
              <div className="or-sidebar-brand">
                <span className="or-brand-icon" aria-hidden="true">
                  <img src="/splash-logo.png" alt="" width={28} height={28} draggable={false} />
                </span>
                <span className="or-brand-name">源远</span>
                <button type="button" className="or-sidebar-toggle or-icon-button" aria-label={navCollapsed ? "展开导航" : "收起导航"} aria-expanded={!navCollapsed} onClick={() => setNavCollapsed(!navCollapsed)}>
                  {navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                </button>
              </div>
              {currentUser ? <TeacherUserBadge user={currentUser} /> : null}
              <nav ref={navigationRef} className="or-sidebar-nav no-scrollbar" aria-label="教师工作区导航">
                <SelectionIndicator rootRef={navigationRef} selector={navigationSelector} className="or-navigation-indicator" />
                <div className="or-sidebar-primary">
                  <SidebarNavButton
                    icon={Network}
                    label={t("app:nav.graph")}
                    active={page === "graph"}
                    onClick={() => setPage("graph")}
                    mobilePrimary
                  />
                  <SidebarNavButton
                    icon={BookMarked}
                    label={t("app:nav.bank")}
                    active={page === "bank"}
                    onClick={() => setPage("bank")}
                    mobilePrimary
                  />
                  <SidebarNavButton
                    icon={FileStack}
                    label={t("app:nav.template")}
                    active={page === "template"}
                    onClick={() => setPage("template")}
                    mobileOverflow
                  />
                  <SidebarNavButton
                    icon={Layers}
                    label={t("app:nav.compose")}
                    active={page === "compose"}
                    onClick={() => setPage("compose")}
                    mobilePrimary
                  />
                  <SidebarNavButton
                    icon={ClipboardList}
                    label={t("app:nav.papers")}
                    active={page === "papers"}
                    onClick={() => setPage("papers")}
                    testId="nav-papers"
                    title={t("app:nav.papersTitle")}
                    mobilePrimary
                  />
                  <SidebarNavButton
                    icon={Users}
                    label={t("app:nav.students")}
                    active={page === "students"}
                    onClick={() => setPage("students")}
                    testId="nav-students"
                    title={t("app:nav.studentsTitle")}
                    mobileOverflow
                  />
                  <SidebarNavButton
                    icon={BarChart3}
                    label={t("app:nav.analysis")}
                    active={page === "analysis"}
                    onClick={() => setPage("analysis")}
                    title={t("app:nav.analysisTitle")}
                    mobileOverflow
                  />
                  <SidebarNavButton
                    icon={Sparkles}
                    label={t("app:nav.assistant")}
                    active={sidebarOpen}
                    onClick={() => toggleSidebar()}
                    title={t("app:nav.assistantTitle")}
                    mobileOverflow
                  />
                </div>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    data-mobile-more
                    aria-label={moreLabel}
                    aria-current={isMobileNavigation && mobileMoreActive ? "page" : undefined}
                    aria-haspopup="dialog"
                    className={cn("or-nav-item or-mobile-more-trigger", isMobileNavigation && mobileMoreActive && "is-active")}
                  >
                    <MoreHorizontal className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                    <span className="or-nav-label">{moreLabel}</span>
                  </button>
                </Dialog.Trigger>
                <div className="or-sidebar-secondary">
                  <SidebarNavButton
                    icon={BookOpen}
                    label={t("app:nav.help")}
                    active={page === "help"}
                    onClick={() => setPage("help")}
                    title={t("app:nav.helpTitle")}
                    mobileOverflow
                  />
                  <SidebarNavButton
                    icon={Settings}
                    label={t("app:nav.settings")}
                    active={page === "settings"}
                    onClick={() => setPage("settings")}
                    title={t("app:nav.settingsTitle")}
                    mobileOverflow
                  />
                  <SidebarNavButton
                    icon={LogOut}
                    label={t("app:nav.logout")}
                    onClick={() => void onLogout()}
                    title={t("app:nav.logoutTitle")}
                    mobileOverflow
                  />
                </div>
              </nav>
            </aside>
            <Dialog.Portal>
              <Dialog.Overlay className="or-mobile-more-backdrop" />
              <Dialog.Content className="or-mobile-more-sheet" aria-describedby={undefined}>
                <div className="or-mobile-more-header">
                  <Dialog.Title className="or-mobile-more-title">{moreLabel}</Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" className="or-mobile-more-close" aria-label={closeMoreLabel}>
                      <X className="h-5 w-5" aria-hidden />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="or-mobile-more-grid">
                  <SidebarNavButton
                    icon={FileStack}
                    label={t("app:nav.template")}
                    active={page === "template"}
                    onClick={closeMoreAnd(() => setPage("template"))}
                    title={t("app:nav.template")}
                  />
                  <SidebarNavButton
                    icon={Users}
                    label={t("app:nav.students")}
                    active={page === "students"}
                    onClick={closeMoreAnd(() => setPage("students"))}
                    title={t("app:nav.studentsTitle")}
                  />
                  <SidebarNavButton
                    icon={BarChart3}
                    label={t("app:nav.analysis")}
                    active={page === "analysis"}
                    onClick={closeMoreAnd(() => setPage("analysis"))}
                    title={t("app:nav.analysisTitle")}
                  />
                  <SidebarNavButton
                    icon={Sparkles}
                    label={t("app:nav.assistant")}
                    active={sidebarOpen}
                    onClick={closeMoreAnd(() => toggleSidebar())}
                    title={t("app:nav.assistantTitle")}
                  />
                  <SidebarNavButton
                    icon={BookOpen}
                    label={t("app:nav.help")}
                    active={page === "help"}
                    onClick={closeMoreAnd(() => setPage("help"))}
                    title={t("app:nav.helpTitle")}
                  />
                  <SidebarNavButton
                    icon={Settings}
                    label={t("app:nav.settings")}
                    active={page === "settings"}
                    onClick={closeMoreAnd(() => setPage("settings"))}
                    title={t("app:nav.settingsTitle")}
                  />
                  <SidebarNavButton
                    icon={LogOut}
                    label={t("app:nav.logout")}
                    onClick={closeMoreAnd(() => { void onLogout(); })}
                    title={t("app:nav.logoutTitle")}
                  />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
            </Dialog.Root>

            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <WorkspaceToolBar />

              {err && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_90%,transparent)] dark:bg-red-950/40 dark:border-red-900/40 px-4 py-2"
                  role="alert"
                >
                  <p className="min-w-0 flex-1 truncate text-sm leading-snug text-[var(--or-on-error)] dark:text-red-300">{err}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs sm:text-[13px] text-[color-mix(in_srgb,var(--or-on-error)_90%,transparent)] dark:text-[var(--or-on-error)]">
                    {t("app:errorBannerLogHint")}
                  </span>
                </div>
              )}

              {currentUser?.role === 'teacher' ? (
                <TeacherFirstUseGuide
                  key={currentUser.id}
                  user={currentUser}
                  onUpdated={setCurrentUser}
                  onNavigate={setPage}
                  onOpenAssistant={() => setSidebarOpen(true)}
                />
              ) : null}

              <div
                ref={setAssistantOverlayHost}
                className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <main ref={pageBodyRef} className="or-workspace-content min-h-0 min-w-0 flex-1 overflow-hidden">
                  {workspaceContent}
                </main>
                <WorkspaceLoadBoundary>
                <Suspense fallback={null}>
                  {(sidebarOpen || assistantMounted) && <AgentSidebar key={assistantScope} projectBound mode="dock" overlayHost={assistantOverlayHost} />}
                </Suspense>
                </WorkspaceLoadBoundary>
              </div>
            </div>
          </TeacherWorkspace>
        )}
        </Suspense>
        {loginHandoff && <LoginHandoff onFinished={finishLoginHandoff} />}
      </div>
    </div>
  );
}

function WorkspaceToolBar() {
  const { left, right } = useToolBar();
  return <ToolBar left={left} right={right} />;
}

function AppLoadingFallback() {
  const { t } = useTranslation("app");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-[var(--or-muted)]">
      {t("loading.workspace")}
    </div>
  );
}

function WorkspaceErrorBanner({ error }: { error: string | null }) {
  const { t } = useTranslation("app");
  if (!error) return null;
  return (
    <div
      className="flex max-h-32 shrink-0 items-start gap-2 overflow-hidden border-b border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_90%,transparent)] px-4 py-2 dark:border-red-900/40 dark:bg-red-950/40"
      role="alert"
    >
      <div
        className="max-h-24 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-snug text-[var(--or-on-error)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--or-error)] dark:text-red-300"
        tabIndex={0}
      >
        {error}
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs text-[color-mix(in_srgb,var(--or-on-error)_90%,transparent)] dark:text-[var(--or-on-error)] sm:text-[13px]">
        {t("errorBannerLogHint")}
      </span>
    </div>
  );
}

function TeacherUserBadge({ user }: { user: PlatformUser }) {
  const displayName = user.display_name || user.username;
  const initial = (displayName.trim()[0] || user.username.trim()[0] || "U").toUpperCase();
  return (
    <div className="or-user-badge">
      <div
        className="or-user-details"
        title={`${displayName} / ${user.username}`}
      >
        {user.avatar_data_url ? (
          <img src={user.avatar_data_url} alt="教师头像" className="h-9 w-9 rounded-full border border-[var(--or-outline)] object-cover" />
        ) : (
          <span className="or-user-avatar">{initial}</span>
        )}
        <span className="or-user-name">
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
  mobilePrimary,
  mobileOverflow,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  testId?: string;
  mobilePrimary?: boolean;
  mobileOverflow?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-mobile-primary={mobilePrimary ? "true" : undefined}
      data-mobile-overflow={mobileOverflow ? "true" : undefined}
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "or-nav-item",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && !active && "or-nav-idle",
        active && "is-active",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      <span className="or-nav-label">{label}</span>
    </button>
  );
}
