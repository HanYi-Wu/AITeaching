import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";
import { useAgentSidebar } from "../contexts/AgentContext";
import { cn } from "../lib/utils";
import "../ui-redesign/g55/g55.css";

const AgentChatPanel = lazy(() => import("./AgentChatPanel").then((module) => ({ default: module.AgentChatPanel })));

function AssistantLoading({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(["agent", "app"]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--or-outline)] px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-[var(--or-primary)]" />{t("agent:title")}</span>
        <button type="button" data-assistant-close aria-label={t("agent:collapseSidebar")} onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--or-muted)]"><X className="h-4 w-4" /></button>
      </div>
      <div role="status" className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--or-muted)]">{t("app:loading.workspace")}</div>
    </div>
  );
}

export function getAssistantOverlayWidth(hostWidth: number): number {
  if (hostWidth <= 0) return 0;
  return Math.min(hostWidth, 420, Math.max(320, hostWidth * 0.34));
}

export function AgentSidebar({
  projectBound = false,
  mode = "overlay",
  overlayHost = null,
}: {
  projectBound?: boolean;
  /** dock：与主区并排；overlay：覆盖在右侧，不挤压主区宽度 */
  mode?: "dock" | "overlay";
  overlayHost?: HTMLElement | null;
}) {
  const { sidebarOpen, setSidebarOpen } = useAgentSidebar();
  const [panelReady, setPanelReady] = useState(false);
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(max-width: 767px)").matches ?? false),
  );
  const overlayDrawerRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);
  const focusLoadedPanel = useCallback(() => {
    const drawer = mode === "overlay" ? overlayDrawerRef.current : dockRef.current;
    if (isMobile && sidebarOpen && drawer && (document.activeElement === document.body || document.activeElement === drawer)) {
      drawer.querySelector<HTMLElement>("[data-assistant-close]")?.focus({ preventScroll: true });
    }
  }, [isMobile, mode, sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen || panelReady) return;
    let timer: number | undefined;
    // Paint the usable drawer shell before importing and initializing chat.
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setPanelReady(true), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sidebarOpen, panelReady]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateViewport = () => setIsMobile(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useLayoutEffect(() => {
    overlayDrawerRef.current?.toggleAttribute("inert", !sidebarOpen);
    dockRef.current?.toggleAttribute("inert", !sidebarOpen);
  }, [mode, sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen || !isMobile) {
      if (!sidebarOpen && returnFocusRef.current?.isConnected) {
        returnFocusRef.current.focus({ preventScroll: true });
        returnFocusRef.current = null;
      }
      return;
    }

    const drawer = mode === "overlay" ? overlayDrawerRef.current : dockRef.current;
    if (!drawer) return;
    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    const getFocusable = () => Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    (drawer.querySelector<HTMLElement>("[data-assistant-close]") ?? getFocusable()[0] ?? drawer).focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === drawer || document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === drawer || document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, mode, setSidebarOpen, sidebarOpen]);

  useLayoutEffect(() => {
    if (mode !== "overlay" || !overlayHost || typeof window === "undefined") {
      setOverlayStyle(null);
      return;
    }

    const updateOverlayStyle = () => {
      const rect = overlayHost.getBoundingClientRect();
      const width = getAssistantOverlayWidth(rect.width);
      setOverlayStyle({
        position: "fixed",
        top: rect.top,
        right: Math.max(window.innerWidth - rect.right, 0),
        width,
        height: rect.height,
      });
    };

    updateOverlayStyle();

    const resizeObserver = new ResizeObserver(() => updateOverlayStyle());
    resizeObserver.observe(overlayHost);
    window.addEventListener("resize", updateOverlayStyle);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverlayStyle);
    };
  }, [mode, overlayHost]);

  const loading = <AssistantLoading onClose={closeSidebar} />;
  const panel = panelReady ? (
    <Suspense fallback={loading}>
      <AgentChatPanel projectBound={projectBound} onRequestCollapse={closeSidebar} onReady={focusLoadedPanel} />
    </Suspense>
  ) : loading;

  if (mode === "overlay") {
    if (!overlayHost || !overlayStyle) return null;

    return createPortal(
      <>
        {/* Mobile backdrop for overlay drawer */}
        {sidebarOpen && (
          <div
            className="or-assistant-backdrop fixed inset-0 z-[39] bg-black/40 backdrop-blur-xs transition-opacity duration-250 motion-reduce:transition-none md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          ref={overlayDrawerRef}
          style={overlayStyle}
          className={cn(
            "or-assistant-drawer z-[40] flex min-w-0 max-w-full flex-col overflow-hidden border-l border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl transition-transform duration-[250ms] ease-out motion-reduce:transition-none",
            sidebarOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
          )}
          role={isMobile ? "dialog" : undefined}
          aria-label="源远教学平台 AI 助手"
          aria-modal={isMobile && sidebarOpen ? true : undefined}
          tabIndex={-1}
          aria-hidden={!sidebarOpen}
        >
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
            {panel}
          </div>
        </aside>
      </>,
      document.body,
    );
  }

  return (
    <>
      {sidebarOpen && isMobile ? (
        <button
          type="button"
          className="or-assistant-backdrop absolute inset-0 z-[39] bg-black/40 backdrop-blur-[1px] transition-opacity duration-[250ms] motion-reduce:transition-none md:hidden"
          aria-label="关闭 AI 助手"
          tabIndex={-1}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        ref={dockRef}
        className={cn(
          "or-assistant-drawer absolute inset-y-0 right-0 z-[40] flex w-[min(90vw,420px)] max-w-full translate-x-0 flex-col overflow-hidden border-l border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl transition-[transform,width] duration-[250ms] ease-out motion-reduce:transition-none md:relative md:inset-auto md:z-auto md:shrink-0 md:translate-x-0 md:shadow-none",
          sidebarOpen
            ? "pointer-events-auto"
            : "pointer-events-none translate-x-full md:w-0 md:min-w-0 md:border-l-0",
          sidebarOpen && "md:w-[22rem]",
        )}
        role={isMobile ? "dialog" : undefined}
        aria-label="源远教学平台 AI 助手"
        aria-modal={isMobile && sidebarOpen ? true : undefined}
        tabIndex={-1}
        aria-hidden={!sidebarOpen}
      >
        {panel}
      </aside>
    </>
  );
}
