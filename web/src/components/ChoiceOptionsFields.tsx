import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { EmbedKind } from "../lib/bankEditorEmbedKinds";
import { LatexRichTextField } from "./LatexRichTextField";

const DEFAULT_KEYS = ["A", "B", "C", "D"] as const;

/** 合并默认键与已有键，保证 A–D 优先 */
function orderedKeys(opts: Record<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of DEFAULT_KEYS) {
    out.push(k);
    seen.add(k);
  }
  for (const k of Object.keys(opts).sort()) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

export type ChoiceOptionsFieldsProps = {
  options: Record<string, string>;
  onCommit: (opts: Record<string, string>) => void;
  idPrefix: string;
  busy?: boolean;
  makeEmbedKind: (optionKey: string) => EmbedKind;
  beginMermaidEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginPrimeBrushEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginImageEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  hideToolbar?: boolean;
};

function ChoiceOptionRow({
  optionKey,
  value,
  idPrefix,
  busy,
  makeEmbedKind,
  beginMermaidEmbed,
  beginPrimeBrushEmbed,
  beginImageEmbed,
  onChange,
  onRemove,
  removable,
  hideToolbar,
}: {
  optionKey: string;
  value: string;
  idPrefix: string;
  busy: boolean;
  makeEmbedKind: (optionKey: string) => EmbedKind;
  beginMermaidEmbed: ChoiceOptionsFieldsProps["beginMermaidEmbed"];
  beginPrimeBrushEmbed: ChoiceOptionsFieldsProps["beginPrimeBrushEmbed"];
  beginImageEmbed: ChoiceOptionsFieldsProps["beginImageEmbed"];
  onChange: (next: string) => void;
  onRemove: () => void;
  removable: boolean;
  hideToolbar?: boolean;
}) {
  const { t } = useTranslation("components");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const syncId = `${idPrefix}-${optionKey}`;
  return (
    <div className="block">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--or-text)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] font-mono text-[13px] font-bold text-[var(--or-muted)]">
            {optionKey}
          </span>
          <span className="font-mono sr-only">{optionKey}</span>
        </span>
        {removable && (
          <button
            type="button"
            className="or-button or-button-danger or-pill inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_40%,transparent)] px-3 py-1 text-sm font-medium text-[var(--or-on-error)] hover:bg-[color-mix(in_srgb,var(--or-error-container)_50%,transparent)] active:bg-[var(--or-error-container)] transition-colors"
            onClick={onRemove}
          >
            {t("choiceFields.remove")}
          </button>
        )}
      </div>
      <LatexRichTextField
        textAreaRef={textAreaRef}
        syncTextAreaId={syncId}
        minRows={2}
        value={value}
        onChange={onChange}
        onRequestMermaid={(sel) => beginMermaidEmbed(makeEmbedKind(optionKey), sel)}
        onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed(makeEmbedKind(optionKey), sel)}
        onRequestImage={(sel) => beginImageEmbed(makeEmbedKind(optionKey), sel)}
        busy={busy}
        hideToolbar={hideToolbar}
      />
    </div>
  );
}

export function ChoiceOptionsFields({
  options,
  onCommit,
  idPrefix,
  busy = false,
  makeEmbedKind,
  beginMermaidEmbed,
  beginPrimeBrushEmbed,
  beginImageEmbed,
  hideToolbar = false,
}: ChoiceOptionsFieldsProps) {
  const { t } = useTranslation("components");
  const keys = useMemo(() => orderedKeys(options), [options]);

  function updateKey(key: string, value: string) {
    onCommit({ ...options, [key]: value });
  }

  function addOptionKey() {
    let n = 5;
    let label = "E";
    while (label in options || keys.includes(label)) {
      label = String.fromCharCode(64 + n);
      n += 1;
      if (n > 26) {
        label = `_${Date.now()}`;
        break;
      }
    }
    onCommit({ ...options, [label]: "" });
  }

  function removeKey(key: string) {
    if (DEFAULT_KEYS.includes(key as (typeof DEFAULT_KEYS)[number])) {
      return;
    }
    const next = { ...options };
    delete next[key];
    onCommit(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-[var(--or-muted)]">{t("choiceFields.optionsLatex")}</p>
      <div className="space-y-3">
        {keys.map((key) => (
          <ChoiceOptionRow
            key={key}
            optionKey={key}
            value={options[key] ?? ""}
            idPrefix={idPrefix}
            busy={busy}
            makeEmbedKind={makeEmbedKind}
            beginMermaidEmbed={beginMermaidEmbed}
            beginPrimeBrushEmbed={beginPrimeBrushEmbed}
            beginImageEmbed={beginImageEmbed}
            onChange={(next) => updateKey(key, next)}
            onRemove={() => removeKey(key)}
            removable={!DEFAULT_KEYS.includes(key as (typeof DEFAULT_KEYS)[number])}
            hideToolbar={hideToolbar}
          />
        ))}
      </div>
      <div>
        <button
          type="button"
          className="or-button or-pill or-g48-pill-btn or-g48-pill-dropdown rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
          onClick={addOptionKey}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-center">{t("choiceFields.addKey")}</span>
          <span className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </div>
    </div>
  );
}
