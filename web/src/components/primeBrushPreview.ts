import yaml from "js-yaml";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_ANIMATED_ELEMENTS = 128;
const MAX_ANIMATED_BARS = 32;

export type PrimeBrushPreviewConfig =
  | { motion: "plot" | "geometry" }
  | {
      motion: "bar";
      chartBarCount: number;
      barWidthFraction: number;
    };

type BarPreviewConfig = Extract<PrimeBrushPreviewConfig, { motion: "bar" }>;

const PREVIEW_MOTION_STYLES = `
.pb-preview-draw {
  animation: pbPreviewDraw 1050ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes pbPreviewDraw {
  to { stroke-dashoffset: 0; }
}
.pb-preview-dash {
  animation: pbPreviewDash 850ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
}
@keyframes pbPreviewDash {
  from { opacity: 0; stroke-dashoffset: 1; }
  to { opacity: 1; stroke-dashoffset: 0; }
}
.pb-preview-point {
  transform-box: fill-box;
  transform-origin: center;
  animation: pbPreviewPoint 500ms cubic-bezier(0.175, 0.885, 0.32, 1.275) 350ms both;
}
@keyframes pbPreviewPoint {
  from { opacity: 0; transform: scale(0); }
  to { opacity: 1; transform: scale(1); }
}
.pb-preview-projection {
  animation: pbPreviewProjection 400ms ease-out 220ms both;
}
@keyframes pbPreviewProjection {
  from { opacity: 0; }
  to { opacity: 1; }
}
.pb-preview-bar {
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: pbPreviewBarRise 680ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes pbPreviewBarRise {
  0% { opacity: 0.4; transform: scaleY(0.015); }
  82% { opacity: 1; transform: scaleY(1.025); }
  100% { opacity: 1; transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .pb-preview-draw,
  .pb-preview-dash,
  .pb-preview-point,
  .pb-preview-projection,
  .pb-preview-bar {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
    stroke-dashoffset: 0 !important;
  }
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getPrimeBrushPreviewConfig(source: string): PrimeBrushPreviewConfig | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.primebrush)) {
    return null;
  }

  const primebrush = parsed.primebrush;
  const type = typeof primebrush.type === "string" ? primebrush.type.toLowerCase() : "";
  if (type === "plot_2d") {
    return { motion: "plot" };
  }
  if (type === "geometry_2d") {
    return { motion: "geometry" };
  }
  if (type !== "chart") {
    return null;
  }

  const rawKind = primebrush.kind;
  const kind = rawKind == null || rawKind === "" ? "bar" : typeof rawKind === "string" ? rawKind.toLowerCase() : "";
  if (kind !== "bar") {
    return null;
  }

  const data = primebrush.data;
  const chartBarCount = Array.isArray(data) ? data.length : 0;
  const options = isRecord(primebrush.options) ? primebrush.options : {};
  const barWidthFraction = options.bar_width == null ? 0.6 : Number(options.bar_width);
  if (!Number.isFinite(barWidthFraction) || barWidthFraction <= 0 || barWidthFraction > 1) {
    return null;
  }
  return { motion: "bar", chartBarCount, barWidthFraction };
}

function addClass(element: Element, className: string): void {
  const classes = new Set((element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
  classes.add(className);
  element.setAttribute("class", Array.from(classes).join(" "));
}

function getSvgElements(root: Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(SVG_NAMESPACE, localName));
}

function isFiniteAttribute(element: Element, name: string): number | null {
  const rawValue = element.getAttribute(name);
  if (rawValue === null || rawValue.trim() === "") {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function coordinateKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function decoratePlot(root: Element, animate: boolean): boolean {
  const paths = getSvgElements(root, "path").filter((path) =>
    path.getAttribute("d") &&
    path.getAttribute("stroke") &&
    (path.getAttribute("fill") ?? "none") === "none",
  );
  if (paths.length === 0) {
    return false;
  }
  const circles = getSvgElements(root, "circle");
  const lines = getSvgElements(root, "line");
  if (paths.length + circles.length + lines.length > MAX_ANIMATED_ELEMENTS) {
    return false;
  }

  if (animate) {
    for (const path of paths) {
      if (path.hasAttribute("stroke-dasharray")) {
        addClass(path, "pb-preview-dash");
        continue;
      }
      path.setAttribute("pathLength", "1");
      path.setAttribute("stroke-dasharray", "1");
      path.setAttribute("stroke-dashoffset", "1");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      addClass(path, "pb-preview-draw");
    }

    const projectionLinesByPoint = new Map<string, Element[]>();
    const addProjection = (x: number, y: number, line: Element) => {
      const key = coordinateKey(x, y);
      const matching = projectionLinesByPoint.get(key);
      if (matching) {
        matching.push(line);
      } else {
        projectionLinesByPoint.set(key, [line]);
      }
    };
    for (const line of lines) {
      if (!line.hasAttribute("stroke-dasharray")) {
        continue;
      }
      const x1 = isFiniteAttribute(line, "x1");
      const y1 = isFiniteAttribute(line, "y1");
      const x2 = isFiniteAttribute(line, "x2");
      const y2 = isFiniteAttribute(line, "y2");
      if (x1 !== null && y1 !== null) addProjection(x1, y1, line);
      if (x2 !== null && y2 !== null) addProjection(x2, y2, line);
    }

    for (const circle of circles) {
      const cx = isFiniteAttribute(circle, "cx");
      const cy = isFiniteAttribute(circle, "cy");
      if (cx === null || cy === null) {
        continue;
      }
      addClass(circle, "pb-preview-point");
      for (const line of projectionLinesByPoint.get(coordinateKey(cx, cy)) ?? []) {
        addClass(line, "pb-preview-projection");
      }
    }
  }

  return true;
}

function decorateGeometry(root: Element, animate: boolean): boolean {
  const lines = getSvgElements(root, "line");
  const circles = getSvgElements(root, "circle");
  const ellipses = getSvgElements(root, "ellipse");
  if (lines.length + circles.length + ellipses.length === 0) {
    return false;
  }
  if (lines.length + circles.length + ellipses.length > MAX_ANIMATED_ELEMENTS) {
    return false;
  }
  if (!animate) {
    return true;
  }

  for (const line of lines) {
    if (line.hasAttribute("stroke-dasharray")) {
      addClass(line, "pb-preview-dash");
      continue;
    }
    line.setAttribute("pathLength", "1");
    line.setAttribute("stroke-dasharray", "1");
    line.setAttribute("stroke-dashoffset", "1");
    addClass(line, "pb-preview-draw");
  }

  for (const shape of [...circles, ...ellipses]) {
    if (shape.hasAttribute("stroke")) {
      shape.setAttribute("pathLength", "1");
      shape.setAttribute("stroke-dasharray", "1");
      shape.setAttribute("stroke-dashoffset", "1");
      addClass(shape, "pb-preview-draw");
    } else {
      addClass(shape, "pb-preview-point");
    }
  }

  return true;
}

function isSolidColor(value: string): boolean {
  return /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]{1,20})$/i.test(value.trim());
}

function addGradient(defs: Element, id: string, color: string, document: Document): void {
  const gradient = document.createElementNS(SVG_NAMESPACE, "linearGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y2", "1");

  const stops = [
    { offset: "0", color: "#ffffff", opacity: "0.78" },
    { offset: "0.012", color, opacity: "0.68" },
    { offset: "1", color, opacity: "0.045" },
  ];
  for (const stop of stops) {
    const element = document.createElementNS(SVG_NAMESPACE, "stop");
    element.setAttribute("offset", stop.offset);
    element.setAttribute("stop-color", stop.color);
    element.setAttribute("stop-opacity", stop.opacity);
    gradient.appendChild(element);
  }
  defs.appendChild(gradient);
}

function readViewBox(root: Element): { width: number; height: number } | null {
  const values = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[0] !== 0 ||
    values[1] !== 0 ||
    values[2] <= 0 ||
    values[3] <= 0
  ) {
    return null;
  }
  return { width: values[2], height: values[3] };
}

function selectChartBars(root: Element, config: BarPreviewConfig): Element[] {
  const { chartBarCount, barWidthFraction } = config;
  const viewBox = readViewBox(root);
  const plotWidth = (viewBox?.width ?? 0) - 72;
  if (
    !viewBox ||
    chartBarCount <= 0 ||
    chartBarCount > MAX_ANIMATED_BARS ||
    plotWidth <= 0
  ) {
    return [];
  }

  const baselineY = viewBox.height - 52;
  const gap = plotWidth / chartBarCount;
  const barWidth = gap * barWidthFraction;
  const rects = getSvgElements(root, "rect");
  const used = new Set<Element>();
  const bars: Element[] = [];

  for (let index = 0; index < chartBarCount; index += 1) {
    const expectedX = 52 + gap * index + (gap - barWidth) / 2;
    const bar = rects.find((rect) => {
      const x = isFiniteAttribute(rect, "x");
      const y = isFiniteAttribute(rect, "y");
      const width = isFiniteAttribute(rect, "width");
      const height = isFiniteAttribute(rect, "height");
      return !used.has(rect) &&
        rect.hasAttribute("fill") &&
        (rect.getAttribute("fill") ?? "").trim().toLowerCase() !== "none" &&
        x !== null && Math.abs(x - expectedX) <= 0.03 &&
        y !== null &&
        width !== null && Math.abs(width - barWidth) <= 0.03 &&
        height !== null && height > 0 &&
        Math.abs(y + height - baselineY) <= 0.03;
    });
    if (!bar) {
      return [];
    }
    used.add(bar);
    bars.push(bar);
  }
  return bars;
}

function uniqueGradientId(index: number, existingIds: Set<string>): string {
  const base = `pb-preview-bar-gradient-${index}`;
  let id = base;
  let suffix = 1;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  existingIds.add(id);
  return id;
}

function decorateBars(root: Element, animate: boolean, document: Document, config: BarPreviewConfig): boolean {
  const bars = selectChartBars(root, config);
  if (bars.length === 0) {
    return false;
  }

  let defs = getSvgElements(root, "defs")[0];
  if (!defs) {
    defs = document.createElementNS(SVG_NAMESPACE, "defs");
    root.insertBefore(defs, root.firstChild);
  }

  const existingIds = new Set(
    Array.from(root.getElementsByTagName("*"))
      .map((element) => element.getAttribute("id"))
      .filter((id): id is string => id !== null),
  );
  bars.forEach((bar, index) => {
    const fill = (bar.getAttribute("fill") ?? "").trim();
    if (fill && fill.toLowerCase() !== "none" && isSolidColor(fill)) {
      const id = uniqueGradientId(index, existingIds);
      addGradient(defs!, id, fill, document);
      bar.setAttribute("fill", `url(#${id})`);
    }

    if (animate) {
      addClass(bar, "pb-preview-bar");
      const existingStyle = bar.getAttribute("style")?.trim();
      const delay = `animation-delay:${Math.min(index * 80, 400)}ms`;
      bar.setAttribute("style", existingStyle ? `${existingStyle.replace(/;?$/, ";")}${delay};` : delay);
    }
  });

  return true;
}

/**
 * Adds preview-only SVG decoration to renderer output. The SVG stays an image
 * Blob in the editor, so the render result is never mounted as active HTML.
 */
export function decoratePrimeBrushPreviewSvg(
  svg: string,
  config: PrimeBrushPreviewConfig | null,
  reducedMotion: boolean,
): string {
  if (!config) {
    return svg;
  }

  try {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parsed.documentElement;
    if (
      root.localName !== "svg" ||
      root.namespaceURI !== SVG_NAMESPACE ||
      parsed.getElementsByTagName("parsererror").length > 0
    ) {
      return svg;
    }

    const animate = !reducedMotion;
    const decorated = config.motion === "plot"
      ? decoratePlot(root, animate)
      : config.motion === "bar"
        ? decorateBars(root, animate, parsed, config)
        : decorateGeometry(root, animate);
    if (!decorated) {
      return svg;
    }

    if (animate) {
      const style = parsed.createElementNS(SVG_NAMESPACE, "style");
      style.textContent = PREVIEW_MOTION_STYLES;
      root.insertBefore(style, root.firstChild);
    }
    return new XMLSerializer().serializeToString(parsed);
  } catch {
    return svg;
  }
}
