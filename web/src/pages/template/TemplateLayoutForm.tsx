import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  type Draft,
  type MetadataUiField,
  type LatexBasesResponse,
  metadataUiSelectValue,
  parseLinewidthPercent,
  linewidthPercentToLatex,
  parseTextheightPercent,
  textheightPercentToLatex,
  FB_PIC_W,
  FB_MER_L,
  FB_MER_P,
  FB_MER_H,
} from "./templateModel";

function PdfPercentInput(props: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onCommit: (pct: number) => void;
}) {
  const { label, hint, value, min, max, onCommit } = props;
  return (
    <label className="block text-xs text-slate-600">
      <span className="text-slate-700">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step="any"
          className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") {
              return;
            }
            const n = Number(v);
            if (Number.isNaN(n)) {
              return;
            }
            onCommit(Math.min(max, Math.max(min, n)));
          }}
        />
        <span className="text-sm text-slate-600">%</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{hint}</p>
    </label>
  );
}

export type TemplateLayoutFormProps = {
  draft: Draft;
  advancedMode: boolean;
  latexBasesInfo: LatexBasesResponse;
  metadataUi: {
    fields: MetadataUiField[];
    source: string | null;
    warnings: string[];
  };
  onChangeDraft: (updater: (prev: Draft) => Draft) => void;
};

export function TemplateLayoutForm({
  draft,
  advancedMode,
  latexBasesInfo,
  metadataUi,
  onChangeDraft,
}: TemplateLayoutFormProps) {
  const { t } = useTranslation("template");
  const shippedSet = useMemo(() => new Set(latexBasesInfo.shipped), [latexBasesInfo.shipped]);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">{t("basicInfo")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            {t("templateId")}
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={draft.template_id}
              onChange={(e) => onChangeDraft((d) => ({ ...d, template_id: e.target.value }))}
            />
          </label>
          <label className="text-xs text-slate-600">
            {t("columns")}
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={draft.layout}
              onChange={(e) =>
                onChangeDraft((d) => ({
                  ...d,
                  layout: e.target.value === "double_column" ? "double_column" : "single_column",
                }))
              }
            >
              <option value="single_column">{t("colSingle")}</option>
              <option value="double_column">{t("colDouble")}</option>
            </select>
          </label>
          {advancedMode ? (
            <label className="text-xs text-slate-600 sm:col-span-2">
              {t("layoutTemplate")}
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{t("layoutTemplateHint")}</p>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={draft.latex_base}
                onChange={(e) => onChangeDraft((d) => ({ ...d, latex_base: e.target.value }))}
              >
                {!latexBasesInfo.choices.includes(draft.latex_base) && (
                  <option value={draft.latex_base}>
                    {draft.latex_base}
                    {t("currentYaml")}
                  </option>
                )}
                {latexBasesInfo.choices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {shippedSet.has(name) ? t("shipped") : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      {advancedMode ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">{t("defaultLayoutTitle")}</h2>
            <p className="mt-1 text-[11px] text-slate-500">{t("defaultLayoutHint")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">
                {t("marginCm")}
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  max={4}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={t("marginPh")}
                  value={draft.metadata_defaults.margin_cm ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: {
                        ...d.metadata_defaults,
                        margin_cm: v === "" ? undefined : Number(v),
                      },
                    }));
                  }}
                />
              </label>
              <label className="text-xs text-slate-600">
                {t("bodyPt")}
                <input
                  type="number"
                  step={0.5}
                  min={9}
                  max={14}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={t("bodyPh")}
                  value={draft.metadata_defaults.body_font_size_pt ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: {
                        ...d.metadata_defaults,
                        body_font_size_pt: v === "" ? undefined : Number(v),
                      },
                    }));
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.metadata_defaults.show_binding_line ?? false}
                  onChange={(e) =>
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: { ...d.metadata_defaults, show_binding_line: e.target.checked },
                    }))
                  }
                />
                {t("bindingMark")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.metadata_defaults.show_name_column ?? false}
                  onChange={(e) =>
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: { ...d.metadata_defaults, show_name_column: e.target.checked },
                    }))
                  }
                />
                {t("nameBox")}
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">{t("extendTitle")}</h2>
            <p className="mt-1 text-[11px] text-slate-500">{t("extendHint")}</p>
            {metadataUi.source && (
              <p className="mt-1 text-[11px] text-slate-400">{t("layoutSpecFile", { path: metadataUi.source })}</p>
            )}
            {metadataUi.warnings.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-[11px] text-amber-800">
                {metadataUi.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {metadataUi.fields.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">{t("noExtendFields")}</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {metadataUi.fields.map((field) => {
                  const patchExtra = (v: unknown) =>
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_extra: { ...d.metadata_extra, [field.key]: v },
                    }));
                  const hintEl = field.hint ? (
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">{field.hint}</p>
                  ) : null;
                  if (field.kind === "textarea") {
                    return (
                      <label key={field.key} className="text-xs text-slate-600 sm:col-span-2">
                        {field.label}
                        <textarea
                          rows={field.rows ?? 3}
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          placeholder={field.placeholder}
                          value={
                            draft.metadata_extra[field.key] != null
                              ? String(draft.metadata_extra[field.key])
                              : ""
                          }
                          onChange={(e) => patchExtra(e.target.value)}
                        />
                        {hintEl}
                      </label>
                    );
                  }
                  if (field.kind === "text") {
                    return (
                      <label key={field.key} className="text-xs text-slate-600 sm:col-span-2">
                        {field.label}
                        <input
                          type="text"
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          placeholder={field.placeholder}
                          value={
                            draft.metadata_extra[field.key] != null
                              ? String(draft.metadata_extra[field.key])
                              : ""
                          }
                          onChange={(e) => patchExtra(e.target.value)}
                        />
                        {hintEl}
                      </label>
                    );
                  }
                  if (field.kind === "select" && field.options?.length) {
                    return (
                      <label key={field.key} className="text-xs text-slate-600 sm:col-span-2">
                        {field.label}
                        <select
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={metadataUiSelectValue(field, draft.metadata_extra)}
                          onChange={(e) => patchExtra(e.target.value)}
                        >
                          {field.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {hintEl}
                      </label>
                    );
                  }
                  if (field.kind === "checkbox") {
                    return (
                      <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.metadata_extra[field.key])}
                          onChange={(e) => patchExtra(e.target.checked)}
                        />
                        {field.label}
                        {hintEl}
                      </label>
                    );
                  }
                  if (field.kind === "number") {
                    const n = draft.metadata_extra[field.key];
                    const numStr =
                      typeof n === "number" && !Number.isNaN(n)
                        ? String(n)
                        : n != null && String(n) !== ""
                          ? String(n)
                          : "";
                    return (
                      <label key={field.key} className="text-xs text-slate-600">
                        {field.label}
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step ?? "any"}
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={numStr}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") {
                              onChangeDraft((d) => {
                                const next = { ...d.metadata_extra };
                                delete next[field.key];
                                return { ...d, metadata_extra: next };
                              });
                              return;
                            }
                            const x = Number(v);
                            patchExtra(Number.isNaN(x) ? v : x);
                          }}
                        />
                        {hintEl}
                      </label>
                    );
                  }
                  return (
                    <p key={field.key} className="text-xs text-amber-700 sm:col-span-2">
                      {t("unsupportedFieldType")}
                    </p>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">{t("figureSizeTitle")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("figureSizeHint")}</p>
            <div className="mt-4 space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-slate-800">{t("geoFigures")}</p>
                <PdfPercentInput
                  label={t("widthInLine")}
                  hint={t("widthInLineHintGeo")}
                  min={20}
                  max={100}
                  value={parseLinewidthPercent(draft.metadata_defaults.primebrush_pdf?.latex_width, FB_PIC_W)}
                  onCommit={(pct) =>
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: {
                        ...d.metadata_defaults,
                        primebrush_pdf: {
                          ...d.metadata_defaults.primebrush_pdf,
                          latex_width: linewidthPercentToLatex(pct),
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-800">{t("flowH")}</p>
                <PdfPercentInput
                  label={t("widthInLine")}
                  hint={t("widthInLineHintFlowH")}
                  min={20}
                  max={100}
                  value={parseLinewidthPercent(
                    draft.metadata_defaults.mermaid_pdf?.landscape_width,
                    FB_MER_L,
                  )}
                  onCommit={(pct) =>
                    onChangeDraft((d) => ({
                      ...d,
                      metadata_defaults: {
                        ...d.metadata_defaults,
                        mermaid_pdf: {
                          ...d.metadata_defaults.mermaid_pdf,
                          landscape_width: linewidthPercentToLatex(pct),
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-800">{t("flowV")}</p>
                <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-6">
                  <PdfPercentInput
                    label={t("widthInLine")}
                    hint={t("widthInLineHintFlowV")}
                    min={20}
                    max={90}
                    value={parseLinewidthPercent(
                      draft.metadata_defaults.mermaid_pdf?.portrait_width,
                      FB_MER_P,
                    )}
                    onCommit={(pct) =>
                      onChangeDraft((d) => ({
                        ...d,
                        metadata_defaults: {
                          ...d.metadata_defaults,
                          mermaid_pdf: {
                            ...d.metadata_defaults.mermaid_pdf,
                            portrait_width: linewidthPercentToLatex(pct),
                          },
                        },
                      }))
                    }
                  />
                  <PdfPercentInput
                    label={t("maxPageHeight")}
                    hint={t("maxPageHeightHint")}
                    min={15}
                    max={70}
                    value={parseTextheightPercent(
                      draft.metadata_defaults.mermaid_pdf?.portrait_max_height,
                      FB_MER_H,
                    )}
                    onCommit={(pct) =>
                      onChangeDraft((d) => ({
                        ...d,
                        metadata_defaults: {
                          ...d.metadata_defaults,
                          mermaid_pdf: {
                            ...d.metadata_defaults.mermaid_pdf,
                            portrait_max_height: textheightPercentToLatex(pct),
                          },
                        },
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
