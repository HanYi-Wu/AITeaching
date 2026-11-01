import { type Draft, type TemplatePresetId, applyTemplatePreset } from "./templateModel";

export type TemplatePresetPanelProps = {
  draft: Draft;
  busy: boolean;
  onApplyPreset: (nextDraft: Draft, message: string) => void;
};

const PRESET_BUTTONS: readonly [TemplatePresetId, string][] = [
  ["practice", "随堂练习"],
  ["unit", "单元测验"],
  ["major", "期中 / 期末"],
];

export function TemplatePresetPanel({
  draft,
  busy,
  onApplyPreset,
}: TemplatePresetPanelProps) {
  return (
    <details className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-4 shadow-xs" open>
      <summary className="cursor-pointer text-base font-semibold text-[var(--or-text)] select-none">
        快速套用版式
      </summary>
      <div className="mt-3.5 flex flex-wrap gap-2.5">
        {PRESET_BUTTONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            title={`套用${label}的版式；已有题型与分值保留，应用后需要保存`}
            disabled={busy}
            onClick={() => {
              const next = applyTemplatePreset(draft, id);
              const totalQuestions = next.sections.reduce(
                (sum, section) => sum + section.required_count,
                0,
              );
              const colText = next.layout === "double_column" ? "双栏" : "单栏";
              const margin = next.metadata_defaults.margin_cm;
              const fontSize = next.metadata_defaults.body_font_size_pt;
              onApplyPreset(
                next,
                `已应用「${label}」：${colText}，${margin}cm 边距，${fontSize}pt 字号；${totalQuestions} 题。请保存模板。`,
              );
            }}
            className="or-g49-btn or-g49-btn-tonal"
          >
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function TemplateYamlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      className="h-[min(70vh,800px)] w-full rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-4 font-mono text-sm leading-relaxed"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
