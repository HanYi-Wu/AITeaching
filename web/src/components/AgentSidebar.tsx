import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AgentChatPanel } from "./AgentChatPanel";
import { useAgentContext } from "../contexts/AgentContext";
import { cn } from "../lib/utils";
import "../ui-redesign/g55/g55.css";

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
  const { sidebarOpen, setSidebarOpen } = useAgentContext();
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(max-width: 767px)").matches ?? false),
  );
  const overlayDrawerRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
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
            <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
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
        <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
      </aside>
    </>
  );
}
