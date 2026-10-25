import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { KatexPlainPreview } from "../../components/KatexText";
import { MetadataFilterControls } from "../../components/MetadataFilterControls";
import { QuestionHoverDetails } from "../../components/QuestionHoverDetails";
import { isImeComposingKeyboardEvent } from "../../lib/ime";
import {
  hasActiveMetadataFilters,
  type MetadataFilterDefinition,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import { cn } from "../../lib/utils";
import type { QuestionRow } from "../../types/compose";

export type ComposeBankSearchPanelProps = {
  subject: string;
  onSubjectChange: (subject: string) => void;
  subjectOptions: string[];
  namespaceFilter: string;
  onNamespaceFilterChange: (namespace: string) => void;
  namespaces: string[];
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  search: string;
  onCommitSearch: (value: string) => void;
  metadataFilterDefinitions: MetadataFilterDefinition[];
  metadataFilters: MetadataFilters;
  onMetadataFiltersChange: (filters: MetadataFilters) => void;
  filterExpanded: boolean;
  onFilterExpandedChange: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  contentSyncing: boolean;
  totalQuestionCount: number;
  filteredQuestions: QuestionRow[];
  selectedLeftIds: string[];
  selectedLeftIdsSet: ReadonlySet<string>;
  onLeftBankClick: (q: QuestionRow, index: number, e: MouseEvent<HTMLButtonElement>) => void;
  onDropPaperItemToRemove: (sectionId: string, qid: string) => void;
  onError: (msg: string | null) => void;
};

export function ComposeBankSearchPanel({
  subject,
  onSubjectChange,
  subjectOptions,
  namespaceFilter,
  onNamespaceFilterChange,
  namespaces,
  typeFilter,
  onTypeFilterChange,
  searchInput,
  onSearchInputChange,
  search,
  onCommitSearch,
  metadataFilterDefinitions,
  metadataFilters,
  onMetadataFiltersChange,
  filterExpanded,
  onFilterExpandedChange,
  contentSyncing,
  totalQuestionCount,
  filteredQuestions,
  selectedLeftIds,
  selectedLeftIdsSet,
  onLeftBankClick,
  onDropPaperItemToRemove,
  onError,
}: ComposeBankSearchPanelProps) {
  const { t } = useTranslation(["compose", "common", "lib"]);

  return (
    <section
      className="hidden w-full min-w-0 shrink-0 flex-col border-slate-200 bg-white md:flex md:w-56 md:border-r xl:w-72"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-originreach-paper-item")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData("application/x-originreach-paper-item");
        if (!raw) return;
        event.preventDefault();
        try {
          const item = JSON.parse(raw) as { sectionId: string; qid: string };
          onDropPaperItemToRemove(item.sectionId, item.qid);
        } catch {
          onError("无法读取拖动的题目");
        }
      }}
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("compose:bankSearchTitle")}
        </h2>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100"
          onClick={() => onFilterExpandedChange((v) => !v)}
        >
          <span>
            {t("compose:filter")} ·{" "}
            {Number(namespaceFilter !== "__all__") +
              Number(typeFilter !== "__all__") +
              Number(Boolean(search.trim())) +
              Number(hasActiveMetadataFilters(metadataFilters))}{" "}
            项
          </span>
          <span className="truncate pl-2 text-[10px] font-normal text-slate-500">
            {filterExpanded
              ? t("common:collapseHint")
              : t("compose:filterSummary", {
                  subject,
                  collection:
                    namespaceFilter === "__all__" ? t("compose:allCollections") : namespaceFilter,
                  type:
                    typeFilter === "__all__"
                      ? t("compose:allTypes")
                      : typeFilter === "group"
                        ? t("compose:groupOption")
                        : t(`lib:questionTypes.${typeFilter}`, { defaultValue: typeFilter }),
                  search: `${search.trim() ? t("common:searchingSuffix") : ""}${
                    hasActiveMetadataFilters(metadataFilters) ? " · metadata" : ""
                  }`,
                })}
          </span>
        </button>
        {filterExpanded && (
          <div
            className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="组卷筛选"
            onClick={() => onFilterExpandedChange(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">筛选题目</h3>
                <button
                  type="button"
                  aria-label="关闭组卷筛选"
                  onClick={() => onFilterExpandedChange(false)}
                >
                  ×
                </button>
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:subjectForExport")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={subject}
                    onChange={(e) => onSubjectChange(e.target.value)}
                  >
                    {subjectOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:collection")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={namespaceFilter}
                    onChange={(e) => onNamespaceFilterChange(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    {namespaces.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:questionType")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={typeFilter}
                    onChange={(e) => onTypeFilterChange(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    <option value="group">{t("compose:groupOption")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:search")}
                  <input
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400"
                    placeholder={t("compose:searchPlaceholder")}
                    value={searchInput}
                    onChange={(e) => onSearchInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || isImeComposingKeyboardEvent(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onCommitSearch(e.currentTarget.value);
                    }}
                    onBlur={(e) => onCommitSearch(e.currentTarget.value)}
                  />
                </label>
                <MetadataFilterControls
                  definitions={metadataFilterDefinitions}
                  filters={metadataFilters}
                  onChange={onMetadataFiltersChange}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => onFilterExpandedChange(false)}
                  className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
                >
                  查看结果
                </button>
              </div>
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-snug text-slate-500">
          可将题目拖入右侧小节；多选后也可用箭头加入。
        </p>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {contentSyncing ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-700">
            正在更新内容库...
          </div>
        ) : totalQuestionCount === 0 ? (
          <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
            <p className="font-medium text-slate-800">{t("compose:emptyBank")}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {t("compose:emptyBankHint")}
            </p>
          </li>
        ) : filteredQuestions.length === 0 ? (
          <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
            <p className="font-medium text-slate-800">{t("compose:emptyFilter")}</p>
            <p className="mt-2 text-xs text-slate-500">{t("compose:emptyFilterHint")}</p>
          </li>
        ) : (
          filteredQuestions.map((q, index) => {
            const isBundle = q.type === "group";
            return (
              <li key={q.qualified_id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "application/x-originreach-bank-qids",
                      JSON.stringify(
                        selectedLeftIdsSet.has(q.qualified_id) ? selectedLeftIds : [q.qualified_id],
                      ),
                    )
                  }
                  onClick={(e) => onLeftBankClick(q, index, e)}
                  className={cn(
                    "mb-1 w-full rounded-lg border px-2 py-2 text-left text-sm transition-colors",
                    selectedLeftIdsSet.has(q.qualified_id)
                      ? "border-slate-900 bg-slate-100"
                      : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white",
                  )}
                >
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                    {t(`lib:questionTypes.${q.type}`, { defaultValue: q.type })}
                  </span>
                  {isBundle ? (
                    <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                      {t("compose:bundleBadge")}
                    </span>
                  ) : null}
                  <span title={q.qualified_id} className="ml-1 font-mono text-[11px] text-slate-800 [overflow-wrap:anywhere]">{q.qualified_id}</span>
                  <QuestionHoverDetails id={q.qualified_id}>
                    <KatexPlainPreview
                      text={q.content_preview}
                      className="mt-1 line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                    />
                  </QuestionHoverDetails>
                  {Object.keys(q.metadata ?? {}).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(q.metadata ?? {}).map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          {k}:{String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
