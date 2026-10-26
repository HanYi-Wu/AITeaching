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
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        快速套用版式{" "}
        <span
          title="会调整页面和题型结构；不会清除已选题目或分值。应用后仍需保存。"
          className="ml-1 cursor-help rounded-full border border-slate-300 px-1.5 text-[10px] text-slate-500"
        >
          ?
        </span>
      </summary>
      <p className="mt-2 text-xs text-slate-600">选一个起点，再修改下面的设置。应用后记得保存。</p>
      <div className="mt-3 flex flex-wrap gap-2">
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
            className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
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
      className="h-[min(70vh,800px)] w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
