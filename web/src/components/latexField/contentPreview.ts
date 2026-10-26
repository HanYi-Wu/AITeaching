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

export async function renderMermaidToElement(source: string, container: HTMLElement): Promise<void> {
  try {
    const mermaid = await initMermaid();
    const id = `lrt-mmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, source.trim());
    container.innerHTML = svg;
  } catch {
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

export function buildEditorDom(root: HTMLElement, value: string): void {
  root.innerHTML = "";
  const tokens = tokenize(value);
  for (const token of tokens) {
    if (token.type === "text") {
      const lines = token.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) root.appendChild(document.createElement("br"));
        if (lines[i]) root.appendChild(document.createTextNode(lines[i]));
      }
    } else if (token.type === "inlineMath") {
      root.appendChild(createMathWidget(token.latex));
    } else if (token.type === "displayMath") {
      root.appendChild(createDisplayMathWidget(token.latex));
    } else if (token.type === "mermaid") {
      root.appendChild(createMermaidWidget(token.source));
    } else if (token.type === "image") {
      root.appendChild(createImageWidget(token.kind, token.path));
    } else if (token.type === "table") {
      root.appendChild(createTableWidget(token.source));
    }
  }
  if (root.childNodes.length === 0) {
    root.appendChild(document.createTextNode(""));
  }
}

/* ═══════════════════ Serializer ═══════════════════ */

export function serializeEditor(root: HTMLElement): string {
  let out = "";
  function walk(n: Node): void {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? "";
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (el.classList.contains(MATH_WIDGET_CLASS)) {
      out += `$${el.dataset.latex ?? ""}$`;
      return;
    }
    if (el.classList.contains(DISPLAY_MATH_WIDGET_CLASS)) {
      out += `$$${el.dataset.latex ?? ""}$$`;
      return;
    }
    if (el.classList.contains(MERMAID_WIDGET_CLASS)) {
      const src = el.dataset.mermaidSource ?? "";
      out += "```mermaid\n" + src + "\n```";
      return;
    }
    if (el.classList.contains(IMAGE_WIDGET_CLASS)) {
      const kind = el.dataset.imageKind ?? "EMBED_IMG";
      const path = el.dataset.imagePath ?? "";
      out += `:::${kind}:${path}:::`;
      return;
    }
    if (el.classList.contains(TABLE_WIDGET_CLASS)) {
      out += "```solaire-table\n" + (el.dataset.tableSource ?? "") + "\n```";
      return;
    }
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    for (const c of el.childNodes) walk(c);
  }
  for (const c of root.childNodes) walk(c);
  return out;
}

/* ═══════════════════ Caret utilities ═══════════════════ */

export function widgetSerializedLength(el: HTMLElement): number {
  if (el.classList.contains(MATH_WIDGET_CLASS)) {
    return `$${el.dataset.latex ?? ""}$`.length;
  }
  if (el.classList.contains(DISPLAY_MATH_WIDGET_CLASS)) {
    return `$$${el.dataset.latex ?? ""}$$`.length;
  }
  if (el.classList.contains(MERMAID_WIDGET_CLASS)) {
    const src = el.dataset.mermaidSource ?? "";
    return ("```mermaid\n" + src + "\n```").length;
  }
  if (el.classList.contains(IMAGE_WIDGET_CLASS)) {
    const kind = el.dataset.imageKind ?? "EMBED_IMG";
    const path = el.dataset.imagePath ?? "";
    return `:::${kind}:${path}:::`.length;
  }
  if (el.classList.contains(TABLE_WIDGET_CLASS)) {
    return ("```solaire-table\n" + (el.dataset.tableSource ?? "") + "\n```").length;
  }
  return 0;
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

export function serializedLengthOfNode(n: Node | undefined | null): number {
  if (!n) return 0;
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").length;
  if (n.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = n as HTMLElement;
  if (isWidget(el)) return widgetSerializedLength(el);
  if (el.tagName === "BR") return 1;
  let len = 0;
  for (const c of el.childNodes) len += serializedLengthOfNode(c);
  return len;
}

export function getSerializedCaretOffset(root: HTMLElement, range: Range): number {
  if (range.startContainer === root) {
    let total = 0;
    for (let i = 0; i < range.startOffset; i++) {
      total += serializedLengthOfNode(root.childNodes[i] ?? undefined);
    }
    return total;
  }
  let total = 0;
  let done = false;
  function walk(n: Node): boolean {
    if (done) return true;
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? "";
      if (range.startContainer === n) {
        total += Math.min(range.startOffset, text.length);
        done = true;
        return true;
      }
      total += text.length;
      return false;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as HTMLElement;
    if (isWidget(el)) {
      const wLen = widgetSerializedLength(el);
      if (range.startContainer === el || el.contains(range.startContainer)) {
        if (range.startContainer === el && range.startOffset === 0) {
          /* before widget */
        } else {
          total += wLen;
        }
        done = true;
        return true;
      }
      total += wLen;
      return false;
    }
    if (el.tagName === "BR") {
      if (range.startContainer === el) {
        done = true;
        return true;
      }
      total += 1;
      return false;
    }
    for (const c of el.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of root.childNodes) if (walk(c)) break;
  return total;
}
