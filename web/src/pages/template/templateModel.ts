import yaml from "js-yaml";
import { standardSections } from "../../lib/manualPaperShortcuts";
import i18n from "../../i18n/i18n";

export type TemplateSectionRow = {
  section_id: string;
  type: string;
  required_count: number;
  score_per_item: number;
  describe?: string | null;
};

/** 与后端 `MermaidPdfOptions` 一致；空字符串保存时用默认值 */
export type MermaidPdfOpts = {
  landscape_width?: string;
  portrait_width?: string;
  portrait_max_height?: string;
};

/** 与后端 `PrimeBrushPdfOptions` 一致 */
export type PrimeBrushPdfOpts = {
  latex_width?: string;
};

type LayoutOpts = {
  margin_cm?: number;
  body_font_size_pt?: number;
  show_binding_line?: boolean;
  show_name_column?: boolean;
  mermaid_pdf?: MermaidPdfOpts;
  primebrush_pdf?: PrimeBrushPdfOpts;
};

/** 与 ``*.tex.j2`` 同目录的 ``*.metadata_ui.yaml`` 中字段一致；由 API 返回，不在前端写死键名 */
export type MetadataUiField = {
  key: string;
  label: string;
  kind: string;
  hint?: string;
  placeholder?: string;
  rows?: number;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  omit_values?: unknown[];
};

/** 内置版面表单负责的键由 GET /api/templates/parsed 的 layout_builtin_keys 提供 */
function splitMetadataDefaults(
  raw: unknown,
  builtinKeys: Set<string>,
): { layout: LayoutOpts; extra: Record<string, unknown> } {
  const md =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(md)) {
    if (!builtinKeys.has(k)) {
      extra[k] = v;
    }
  }
  return {
    layout: {
      margin_cm: typeof md.margin_cm === "number" ? md.margin_cm : undefined,
      body_font_size_pt: typeof md.body_font_size_pt === "number" ? md.body_font_size_pt : undefined,
      show_binding_line: Boolean(md.show_binding_line),
      show_name_column: Boolean(md.show_name_column),
      mermaid_pdf: (() => {
        const m = md.mermaid_pdf as MermaidPdfOpts | undefined;
        if (!m || typeof m !== "object") {
          return undefined;
        }
        return {
          landscape_width: m.landscape_width != null ? String(m.landscape_width) : "",
          portrait_width: m.portrait_width != null ? String(m.portrait_width) : "",
          portrait_max_height: m.portrait_max_height != null ? String(m.portrait_max_height) : "",
        };
      })(),
      primebrush_pdf: (() => {
        const p = md.primebrush_pdf as PrimeBrushPdfOpts | undefined;
        if (!p || typeof p !== "object") {
          return undefined;
        }
        return { latex_width: p.latex_width != null ? String(p.latex_width) : "" };
      })(),
    },
    extra,
  };
}

export function serializeExtraForYaml(
  key: string,
  value: unknown,
  fields: MetadataUiField[],
): unknown | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const spec = fields.find((f) => f.key === key);
  if (!spec) {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }
    return value;
  }
  if (spec.kind === "text" || spec.kind === "textarea") {
    const s = String(value);
    if (s.trim() === "") {
      return undefined;
    }
    return value;
  }
  if (spec.kind === "select") {
    const s = String(value);
    const omit = spec.omit_values ?? [];
    if (omit.some((x) => String(x) === s)) {
      return undefined;
    }
    return value;
  }
  if (spec.kind === "checkbox") {
    return Boolean(value);
  }
  if (spec.kind === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) {
      return undefined;
    }
    return n;
  }
  return value;
}

export function metadataUiSelectValue(field: MetadataUiField, extra: Record<string, unknown>): string {
  const cur = extra[field.key];
  if (cur !== undefined && cur !== null && String(cur) !== "") {
    return String(cur);
  }
  return field.options?.[0]?.value ?? "";
}

/** 从模板文件里读到的宽度字段，转成百分比数字（20–100）供表单显示 */
export function parseLinewidthPercent(raw: string | undefined, fallbackPercent: number): number {
  if (!raw?.trim()) {
    return fallbackPercent;
  }
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\\linewidth\s*$/);
  if (!m) {
    return fallbackPercent;
  }
  const v = parseFloat(m[1]) * 100;
  return Math.min(100, Math.max(20, Math.round(v * 100) / 100));
}

export function linewidthPercentToLatex(percent: number): string {
  const p = Math.min(100, Math.max(20, percent));
  if (p >= 99.999) {
    return "1\\linewidth";
  }
  const x = p / 100;
  const num = x.toFixed(4).replace(/\.?0+$/, "");
  return `${num}\\linewidth`;
}

/** 从 \\textheight 转成百分比（15–70） */
export function parseTextheightPercent(raw: string | undefined, fallbackPercent: number): number {
  if (!raw?.trim()) {
    return fallbackPercent;
  }
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\\textheight\s*$/);
  if (!m) {
    return fallbackPercent;
  }
  const v = parseFloat(m[1]) * 100;
  return Math.min(70, Math.max(15, Math.round(v * 100) / 100));
}

export function textheightPercentToLatex(percent: number): string {
  const p = Math.min(70, Math.max(15, percent));
  const x = p / 100;
  const num = x.toFixed(4).replace(/\.?0+$/, "");
  return `${num}\\textheight`;
}

/** 解析失败时的滑块回退（与后端模型默认几何含义一致） */
export const FB_PIC_W = 90;

export const FB_MER_L = 62;

export const FB_MER_P = 52;

export const FB_MER_H = 40;

export type TemplateListRow = {
  id: string;
  path: string;
  layout: string;
  latex_base?: string;
  metadata_defaults?: LayoutOpts | null;
  sections: TemplateSectionRow[];
};

/** GET /api/templates/parsed */
export type TemplateParsedResponse = {
  template_id: string;
  layout: string;
  latex_base: string;
  sections: TemplateSectionRow[];
  metadata_defaults: Record<string, unknown>;
  layout_builtin_keys: string[];
};

export function draftFromParsed(parsed: TemplateParsedResponse): Draft {
  const keys = new Set(parsed.layout_builtin_keys);
  const { layout, extra } = splitMetadataDefaults(parsed.metadata_defaults, keys);
  return {
    template_id: parsed.template_id,
    layout: parsed.layout === "double_column" ? "double_column" : "single_column",
    latex_base: parsed.latex_base,
    sections: parsed.sections.map((s) => ({
      section_id: s.section_id,
      type: s.type,
      required_count: s.type === "text" ? 0 : Number(s.required_count ?? 0),
      score_per_item: Number(s.score_per_item ?? 0),
      describe: s.describe ?? "",
    })),
    metadata_defaults: layout,
    metadata_extra: { ...extra },
  };
}

export function mermaidPdfEqual(
  a: { landscape_width: string; portrait_width: string; portrait_max_height: string },
  b: unknown,
): boolean {
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return false;
  }
  const o = b as Record<string, string>;
  return (
    a.landscape_width === o.landscape_width &&
    a.portrait_width === o.portrait_width &&
    a.portrait_max_height === o.portrait_max_height
  );
}

export function primebrushPdfEqual(a: { latex_width: string }, b: unknown): boolean {
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return false;
  }
  const o = b as Record<string, string>;
  return a.latex_width === o.latex_width;
}

export type LatexBasesResponse = {
  shipped: string[];
  in_project: string[];
  choices: string[];
};

export type Draft = {
  template_id: string;
  layout: "single_column" | "double_column";
  latex_base: string;
  sections: TemplateSectionRow[];
  /** 内置表单维护的 metadata_defaults 子集（边距、插图尺寸等） */
  metadata_defaults: LayoutOpts;
  /** 其余键由 latex_base 配套 ``*.metadata_ui.yaml`` 动态编辑，并原样写入模板 YAML */
  metadata_extra: Record<string, unknown>;
};

export type TemplatePresetId = "practice" | "unit" | "major";

export function applyTemplatePreset(draft: Draft, preset: TemplatePresetId): Draft {
  const settings = {
    practice: { layout: "single_column" as const, margin_cm: 2.2, body_font_size_pt: 11, show_binding_line: false, show_name_column: true },
    unit: { layout: "single_column" as const, margin_cm: 1.8, body_font_size_pt: 11, show_binding_line: false, show_name_column: true },
    major: { layout: "double_column" as const, margin_cm: 1.6, body_font_size_pt: 10.5, show_binding_line: true, show_name_column: true },
  }[preset];
  const { layout, ...metadata } = settings;
  const hasQuestions = draft.sections.some(section => section.type !== 'text' && section.required_count > 0);
  const defaults = standardSections();
  const counts = preset === 'practice' ? [5, 2, 1] : preset === 'unit' ? [8, 3, 2] : [10, 5, 3];
  const sections = hasQuestions ? draft.sections : [
    ...draft.sections.filter(section => section.type === 'text'),
    ...defaults.map((section, index) => ({ ...section, required_count: counts[index] })),
  ];
  return { ...draft, sections, layout, metadata_defaults: { ...draft.metadata_defaults, ...metadata } };
}

/** 与后端 `safe_filename_component` 一致，用于由模板编号生成文件名 */
function safeFilenameComponent(s: string): string {
  const t = s.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return t || "export";
}

export function templateIdFromSaveBody(tab: "visual" | "yaml", yamlTabContent: string, draft: Draft): string {
  if (tab === "visual") {
    return draft.template_id;
  }
  try {
    const parsed = yaml.load(yamlTabContent) as { template_id?: unknown };
    if (typeof parsed?.template_id === "string") {
      return parsed.template_id;
    }
  } catch {
    /* ignore */
  }
  return draft.template_id;
}

/** 与当前模板文件同目录，文件名 = 规范化后的模板编号 + .yaml */
export function desiredPathForTemplateId(currentPath: string, templateId: string): string {
  const norm = currentPath.replace(/\\/g, "/");
  const stem = safeFilenameComponent(templateId);
  const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "templates";
  return `${dir}/${stem}.yaml`;
}

export function createDefaultDraft(): Draft {
  return {
    template_id: "new_template",
    layout: "single_column",
    latex_base: "exam-zh-base.tex.j2",
    sections: [
      {
        section_id: i18n.t("template:defaultSectionIntro"),
        type: "text",
        required_count: 0,
        score_per_item: 0,
        describe: "",
      },
    ],
    metadata_defaults: {},
    metadata_extra: {},
  };
}

/** 与后端 `SectionKind` 一致；展示文案由 template:sectionKind.* 提供 */
export const SECTION_KIND_VALUES = [
  "text",
  "group",
  "single_choice",
  "multiple_choice",
  "fill",
  "judge",
  "short_answer",
  "reasoning",
  "essay",
] as const;

export const LEGACY_SECTION_KIND_VALUES = ["choice"] as const;

export const FALLBACK_LATEX_BASES: LatexBasesResponse = {
  shipped: ["exam-zh-base.tex.j2"],
  in_project: [],
  choices: ["exam-zh-base.tex.j2"],
};
