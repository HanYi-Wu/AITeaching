import type { AgentPageContextForApi } from "../../api/client";

const targets = {
  "bank-question": { current_page: "bank", selected_resource_type: "question", label: "题库题目" },
  "compose-draft": { current_page: "compose", selected_resource_type: "exam", label: "组卷草稿" },
  "paper-detail": { current_page: "compose", selected_resource_type: "paper", label: "试卷详情" },
} as const;

export type PageSelection = { label: string; context: AgentPageContextForApi };
export const PAGE_TEXT_LIMIT = 3600;
export const CONTROL_TEXT_LIMIT = 600;
export const keyboardPageTargets = "button, a[href], input, select, textarea, summary, label, h1, h2, h3, h4, p, td, th, img, canvas, [role], [tabindex], [data-agent-target]";
const semanticTarget = "button,a[href],input,select,textarea,summary,[role=button],[role=option],[role=tab],[role=checkbox],[role=menuitem]";
const privateSelector = ".or-assistant-drawer,.or-g55-agent-panel,.or-assistant-edge-tab,.or-assistant-backdrop,.sr-only,.katex-mathml,[data-agent-private],script,style,template,noscript,iframe,option,[hidden],[inert],[aria-hidden=true]";
const valueSelector = "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function getPageSelectionTarget(element: Element | null): Element | null {
  if (!element || element.closest(privateSelector) || element === document.documentElement || element === document.body) return null;
  return element.closest(semanticTarget) ?? element;
}

function geometryCache() {
  const cache = new WeakMap<Element, ReturnType<typeof bounds>>();
  function bounds(element: Element | null): { left: number; right: number; top: number; bottom: number } | null {
    if (!element) return { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    if (cache.has(element)) return cache.get(element) ?? null;
    const inherited = bounds(element.parentElement);
    const style = window.getComputedStyle(element);
    if (!inherited || element.matches(privateSelector) || style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" || style.opacity === "0" || style.contentVisibility === "hidden") {
      cache.set(element, null);
      return null;
    }
    const visible = { ...inherited };
    const clipX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if ((clipX || clipY) && element !== document.documentElement && element !== document.body) {
      const rect = element.getBoundingClientRect();
      if (clipX) { visible.left = Math.max(visible.left, rect.left); visible.right = Math.min(visible.right, rect.right); }
      if (clipY) { visible.top = Math.max(visible.top, rect.top); visible.bottom = Math.min(visible.bottom, rect.bottom); }
    }
    cache.set(element, visible);
    return visible;
  }
  return bounds;
}

export function readVisibleText(root: Element, limit: number): string {
  const view = geometryCache();
  const lines: string[] = [];
  let length = 0, visited = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && length < limit && visited < 3500; node = walker.nextNode()) {
    visited++;
    const parent = node.parentElement;
    if (!parent || parent.closest(valueSelector)) continue;
    const text = normalize(node.textContent ?? "");
    if (!text) continue;
    const clip = view(parent);
    if (!clip || !range.getClientRects) continue;
    range.selectNodeContents(node);
    if (!Array.from(range.getClientRects()).some((rect) =>
      Math.max(clip.left, rect.left) < Math.min(clip.right, rect.right) &&
      Math.max(clip.top, rect.top) < Math.min(clip.bottom, rect.bottom))) continue;
    const section = text.slice(0, limit - length);
    lines.push(section);
    length += section.length + 1;
  }
  return lines.join("\n");
}

export function readPageSelection(element: Element | null, activePage?: string | null): PageSelection | null {
  const target = getPageSelectionTarget(element);
  if (!target) return null;
  const page = target.closest("[role=dialog]") ?? document.querySelector("main.or-workspace-content") ?? document.querySelector("main") ?? document.body;
  const resource = target.closest<HTMLElement>("[data-agent-target]");
  const key = resource?.dataset.agentTarget ?? "";
  const id = resource?.dataset.agentResourceId;
  const marked = Object.prototype.hasOwnProperty.call(targets, key) && id && /^[\p{L}\p{N}_./:\-]{1,180}$/u.test(id)
    ? targets[key as keyof typeof targets] : null;
  const text = readVisibleText(target, CONTROL_TEXT_LIMIT);
  const labels = (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)
    ? Array.from(target.labels ?? []).map((item) => readVisibleText(item, 100)).join(" ") : "";
  const label = normalize(target.getAttribute("aria-label") || target.getAttribute("alt") || target.getAttribute("title") || labels || text || marked?.label || `<${target.localName}>`).slice(0, 100);
  return {
    label,
    context: {
      current_page: marked?.current_page ?? activePage ?? "workspace",
      ...(marked ? { selected_resource_type: marked.selected_resource_type, selected_resource_id: id } : {}),
      selected_control: {
        tag: target.localName.slice(0, 40),
        role: target.getAttribute("role")?.slice(0, 40) || undefined,
        label,
        text,
      },
      visible_page_text: readVisibleText(page, PAGE_TEXT_LIMIT),
    },
  };
}
