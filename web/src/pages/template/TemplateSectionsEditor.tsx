import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { standardSections } from "../../lib/manualPaperShortcuts";
import {
  type TemplateSectionRow,
  SECTION_KIND_VALUES,
  LEGACY_SECTION_KIND_VALUES,
  updateSectionItem,
  moveSectionItem,
  removeSectionItem,
  addSectionItem,
} from "./templateModel";
import { Select as AppSelect } from "../../components/ui/select";

export type TemplateSectionsEditorProps = {
  sections: TemplateSectionRow[];
  onChangeSections: (sections: TemplateSectionRow[]) => void;
};

export function TemplateSectionsEditor({
  sections,
  onChangeSections,
}: TemplateSectionsEditorProps) {
  const { t } = useTranslation("template");

  const updateSection = (i: number, patch: Partial<TemplateSectionRow>) => {
    onChangeSections(updateSectionItem(sections, i, patch));
  };

  const moveSection = (i: number, dir: -1 | 1) => {
    onChangeSections(moveSectionItem(sections, i, dir));
  };

  const removeSection = (i: number) => {
    onChangeSections(removeSectionItem(sections, i));
  };

  const addSection = (type: string) => {
    const label = t(`sectionKind.${type}`);
    onChangeSections(addSectionItem(sections, type, label));
  };

  return (
    <section className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--or-outline)] pb-4">
        <h2 className="text-base font-semibold text-[var(--or-text)]">{t("structureTitle")}</h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="or-g49-btn or-g49-btn-tonal text-sm py-1.5 px-3"
            onClick={() => {
              if (
                sections.length &&
                !window.confirm("替换当前模板结构为100分常用模板？未保存的结构将被替换。")
              ) {
                return;
              }
              onChangeSections(standardSections());
            }}
          >
            一键100分模板
          </button>
          <AppSelect
            className="or-g49-input py-1 text-sm font-medium"
            value=""
            onValueChange={(value) => {
              if (value) {
                addSection(value);
              }
            }}
          >
            <option value="">{t("addSection")}</option>
            {SECTION_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {t(`sectionKind.${kind}`)}
              </option>
            ))}
          </AppSelect>
        </div>
      </div>
      <ul className="mt-4 space-y-3.5">
        {sections.map((s, i) => (
          <li key={i} className="rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-4 transition-all">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-0.5 text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                  title={t("moveUp")}
                  onClick={() => moveSection(i, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-0.5 text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                  title={t("moveDown")}
                  onClick={() => moveSection(i, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <input
                  className="or-g49-input w-full font-semibold text-[var(--or-text)] text-sm"
                  value={s.section_id}
                  onChange={(e) => updateSection(i, { section_id: e.target.value })}
                  placeholder={t("sectionTitlePh")}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <AppSelect
                    className="or-g49-input py-1 text-sm font-medium"
                    value={s.type}
                    onValueChange={(value) => {
                      const type = value;
                      updateSection(i, {
                        type,
                        required_count: type === "text" ? 0 : Math.max(1, s.required_count),
                        score_per_item: type === "text" ? 0 : s.score_per_item,
                      });
                    }}
                  >
                    {s.type === "choice" &&
                      LEGACY_SECTION_KIND_VALUES.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`sectionKind.${kind}`)}
                        </option>
                      ))}
                    {SECTION_KIND_VALUES.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`sectionKind.${kind}`)}
                      </option>
                    ))}
                  </AppSelect>
                  {s.type !== "text" && (
                    <>
                      <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--or-muted)]">
                        {t("questionCount")}
                        <input
                          type="number"
                          min={0}
                          className="or-g49-input w-20 py-1 tabular-nums text-sm"
                          value={s.required_count}
                          onChange={(e) =>
                            updateSection(i, { required_count: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--or-muted)]">
                        {t("scoreEach")}
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className="or-g49-input w-20 py-1 tabular-nums text-sm"
                          value={s.score_per_item}
                          onChange={(e) =>
                            updateSection(i, { score_per_item: Number(e.target.value) })
                          }
                        />
                      </label>
                    </>
                  )}
                  {s.type === "text" && (
                    <span className="text-sm font-medium text-[var(--or-muted)]">{t("textNoCount")}</span>
                  )}
                </div>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("describeOptional")}
                  <textarea
                    className="or-g49-input mt-1 w-full block"
                    rows={3}
                    value={s.describe ?? ""}
                    onChange={(e) => updateSection(i, { describe: e.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--or-error)] bg-[var(--or-card)] text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] transition-colors self-start"
                title={t("deleteSection")}
                onClick={() => removeSection(i)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
