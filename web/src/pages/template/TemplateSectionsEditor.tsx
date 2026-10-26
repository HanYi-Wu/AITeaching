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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{t("structureTitle")}</h2>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-sm"
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
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v) {
              addSection(v);
            }
          }}
        >
          <option value="">{t("addSection")}</option>
          {SECTION_KIND_VALUES.map((kind) => (
            <option key={kind} value={kind}>
              {t(`sectionKind.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      <ul className="mt-4 space-y-3">
        {sections.map((s, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white p-0.5"
                  title={t("moveUp")}
                  onClick={() => moveSection(i, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white p-0.5"
                  title={t("moveDown")}
                  onClick={() => moveSection(i, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-medium"
                  value={s.section_id}
                  onChange={(e) => updateSection(i, { section_id: e.target.value })}
                  placeholder={t("sectionTitlePh")}
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={s.type}
                    onChange={(e) => {
                      const type = e.target.value;
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
                  </select>
                  {s.type !== "text" && (
                    <>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        {t("questionCount")}
                        <input
                          type="number"
                          min={0}
                          className="w-16 rounded border border-slate-300 px-1 py-0.5 text-sm"
                          value={s.required_count}
                          onChange={(e) =>
                            updateSection(i, { required_count: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        {t("scoreEach")}
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className="w-16 rounded border border-slate-300 px-1 py-0.5 text-sm"
                          value={s.score_per_item}
                          onChange={(e) =>
                            updateSection(i, { score_per_item: Number(e.target.value) })
                          }
                        />
                      </label>
                    </>
                  )}
                  {s.type === "text" && (
                    <span className="text-xs text-slate-500">{t("textNoCount")}</span>
                  )}
                </div>
                <label className="block text-xs text-slate-600">
                  {t("describeOptional")}
                  <textarea
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    rows={3}
                    value={s.describe ?? ""}
                    onChange={(e) => updateSection(i, { describe: e.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                className="rounded-md border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
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
