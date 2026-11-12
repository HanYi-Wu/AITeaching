import { describe, expect, it } from "vitest";

import {
  decoratePrimeBrushPreviewSvg,
  getPrimeBrushPreviewConfig,
} from "./primeBrushPreview";

const SVG_NS = "http://www.w3.org/2000/svg";

function parseSvg(source: string): Document {
  return new DOMParser().parseFromString(source, "image/svg+xml");
}

describe("PrimeBrush preview decoration", () => {
  it("reads block and inline-flow YAML using the same supported fields as the renderer", () => {
    expect(getPrimeBrushPreviewConfig(`primebrush: { type: chart, data: [{ label: A, value: 5 }, { label: B, value: 8 }] }`)).toEqual({
      motion: "bar",
      chartBarCount: 2,
      barWidthFraction: 0.6,
    });
    expect(getPrimeBrushPreviewConfig(`primebrush:\n  type: chart\n  kind: bar\n  data: []\n  options: { bar_width: 0.75 }`)).toEqual({
      motion: "bar",
      chartBarCount: 0,
      barWidthFraction: 0.75,
    });
    expect(getPrimeBrushPreviewConfig(`primebrush:\n  type: plot_2D\n  elements: []`)).toMatchObject({ motion: "plot" });
  });

  it("leaves invalid YAML and unsupported chart types on the normal preview path", () => {
    expect(getPrimeBrushPreviewConfig("primebrush: [")).toBeNull();
    expect(getPrimeBrushPreviewConfig("primebrush:\n  type: chart\n  kind: line")).toBeNull();
    const originalSvg = `<svg xmlns="${SVG_NS}" viewBox="0 0 20 20"><text>unchanged</text></svg>`;
    expect(decoratePrimeBrushPreviewSvg(originalSvg, null, false)).toBe(originalSvg);
  });

  it("animates only renderer-shaped data bars and leaves a filled chart background untouched", () => {
    const source = `primebrush:
  type: chart
  canvas: { width: 420, height: 280, unit: px }
  data:
    - { label: A, value: 85 }
    - { label: B, value: 92 }
    - { label: C, value: 78 }
  options: { bar_width: 0.6 }`;
    const config = getPrimeBrushPreviewConfig(source);
    expect(config).not.toBeNull();

    const originalSvg = `<svg xmlns="${SVG_NS}" width="420.00" height="280.00" viewBox="0 0 420.00 280.00">
      <rect x="0" y="0" width="420" height="280" fill="#ffffff"/>
      <rect x="75.20" y="58.00" width="69.60" height="170.00" fill="#333" stroke="#111" stroke-width="0.5"/>
      <rect x="191.20" y="44.00" width="69.60" height="184.00" fill="#666" stroke="#111" stroke-width="0.5"/>
      <rect x="307.20" y="72.00" width="69.60" height="156.00" fill="#999" stroke="#111" stroke-width="0.5"/>
    </svg>`;
    const decorated = decoratePrimeBrushPreviewSvg(originalSvg, config, false);
    const document = parseSvg(decorated);
    const rects = Array.from(document.getElementsByTagNameNS(SVG_NS, "rect"));
    const background = rects[0];
    const bars = rects.slice(1);

    expect(background.getAttribute("fill")).toBe("#ffffff");
    expect(background.hasAttribute("class")).toBe(false);
    expect(bars.every((bar) => bar.getAttribute("class")?.includes("pb-preview-bar"))).toBe(true);
    expect(bars.map((bar) => bar.getAttribute("fill"))).toEqual([
      "url(#pb-preview-bar-gradient-0)",
      "url(#pb-preview-bar-gradient-1)",
      "url(#pb-preview-bar-gradient-2)",
    ]);

    const gradients = Array.from(document.getElementsByTagNameNS(SVG_NS, "linearGradient"));
    expect(gradients).toHaveLength(3);
    expect(gradients.map((gradient) => gradient.getElementsByTagNameNS(SVG_NS, "stop")[0].getAttribute("stop-color"))).toEqual([
      "#ffffff",
      "#ffffff",
      "#ffffff",
    ]);
    expect(gradients.map((gradient) => gradient.getElementsByTagNameNS(SVG_NS, "stop")[1].getAttribute("stop-color"))).toEqual([
      "#333",
      "#666",
      "#999",
    ]);
    expect(gradients.map((gradient) => gradient.getElementsByTagNameNS(SVG_NS, "stop")[2].getAttribute("stop-opacity"))).toEqual([
      "0.045",
      "0.045",
      "0.045",
    ]);

    const reducedMotionDocument = parseSvg(decoratePrimeBrushPreviewSvg(originalSvg, config, true));
    const reducedMotionBars = Array.from(reducedMotionDocument.getElementsByTagNameNS(SVG_NS, "rect")).slice(1);
    expect(reducedMotionBars.every((bar) => !bar.hasAttribute("class") && !bar.hasAttribute("style"))).toBe(true);
    expect(reducedMotionDocument.getElementsByTagNameNS(SVG_NS, "style")).toHaveLength(0);
  });

  it("preserves plotted colors while revealing curves, points, and their dashed projections", () => {
    const config = getPrimeBrushPreviewConfig("primebrush:\n  type: plot_2d\n  elements: []");
    const originalSvg = `<svg xmlns="${SVG_NS}" viewBox="0 0 40 40">
      <path d="M 1,2 L 3,4" fill="none" stroke="#1a5fb4" stroke-width="2"/>
      <path d="M 1,3 L 3,5" fill="none" stroke="#c01c28" stroke-dasharray="4,3"/>
      <circle cx="20.00" cy="10.00" r="4" fill="#c00"/>
      <line x1="20.00" y1="10.00" x2="20.00" y2="30.00" stroke="#888" stroke-dasharray="4,3"/>
      <line x1="20.00" y1="10.00" x2="5.00" y2="10.00" stroke="#888" stroke-dasharray="4,3"/>
    </svg>`;

    const document = parseSvg(decoratePrimeBrushPreviewSvg(originalSvg, config, false));
    const paths = Array.from(document.getElementsByTagNameNS(SVG_NS, "path"));
    expect(paths[0].getAttribute("stroke")).toBe("#1a5fb4");
    expect(paths[0].getAttribute("class")).toContain("pb-preview-draw");
    expect(paths[1].getAttribute("stroke")).toBe("#c01c28");
    expect(paths[1].getAttribute("class")).toContain("pb-preview-dash");
    expect(document.getElementsByTagNameNS(SVG_NS, "circle")[0].getAttribute("class")).toContain("pb-preview-point");
    expect(Array.from(document.getElementsByTagNameNS(SVG_NS, "line")).every((line) =>
      line.getAttribute("class")?.includes("pb-preview-projection"),
    )).toBe(true);
  });

  it("returns malformed SVG unchanged instead of altering the render error path", () => {
    const config = getPrimeBrushPreviewConfig("primebrush:\n  type: plot_2d");
    const malformedSvg = `<svg xmlns="${SVG_NS}"><path`;
    expect(decoratePrimeBrushPreviewSvg(malformedSvg, config, false)).toBe(malformedSvg);
  });
});
