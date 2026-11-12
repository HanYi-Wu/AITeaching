import { useEffect, useMemo, useRef, useState } from "react";
import { Atom, BarChart3, Check, LineChart, Shapes, X, type LucideIcon } from "lucide-react";

import { apiPost } from "../api/client";
import { cn } from "../lib/utils";
import { decoratePrimeBrushPreviewSvg, getPrimeBrushPreviewConfig, type PrimeBrushPreviewConfig } from "./primeBrushPreview";

type PrimeBrushEditorModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (fencedBlock: string) => void;
};

type Preset = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  source: string;
};

const PRESETS: Preset[] = [
  {
    id: "geometry-median",
    label: "三角形中线",
    group: "数学几何",
    icon: Shapes,
    source: `primebrush:
  type: geometry_2d
  seed: 42
  canvas: { width: 400, height: 300, unit: px }
  style:
    stroke_width: 1.2
    font_family: sans-serif

  constructions:
    - op: triangle
      id: T1
      nodes: [A, B, C]
      attr: { type: random, min_angle: 30 }
      label:
        A: top
        B: bottom_left
        C: bottom_right

    - op: in_line
      id: M
      source: [A, B]
      params: 0.5
      label: "M"

    - op: line
      id: L1
      source: [C, M]
      style: dashed
      label: { text: "中线", pos: 0.5 }`,
  },
  {
    id: "plot-function",
    label: "函数图像",
    group: "数学函数",
    icon: LineChart,
    source: `primebrush:
  type: plot_2D
  seed: 42
  canvas: { width: 480, height: 360, unit: px }
  style:
    font_size: 11

  axes:
    x: { label: "x", range: [-5, 5], ticks: 1 }
    y: { label: "y", range: [-2, 2], ticks: 0.5, arrows: true }
    grid: true

  elements:
    - f: "sin(x)"
      domain: [-3.14, 3.14]
      color: "#1a5fb4"
      width: 2
      label: "sin"

    - f: "x**2 - 1"
      color: "#c01c28"
      style: dotted

    - op: point_on_f
      f_id: 0
      x: 1.57
      label: "P"
      show_projection: true`,
  },
  {
    id: "chart-bars",
    label: "统计柱状图",
    group: "数据图表",
    icon: BarChart3,
    source: `primebrush:
  type: chart
  seed: 42
  canvas: { width: 420, height: 280, unit: px }
  style:
    font_family: sans-serif

  kind: bar
  theme: academic
  data:
    - { label: "一班", value: 85, error: 5 }
    - { label: "二班", value: 92, error: 3 }
    - { label: "三班", value: 78, error: 8 }
  options:
    x_label: "班级"
    y_label: "平均分"
    bar_width: 0.6
    show_value: true
    show_error: true
    y_range: [0, 100]`,
  },
  {
    id: "chem-molecule",
    label: "化学结构式",
    group: "化学",
    icon: Atom,
    source: `primebrush:
  type: chemistry_molecule
  canvas: { width: 320, height: 240, unit: px }
  notation: SMILES
  value: "C(C1C(C(C(C(O1)O)O)O)O)O"`,
  },
];

const PLANNED_LABELS = ["地理等高线", "受力分析", "电路图", "射线光学", "晶格图"];

type RenderResponse = { svg: string };

function fencedPrimeBrush(source: string): string {
  return "```primebrush\n" + source.trim() + "\n```\n";
}

export function PrimeBrushEditorModal({ open, onClose, onConfirm }: PrimeBrushEditorModalProps) {
  const [selectedPresetId, setSelectedPresetId] = useState(PRESETS[0].id);
  const [source, setSource] = useState(PRESETS[0].source);
  const [svg, setSvg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewConfig, setPreviewConfig] = useState<PrimeBrushPreviewConfig | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const selectedPreset = useMemo(
    () => PRESETS.find((preset) => preset.id === selectedPresetId) ?? PRESETS[0],
    [selectedPresetId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedPresetId(PRESETS[0].id);
    setSource(PRESETS[0].source);
    setSvg("");
    setPreviewConfig(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(query.matches);
    syncPreference();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", syncPreference);
      return () => query.removeEventListener("change", syncPreference);
    }
    query.addListener(syncPreference);
    return () => query.removeListener(syncPreference);
  }, []);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }
    const trimmed = source.trim();
    const requestId = ++requestRef.current;
    if (!trimmed) {
      setSvg("");
      setPreviewConfig(null);
      setError("请输入 PrimeBrush YAML");
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void apiPost<RenderResponse>("/api/primebrush/render", { source: trimmed })
        .then((res) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setSvg(res.svg);
          setPreviewConfig(getPrimeBrushPreviewConfig(trimmed));
          setError(null);
        })
        .catch((err: unknown) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setSvg("");
          setPreviewConfig(null);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestRef.current === requestId) {
            setBusy(false);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (requestRef.current === requestId) {
        requestRef.current += 1;
      }
    };
  }, [open, source]);

  useEffect(() => {
    if (!svg) {
      setPreviewUrl(null);
      return;
    }
    const previewSvg = decoratePrimeBrushPreviewSvg(svg, previewConfig, reducedMotion);
    const url = URL.createObjectURL(new Blob([previewSvg], { type: "image/svg+xml" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [svg, previewConfig, reducedMotion]);

  if (!open) {
    return null;
  }

  function choosePreset(preset: Preset) {
    setSelectedPresetId(preset.id);
    setSource(preset.source);
  }

  function handleInsert() {
    onConfirm(fencedPrimeBrush(source));
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="primebrush-editor-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <div
        className="or-dialog or-g48-dialog flex max-h-[92vh] w-full max-w-6xl flex-col overflow-y-auto rounded-3xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] shadow-2xl ring-1 ring-black/5 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex shrink-0 flex-col border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3.5 sm:p-4 lg:min-h-0 lg:shrink lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2">
            <h3 id="primebrush-editor-title" className="text-base font-semibold text-[var(--or-text)]">
              教育绘图
            </h3>
            <button
              type="button"
              className="or-icon-button inline-flex h-8 w-8 items-center justify-center rounded-full text-sm text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] hover:text-[var(--or-text)] transition-colors"
              onClick={onClose}
              title="关闭"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3.5 space-y-1.5">
            {PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = selectedPreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-all",
                    active
                      ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm"
                      : "text-[var(--or-muted)] hover:bg-[var(--or-card)] hover:text-[var(--or-text)]",
                  )}
                  onClick={() => choosePreset(preset)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{preset.label}</span>
                    <span className={cn("block truncate text-[13px]", active ? "text-[var(--or-muted)]" : "text-[var(--or-muted)]")}>
                      {preset.group}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[var(--or-outline)] pt-3">
            <p className="text-[13px] font-medium text-[var(--or-muted)]">下一批预置</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PLANNED_LABELS.map((label) => (
                <span key={label} className="or-pill rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-0.5 text-[13px] text-[var(--or-muted)]">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </aside>

        <div className="grid shrink-0 grid-cols-1 gap-0 bg-[var(--or-card)] md:grid-cols-2 lg:min-h-0 lg:shrink">
          <section className="flex shrink-0 flex-col border-b border-[var(--or-outline)] p-3.5 sm:p-4 md:min-h-0 md:shrink md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--or-muted)]">源 YAML</p>
              <span className="or-pill rounded-full bg-[var(--or-block)] px-2.5 py-0.5 text-[13px] font-medium text-[var(--or-muted)]">
                {selectedPreset.group}
              </span>
            </div>
            <textarea
              className="or-input mt-2 min-h-[12rem] flex-1 resize-none rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-3 font-mono text-sm leading-relaxed text-[var(--or-text)] outline-none focus:border-[var(--or-primary)] focus:bg-[var(--or-card)] focus:ring-1 focus:ring-[var(--or-focus)] md:min-h-0"
              spellCheck={false}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </section>

          <section className="flex shrink-0 flex-col p-3.5 sm:p-4 md:min-h-0 md:shrink">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--or-muted)]">预览</p>
              {busy ? <span className="text-[13px] text-[var(--or-muted)]">渲染中…</span> : null}
            </div>
            <div className="mt-2 flex min-h-[14rem] flex-1 items-center justify-center overflow-auto rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 md:min-h-[22rem]">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <p className="text-sm text-[var(--or-on-warning)]">{error ?? "暂无预览"}</p>
              )}
            </div>
            {error ? <p className="mt-2 text-[13px] text-[var(--or-on-warning)]">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                className="or-button or-pill inline-flex h-9 items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="or-button or-button-primary or-pill or-g48-pill-dropdown h-9 rounded-full bg-[var(--or-primary)] px-4 text-sm font-medium text-[var(--or-on-primary)] shadow-sm hover:bg-[var(--or-primary)] active:bg-slate-950 transition-colors disabled:opacity-40"
                disabled={!source.trim() || !!error}
                onClick={handleInsert}
              >
                <Check className="h-4 w-4 shrink-0" aria-hidden />
                <span className="text-center">插入到题目</span>
                <span className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
