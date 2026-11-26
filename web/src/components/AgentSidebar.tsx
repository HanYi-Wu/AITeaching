import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronsDown, ChevronsLeft, ChevronsRight, ChevronsUp, Sparkles, X } from "lucide-react";
import { useAgentSidebar } from "../contexts/AgentContext";
import { cn } from "../lib/utils";
import "../ui-redesign/g55/g55.css";
import type { AgentWindowDragProps } from "./AgentChatPanel";

const AgentChatPanel = lazy(() => import("./AgentChatPanel").then((module) => ({ default: module.AgentChatPanel })));

function AssistantLoading({ onClose, windowControls, windowDrag }: { onClose: () => void; windowControls?: ReactNode; windowDrag?: AgentWindowDragProps }) {
  const { t } = useTranslation(["agent", "app"]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="or-agent-header" {...windowDrag}>
        <span className="or-agent-header-title"><Sparkles className="h-4 w-4 shrink-0 text-or-primary" />{t("agent:title")}</span>
        {windowControls}
        <button type="button" data-assistant-close aria-label={t("agent:collapseSidebar")} onClick={onClose} className="or-agent-icon"><X className="h-4 w-4" /></button>
      </div>
      <div role="status" className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--or-muted)]">{t("app:loading.workspace")}</div>
    </div>
  );
}

export function getAssistantOverlayWidth(hostWidth: number): number {
  if (hostWidth <= 0) return 0;
  return Math.min(hostWidth, 420, Math.max(320, hostWidth * 0.34));
}

type Point = { x: number; y: number };
type Edge = "left" | "right" | "top" | "bottom";
type EdgeTuck = { edge: Edge; along: number };
const edgeIcons = { left: ChevronsLeft, right: ChevronsRight, top: ChevronsUp, bottom: ChevronsDown };
const oppositeEdge: Record<Edge, Edge> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const edgeNames = { left: "左侧", right: "右侧", top: "上方", bottom: "下方" };
const edgeTransforms: Record<Edge, string> = { left: "translateX(-105%)", right: "translateX(105%)", top: "translateY(-105%)", bottom: "translateY(105%)" };
const EDGE_TAB_SIZE = 44;
const EDGE_TAB_PROXIMITY = 52;

export function getAssistantDragTuck(pointer: Point, panelTop: number, panelHeight: number, vw: number, vh: number): EdgeTuck | null {
  // Bottom is deliberately different: the pointer can still be inside the
  // viewport when more than half of the panel has moved below it.
  const candidates: Array<[Edge, number, number]> = [
    ["left", -pointer.x, pointer.y], ["right", pointer.x - vw, pointer.y],
    ["top", -pointer.y, pointer.x], ["bottom", panelTop + panelHeight / 2 - vh, pointer.x],
  ];
  const nearest = candidates.reduce((a, b) => b[1] > a[1] ? b : a);
  return nearest[1] >= 0 ? { edge: nearest[0], along: nearest[2] } : null;
}

function edgeTabCenter(along: number, viewport: number) {
  return Math.min(Math.max(EDGE_TAB_SIZE / 2, along), Math.max(EDGE_TAB_SIZE / 2, viewport - EDGE_TAB_SIZE / 2));
}

function EdgeTab({ tuck, preview, onRestore, tabRef }: {
  tuck: EdgeTuck; preview: boolean; onRestore: () => void; tabRef: React.RefObject<HTMLButtonElement>;
}) {
  const [near, setNear] = useState(false);
  const { edge, along } = tuck;
  const vertical = edge === "left" || edge === "right";
  const center = edgeTabCenter(along, vertical ? window.innerHeight : window.innerWidth);
  useEffect(() => {
    if (preview) return;
    const onMove = (event: PointerEvent) => {
      const distance = edge === "left" ? event.clientX : edge === "right" ? window.innerWidth - event.clientX
        : edge === "top" ? event.clientY : window.innerHeight - event.clientY;
      setNear(distance <= EDGE_TAB_PROXIMITY && Math.abs((vertical ? event.clientY : event.clientX) - center) <= EDGE_TAB_SIZE);
    };
    const onLeave = (event: PointerEvent) => { if (!event.relatedTarget) setNear(false); };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onLeave);
    return () => { window.removeEventListener("pointermove", onMove); document.removeEventListener("pointerout", onLeave); };
  }, [edge, vertical, center, preview]);
  const RestoreIcon = edgeIcons[oppositeEdge[edge]];
  const style: CSSProperties = { [edge]: 0, [vertical ? "top" : "left"]: center - EDGE_TAB_SIZE / 2 };
  return <button type="button" ref={tabRef} style={style} className="or-assistant-edge-tab"
    data-edge={edge} data-proximate={preview || near} disabled={preview} aria-hidden={preview || undefined}
    title="展开智能体" aria-label="展开智能体" onClick={onRestore}>
    <Sparkles className="h-4 w-4" /><RestoreIcon className="h-4 w-4" />
  </button>;
}

export function getAssistantSnapEdge(point: Point, width: number, height: number, vw: number, vh: number): Edge | null {
  const candidates: Array<[Edge, number]> = [
    ["left", point.x], ["right", vw - width - point.x],
    ["top", point.y], ["bottom", vh - height - point.y],
  ];
  const nearest = candidates.reduce((a, b) => b[1] < a[1] ? b : a);
  return nearest[1] <= 28 ? nearest[0] : null;
}

export function clampAssistantPosition(point: Point, panelWidth: number, panelHeight: number, viewportWidth: number, viewportHeight: number): Point {
  return {
    x: Math.min(Math.max(point.x, 0), Math.max(0, viewportWidth - panelWidth)),
    y: Math.min(Math.max(point.y, 0), Math.max(0, viewportHeight - panelHeight)),
  };
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
  const [position, setPosition] = useState<Point | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [tucked, setTucked] = useState<EdgeTuck | null>(null);
  const [dragPreview, setDragPreview] = useState<EdgeTuck | null>(null);
  const edgeTabRef = useRef<HTMLButtonElement>(null);
  const tuckButtonRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; from: Point; origin: Point; moved: boolean } | null>(null);
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
    overlayDrawerRef.current?.toggleAttribute("inert", !sidebarOpen || (Boolean(tucked) && !isMobile));
    dockRef.current?.toggleAttribute("inert", !sidebarOpen);
  }, [mode, sidebarOpen, tucked, isMobile]);

  useEffect(() => {
    if (!sidebarOpen || isMobile) { setTucked(null); setDragPreview(null); drag.current = null; }
  }, [sidebarOpen, isMobile]);

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
      const width = isMobile ? Math.min(window.innerWidth, Math.max(280, rect.width))
        : getAssistantOverlayWidth(rect.width || window.innerWidth);
      const height = isMobile ? window.innerHeight : Math.max(0, Math.min(620, window.innerHeight - 32, rect.height || window.innerHeight));
      const anchored = { x: isMobile ? window.innerWidth - width : rect.right - width - 16,
        y: isMobile ? 0 : Math.max(rect.top + 16, 16) };
      const coords = clampAssistantPosition(anchored, width, height, window.innerWidth, window.innerHeight);
      setOverlayStyle({
        position: "fixed",
        top: coords.y,
        left: coords.x,
        width,
        height,
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
  }, [isMobile, mode, overlayHost]);

  const renderPanel = (windowControls?: ReactNode, windowDrag?: AgentWindowDragProps) => {
    const loading = <AssistantLoading onClose={closeSidebar} windowControls={windowControls} windowDrag={windowDrag} />;
    return panelReady ? (
      <Suspense fallback={loading}>
        <AgentChatPanel projectBound={projectBound} onRequestCollapse={closeSidebar} onReady={focusLoadedPanel}
          tucked={Boolean(tucked) && !isMobile} windowControls={windowControls} windowDrag={windowDrag} />
      </Suspense>
    ) : loading;
  };

  if (mode === "overlay") {
    if (!overlayHost || !overlayStyle) return null;
    const width = Number(overlayStyle.width), height = Number(overlayStyle.height);
    const dockedEdge = isMobile ? null : edge;
    const displayedTuck = sidebarOpen && !isMobile ? dragPreview ?? tucked : null;
    const hidden = Boolean(displayedTuck);
    const moved = clampAssistantPosition(!isMobile && position ? position : { x: Number(overlayStyle.left), y: Number(overlayStyle.top) },
      width, height, window.innerWidth, window.innerHeight);
    if (dockedEdge === "left") moved.x = 0;
    if (dockedEdge === "right") moved.x = window.innerWidth - width;
    if (dockedEdge === "top") moved.y = 0;
    if (dockedEdge === "bottom") moved.y = window.innerHeight - height;
    const TuckIcon = dockedEdge ? edgeIcons[dockedEdge] : null;
    const place = (point: Point) => {
      const clamped = clampAssistantPosition(point, width, height, window.innerWidth, window.innerHeight);
      setPosition(clamped);
      setEdge(getAssistantSnapEdge(clamped, width, height, window.innerWidth, window.innerHeight));
    };
    const updatePointer = (point: Point, complete: boolean) => {
      const start = drag.current;
      if (!start) return;
      const dx = point.x - start.from.x, dy = point.y - start.from.y;
      if (start.moved || Math.hypot(dx, dy) >= 4) {
        start.moved = true;
        const raw = { x: start.origin.x + dx, y: start.origin.y + dy };
        const preview = getAssistantDragTuck(point, raw.y, height, window.innerWidth, window.innerHeight);
        if (complete && preview) {
          setPosition(raw);
          setEdge(preview.edge);
          setTucked(preview);
          requestAnimationFrame(() => edgeTabRef.current?.focus({ preventScroll: true }));
        } else if (complete) place(raw);
        else { setEdge(null); setPosition(raw); setDragPreview(preview); }
      }
      if (complete) { drag.current = null; setDragPreview(null); }
    };
    const cancelDrag = () => { drag.current = null; setDragPreview(null); };

    const windowDrag: AgentWindowDragProps | undefined = isMobile ? undefined : {
            "data-agent-window-drag": true,
            role: "group",
            "aria-label": "智能体窗口标题栏（按住拖动，方向键移动，Home 复位）",
            tabIndex: 0,
            onPointerDown: (event) => {
              if (event.button !== 0) return;
              if (event.target instanceof Element && event.target.closest("button,a,input,select,textarea,[role=button]")) return;
              const rect = overlayDrawerRef.current?.getBoundingClientRect();
              if (!rect) return;
              drag.current = { pointer: event.pointerId, from: { x: event.clientX, y: event.clientY },
                origin: { x: rect.left, y: rect.top }, moved: false };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            },
            onPointerMove: (event) => {
              if (drag.current?.pointer !== event.pointerId) return;
              updatePointer({ x: event.clientX, y: event.clientY }, false);
            },
            onLostPointerCapture: cancelDrag,
            onPointerUp: (event) => {
              if (drag.current?.pointer !== event.pointerId) return;
              updatePointer({ x: event.clientX, y: event.clientY }, true);
            },
            onPointerCancel: cancelDrag,
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Home") { event.preventDefault(); setPosition(null); setEdge(null); return; }
              const vectors: Record<string, Point> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } };
              const delta = vectors[event.key];
              const rect = overlayDrawerRef.current?.getBoundingClientRect();
              if (!delta || !rect) return;
              event.preventDefault();
              const next = { x: rect.left + delta.x, y: rect.top + delta.y };
              if (dockedEdge) { setEdge(null); setPosition(next); } else place(next);
            },
    };
    const windowControls = dockedEdge && TuckIcon && <button type="button" ref={tuckButtonRef} className="or-agent-icon or-assistant-tuck"
            aria-label={`隐藏到${edgeNames[dockedEdge]}`} title={`隐藏到${edgeNames[dockedEdge]}`}
            onClick={() => {
              setTucked({ edge: dockedEdge, along: dockedEdge === "left" || dockedEdge === "right" ? moved.y + 38 : moved.x + 38 });
              requestAnimationFrame(() => edgeTabRef.current?.focus());
            }}>
            <TuckIcon className="h-4 w-4" />
          </button>;
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
          style={{ ...overlayStyle, left: moved.x, top: moved.y, transform: displayedTuck ? edgeTransforms[displayedTuck.edge] : undefined }}
          onKeyDown={(event) => {
            if (!isMobile && event.key === "Escape" && !event.defaultPrevented) closeSidebar();
          }}
          className={cn(
            "or-assistant-drawer or-assistant-floating z-[40] flex min-w-0 max-w-full flex-col overflow-hidden border border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl md:rounded-xl",
            !sidebarOpen && "invisible pointer-events-none",
            tucked && !isMobile && "pointer-events-none",
          )}
          role="dialog"
          aria-label="源远教学平台 AI 助手"
          aria-modal={isMobile && sidebarOpen ? true : undefined}
          tabIndex={-1}
          aria-hidden={!sidebarOpen || (hidden && !dragPreview)}
        >
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
            {renderPanel(windowControls, windowDrag)}
          </div>
        </aside>
        {displayedTuck && <EdgeTab tuck={displayedTuck} preview={Boolean(dragPreview)} tabRef={edgeTabRef}
          onRestore={() => { setTucked(null); requestAnimationFrame(() => tuckButtonRef.current?.focus()); }} />}
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
        {renderPanel()}
      </aside>
    </>
  );
}
