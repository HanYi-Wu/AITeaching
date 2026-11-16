import { resourceApiUrl } from "../../api/client";
import { tokenizeContent, type ContentToken } from "../../lib/contentTokenizer";
import { renderMathToHtmlSimple } from "../../lib/katexRender";
import { initMermaid } from "../../lib/mermaidInit";
import {
  expandSolaireTable,
  parseSolaireTable,
  type SolaireTableCell,
} from "../../lib/solaireTable";

/* ═══════════════════ constants ═══════════════════ */

export const MATH_WIDGET_CLASS = "lrt-math-widget";
export const DISPLAY_MATH_WIDGET_CLASS = "lrt-display-math-widget";
export const MERMAID_WIDGET_CLASS = "lrt-mermaid-widget";
export const IMAGE_WIDGET_CLASS = "lrt-image-widget";
export const TABLE_WIDGET_CLASS = "lrt-table-widget";

/* ═══════════════════ utility functions ═══════════════════ */

export function renderMathHtml(latex: string, displayMode = false): string {
  return renderMathToHtmlSimple(latex, displayMode);
}

export async function renderMermaidToElement(
  source: string,
  container: HTMLElement,
  expectedSeq?: number | string
): Promise<void> {
  const currentSeq = expectedSeq !== undefined ? String(expectedSeq) : undefined;
  if (currentSeq !== undefined) {
    container.dataset.renderSeq = currentSeq;
  }
  try {
    const mermaid = await initMermaid();
    const id = `lrt-mmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, source.trim());
    if (currentSeq !== undefined && container.dataset.renderSeq !== currentSeq) {
      return;
    }
    container.innerHTML = svg;
    container.classList.remove("text-amber-600");
  } catch {
    if (currentSeq !== undefined && container.dataset.renderSeq !== currentSeq) {
      return;
    }
    container.textContent = "图表语法有误";
    container.classList.add("text-amber-600");
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTableCellHtml(text: string): string {
  return tokenizeContent(text)
    .map((token) => {
      if (token.type === "text") return escapeHtml(token.content).replace(/\n/g, "<br/>");
      if (token.type === "inlineMath") return renderMathHtml(token.latex, false);
      if (token.type === "displayMath") return renderMathHtml(token.latex, true);
      return "raw" in token ? escapeHtml(token.raw) : "";
    })
    .join("");
}

export function tableCellAlignClass(cell: SolaireTableCell): string {
  if (cell.align === "center") return "text-center";
  if (cell.align === "right") return "text-right";
  return "text-left";
}

/* ═══════════════════ Tokenizer alias ═══════════════════ */

export type Token = ContentToken;

export function tokenize(value: string): Token[] {
  return tokenizeContent(value);
}

/* ═══════════════════ DOM builders ═══════════════════ */

export function createMathWidget(latex: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${MATH_WIDGET_CLASS} mx-0.5 inline-flex max-w-full cursor-pointer items-baseline align-baseline rounded border border-transparent bg-blue-50/80 px-1 py-px transition-colors hover:border-blue-300 hover:bg-blue-100`;
  span.contentEditable = "false";
  span.tabIndex = -1;
  span.dataset.latex = latex;
  span.setAttribute("role", "button");
  span.title = "点击编辑公式";
  span.innerHTML = renderMathHtml(latex, false);
  return span;
}

export function createDisplayMathWidget(latex: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `${DISPLAY_MATH_WIDGET_CLASS} my-1.5 w-full cursor-pointer rounded border border-transparent bg-blue-50/60 px-2 py-1 text-center transition-colors hover:border-blue-300 hover:bg-blue-100`;
  div.contentEditable = "false";
  div.tabIndex = -1;
  div.dataset.latex = latex;
  div.dataset.displayMath = "true";
  div.setAttribute("role", "button");
  div.title = "点击编辑公式（显示模式）";
  div.innerHTML = renderMathHtml(latex, true);
  return div;
}

export function createMermaidWidget(source: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `${MERMAID_WIDGET_CLASS} my-1.5 block w-full cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 transition-colors hover:border-emerald-300 hover:bg-emerald-50`;
  div.contentEditable = "false";
  div.tabIndex = -1;
  div.dataset.mermaidSource = source;
  div.setAttribute("role", "button");
  div.title = "点击编辑图表";

  const header = document.createElement("div");
  header.className = "flex items-center gap-1.5 text-[11px] text-emerald-700";
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span class="font-medium">Mermaid 图表</span><span class="text-emerald-500 text-[10px]">点击编辑</span>`;
  div.appendChild(header);

  const preview = document.createElement("div");
  preview.className = "mt-1.5 max-h-48 overflow-auto rounded bg-white/80 p-1 text-[10px] text-slate-400";
  preview.textContent = "渲染中…";
  div.appendChild(preview);
  void renderMermaidToElement(source, preview);

  return div;
}

export function createImageWidget(kind: string, path: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${IMAGE_WIDGET_CLASS} my-1 inline-block max-w-full cursor-pointer rounded-lg border border-violet-200 bg-violet-50/50 p-1.5 align-top transition-colors hover:border-violet-300 hover:bg-violet-50`;
  span.contentEditable = "false";
  span.tabIndex = -1;
  span.dataset.imageKind = kind;
  span.dataset.imagePath = path;
  span.setAttribute("role", "button");
  span.title = "点击查看图片";

  const img = document.createElement("img");
  img.src = resourceApiUrl(path.trim());
  img.alt = "";
  img.className = "max-h-40 max-w-full rounded object-contain";
  img.onerror = () => {
    img.style.display = "none";
    const fallback = document.createElement("span");
    fallback.className = "text-xs text-violet-500";
    fallback.textContent = `图片: ${path.trim()}`;
    span.appendChild(fallback);
  };
  span.appendChild(img);

  const label = document.createElement("div");
  label.className = "mt-1 text-[10px] text-violet-500 truncate";
  label.textContent = path.trim().split("/").pop() ?? "图片";
  span.appendChild(label);

  return span;
}

export function createTableWidget(source: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `${TABLE_WIDGET_CLASS} my-1.5 block w-full cursor-pointer rounded border border-cyan-200 bg-cyan-50/40 p-2 transition-colors hover:border-cyan-300 hover:bg-cyan-50`;
  div.contentEditable = "false";
  div.tabIndex = -1;
  div.dataset.tableSource = source;
  div.setAttribute("role", "button");
  div.title = "点击编辑表格";

  const header = document.createElement("div");
  header.className = "mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-cyan-800";
  header.textContent = "表格 · 点击编辑";
  div.appendChild(header);

  const body = document.createElement("div");
  body.className = "max-h-56 overflow-auto rounded bg-white/90";
  try {
    const expanded = expandSolaireTable(parseSolaireTable(source));
    const table = document.createElement("table");
    table.className = "w-full border-collapse text-xs text-slate-800";
    const tbody = document.createElement("tbody");
    expanded.slots.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.forEach((slot, c) => {
        if (slot.covered) return;
        const cell = document.createElement(slot.cell.header ? "th" : "td");
        cell.rowSpan = slot.cell.rowSpan ?? 1;
        cell.colSpan = slot.cell.colSpan ?? 1;
        cell.className = `border border-slate-300 px-2 py-1 align-top ${tableCellAlignClass(slot.cell)} ${
          slot.cell.header ? "bg-slate-100 font-semibold" : "bg-white"
        }`;
        cell.innerHTML = renderTableCellHtml(slot.cell.text);
        cell.dataset.tableCell = `${r}:${c}`;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  } catch (e) {
    const pre = document.createElement("pre");
    pre.className = "whitespace-pre-wrap p-2 text-xs text-red-700";
    pre.textContent = e instanceof Error ? e.message : String(e);
    body.appendChild(pre);
  }
  div.appendChild(body);
  return div;
}

/* ═══════════════════ buildEditorDom ═══════════════════ */

type EditorNodeSpec =
  | { type: "textNode"; content: string }
  | { type: "lineBreak" }
  | Exclude<Token, { type: "text" }>;

function editorNodeSpecs(value: string): EditorNodeSpec[] {
  const specs: EditorNodeSpec[] = [];
  for (const token of tokenize(value)) {
    if (token.type !== "text") {
      specs.push(token);
      continue;
    }
    const lines = token.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) specs.push({ type: "lineBreak" });
      if (lines[i]) specs.push({ type: "textNode", content: lines[i] });
    }
  }
  if (specs.length === 0) specs.push({ type: "textNode", content: "" });
  return specs;
}

function createEditorNode(spec: EditorNodeSpec): Node {
  switch (spec.type) {
    case "textNode": return document.createTextNode(spec.content);
    case "lineBreak": return document.createElement("br");
    case "inlineMath": return createMathWidget(spec.latex);
    case "displayMath": return createDisplayMathWidget(spec.latex);
    case "mermaid": return createMermaidWidget(spec.source);
    case "image": return createImageWidget(spec.kind, spec.path);
    case "table": return createTableWidget(spec.source);
  }
}

function editorNodeMatches(node: Node, spec: EditorNodeSpec): boolean {
  if (spec.type === "textNode") {
    return node.nodeType === Node.TEXT_NODE && node.textContent === spec.content;
  }
  if (!(node instanceof HTMLElement)) return false;
  if (spec.type === "lineBreak") return node.tagName === "BR" && !isWidget(node);
  // Match in serialization order, so a node with multiple widget classes cannot
  // be mistaken for a different kind of widget.
  if (node.classList.contains(MATH_WIDGET_CLASS)) {
    return spec.type === "inlineMath" && node.dataset.latex === spec.latex;
  }
  if (node.classList.contains(DISPLAY_MATH_WIDGET_CLASS)) {
    return spec.type === "displayMath" && node.dataset.latex === spec.latex;
  }
  if (node.classList.contains(MERMAID_WIDGET_CLASS)) {
    return spec.type === "mermaid" && node.dataset.mermaidSource === spec.source;
  }
  if (node.classList.contains(IMAGE_WIDGET_CLASS)) {
    return spec.type === "image" && node.dataset.imageKind === spec.kind && node.dataset.imagePath === spec.path;
  }
  if (node.classList.contains(TABLE_WIDGET_CLASS)) {
    return spec.type === "table" && node.dataset.tableSource === spec.source;
  }
  return false;
}

export function buildEditorDom(root: HTMLElement, value: string, reuse = true): void {
  const specs = editorNodeSpecs(value);
  const oldNodes = Array.from(root.childNodes);
  let prefix = 0;
  let oldEnd = oldNodes.length;
  let newEnd = specs.length;
  if (reuse) {
    while (prefix < oldEnd && prefix < newEnd && editorNodeMatches(oldNodes[prefix], specs[prefix])) prefix++;
    while (oldEnd > prefix && newEnd > prefix && editorNodeMatches(oldNodes[oldEnd - 1], specs[newEnd - 1])) {
      oldEnd--;
      newEnd--;
    }
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const oldNode = i < prefix ? oldNodes[i] : i >= newEnd ? oldNodes[oldEnd + i - newEnd] : undefined;
    // Editable nodes must be replaced so native undo cannot reach a previous
    // question. Resources and asynchronous diagrams also need fresh nodes.
    if (oldNode && (spec.type === "inlineMath" || spec.type === "displayMath" || spec.type === "table")) {
      fragment.appendChild(oldNode);
    } else {
      fragment.appendChild(createEditorNode(spec));
    }
  }
  root.replaceChildren(fragment);
}

/* ═══════════════════ Serializer ═══════════════════ */

export type SerializedSelectionOffsets = { start: number; end: number };

function serializedWidgetMarkup(el: HTMLElement): string | null {
  if (el.classList.contains(MATH_WIDGET_CLASS)) {
    return `$${el.dataset.latex ?? ""}$`;
  }
  if (el.classList.contains(DISPLAY_MATH_WIDGET_CLASS)) {
    return `$$${el.dataset.latex ?? ""}$$`;
  }
  if (el.classList.contains(MERMAID_WIDGET_CLASS)) {
    return "```mermaid\n" + (el.dataset.mermaidSource ?? "") + "\n```";
  }
  if (el.classList.contains(IMAGE_WIDGET_CLASS)) {
    return `:::${el.dataset.imageKind ?? "EMBED_IMG"}:${el.dataset.imagePath ?? ""}:::`;
  }
  if (el.classList.contains(TABLE_WIDGET_CLASS)) {
    return "```solaire-table\n" + (el.dataset.tableSource ?? "") + "\n```";
  }
  return null;
}

type ProjectionEndpoint = {
  container: Node;
  offset: number;
  value: number | null;
};

type ProjectionWalk = {
  length: number;
  start: ProjectionEndpoint | null;
  end: ProjectionEndpoint | null;
};

function recordRootBoundary(endpoint: ProjectionEndpoint | null, root: HTMLElement, offset: number, length: number) {
  if (endpoint?.container === root && endpoint.offset === offset && endpoint.value === null) {
    endpoint.value = length;
  }
}

function recordTextEndpoint(endpoint: ProjectionEndpoint | null, node: Node, length: number, textLength: number) {
  if (endpoint?.container === node && endpoint.value === null) {
    endpoint.value = length + Math.min(endpoint.offset, textLength);
  }
}

function recordElementEndpoint(endpoint: ProjectionEndpoint | null, element: HTMLElement, length: number) {
  if (endpoint?.container === element && endpoint.value === null) {
    endpoint.value = length;
  }
}

function recordWidgetEndpoint(endpoint: ProjectionEndpoint | null, element: HTMLElement, length: number, markupLength: number) {
  if (!endpoint || endpoint.value !== null) return;
  if (endpoint.container === element) {
    endpoint.value = length + (endpoint.offset === 0 ? 0 : markupLength);
  } else if (element.contains(endpoint.container)) {
    endpoint.value = length + markupLength;
  }
}

function projectionEndpointsKnown(walk: ProjectionWalk): boolean {
  return (
    walk.start !== null &&
    walk.start.value !== null &&
    (walk.end === null || walk.end.value !== null)
  );
}

function walkSerializedNode(node: Node, walk: ProjectionWalk): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (walk.start) {
      recordTextEndpoint(walk.start, node, walk.length, text.length);
      recordTextEndpoint(walk.end, node, walk.length, text.length);
    }
    walk.length += text.length;
    return projectionEndpointsKnown(walk);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return false;

  const element = node as HTMLElement;
  const widgetMarkup = serializedWidgetMarkup(element);
  if (widgetMarkup !== null) {
    if (walk.start) {
      recordWidgetEndpoint(walk.start, element, walk.length, widgetMarkup.length);
      recordWidgetEndpoint(walk.end, element, walk.length, widgetMarkup.length);
    }
    walk.length += widgetMarkup.length;
    return projectionEndpointsKnown(walk);
  }
  if (element.tagName === "BR") {
    if (walk.start) {
      recordElementEndpoint(walk.start, element, walk.length);
      recordElementEndpoint(walk.end, element, walk.length);
    }
    walk.length += 1;
    return projectionEndpointsKnown(walk);
  }
  for (const child of element.childNodes) {
    if (walkSerializedNode(child, walk)) return true;
  }
  return false;
}

function projectSelection(
  root: HTMLElement,
  range: Range,
  includeEnd = true,
): SerializedSelectionOffsets {
  const start: ProjectionEndpoint = {
    container: range.startContainer,
    offset: range.startOffset,
    value: null,
  };
  const end: ProjectionEndpoint | null = includeEnd && !range.collapsed
    ? { container: range.endContainer, offset: range.endOffset, value: null }
    : null;
  const walk: ProjectionWalk = {
    length: 0,
    start,
    end,
  };

  let stopped = false;
  for (let index = 0; index < root.childNodes.length; index++) {
    recordRootBoundary(start, root, index, walk.length);
    recordRootBoundary(end, root, index, walk.length);
    if (projectionEndpointsKnown(walk)) {
      stopped = true;
      break;
    }
    if (walkSerializedNode(root.childNodes[index]!, walk)) {
      stopped = true;
      break;
    }
  }
  if (!stopped) {
    recordRootBoundary(start, root, root.childNodes.length, walk.length);
    recordRootBoundary(end, root, root.childNodes.length, walk.length);
  }

  const startOffset = start.value ?? walk.length;
  return {
    start: startOffset,
    end: end ? end.value ?? walk.length : startOffset,
  };
}

export function serializeEditor(root: HTMLElement): string {
  let value = "";
  function appendNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const widgetMarkup = serializedWidgetMarkup(element);
    if (widgetMarkup !== null) {
      value += widgetMarkup;
    } else if (element.tagName === "BR") {
      value += "\n";
    } else {
      for (const child of element.childNodes) appendNode(child);
    }
  }
  for (const child of root.childNodes) appendNode(child);
  return value;
}

/* ═══════════════════ Caret utilities ═══════════════════ */

export function widgetSerializedLength(el: HTMLElement): number {
  return serializedWidgetMarkup(el)?.length ?? 0;
}

export function isWidget(el: HTMLElement): boolean {
  return (
    el.classList.contains(MATH_WIDGET_CLASS) ||
    el.classList.contains(DISPLAY_MATH_WIDGET_CLASS) ||
    el.classList.contains(MERMAID_WIDGET_CLASS) ||
    el.classList.contains(IMAGE_WIDGET_CLASS) ||
    el.classList.contains(TABLE_WIDGET_CLASS)
  );
}

/**
 * Identifies a collapsed DOM caret at the structural end of the editor.
 * The check walks only the caret's ancestor chain; callers can use the already
 * serialized text length for this exact case and retain the full offset walk
 * for selections before trailing nodes or inside widgets.
 */
export function isCollapsedCaretAtEditorEnd(root: HTMLElement, range: Range): boolean {
  if (!range.collapsed) return false;

  let current = range.startContainer;
  if (current !== root && !root.contains(current)) return false;
  if (
    current !== root &&
    current instanceof HTMLElement &&
    (current.tagName === "BR" || isWidget(current))
  ) return false;
  if (current.nodeType === Node.TEXT_NODE) {
    if (range.startOffset !== (current.textContent ?? "").length) return false;
  } else if (current.nodeType === Node.ELEMENT_NODE) {
    if (range.startOffset !== current.childNodes.length) return false;
  } else {
    return false;
  }

  while (current !== root) {
    const parent = current.parentNode;
    if (!(parent instanceof HTMLElement) || isWidget(parent) || parent.lastChild !== current) return false;
    current = parent;
  }
  return true;
}

export function serializedLengthOfNode(n: Node | undefined | null): number {
  if (!n) return 0;
  const walk: ProjectionWalk = {
    length: 0,
    start: null,
    end: null,
  };
  walkSerializedNode(n, walk);
  return walk.length;
}

export function getSerializedSelectionOffsets(
  root: HTMLElement,
  range: Range,
): SerializedSelectionOffsets {
  return projectSelection(root, range);
}

export function getSerializedCaretOffset(root: HTMLElement, range: Range): number {
  return projectSelection(root, range, false).start;
}
