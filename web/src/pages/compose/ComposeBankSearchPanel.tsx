import { memo, type MouseEvent } from "react";
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
import { Select as AppSelect } from "../../components/ui/select";

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

type ComposeQuestionListProps = Pick<
  ComposeBankSearchPanelProps,
  "contentSyncing" | "totalQuestionCount" | "filteredQuestions" | "selectedLeftIds" | "selectedLeftIdsSet" | "onLeftBankClick"
>;

const ComposeQuestionList = memo(function ComposeQuestionList({
  contentSyncing,
  totalQuestionCount,
  filteredQuestions,
  selectedLeftIds,
  selectedLeftIdsSet,
  onLeftBankClick,
}: ComposeQuestionListProps) {
  const { t } = useTranslation(["compose", "common", "lib"]);

  return (
    <ul className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2.5">
      {contentSyncing ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_80%,transparent)] p-4 text-sm font-medium text-[var(--or-on-container)]">
          正在更新内容库...
        </div>
      ) : totalQuestionCount === 0 ? (
        <li className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-8 text-center text-sm text-[var(--or-muted)]">
          <p className="font-semibold text-[var(--or-text)] text-[15px]">{t("compose:emptyBank")}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--or-muted)]">
            {t("compose:emptyBankHint")}
          </p>
        </li>
      ) : filteredQuestions.length === 0 ? (
        <li className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-8 text-center text-sm text-[var(--or-muted)]">
          <p className="font-semibold text-[var(--or-text)] text-[15px]">{t("compose:emptyFilter")}</p>
          <p className="mt-2 text-sm text-[var(--or-muted)]">{t("compose:emptyFilterHint")}</p>
        </li>
      ) : (
        filteredQuestions.map((q, index) => {
          const isBundle = q.type === "group";
          const isSelected = selectedLeftIdsSet.has(q.qualified_id);
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
                  "w-full rounded-xl border p-2.5 text-left text-sm transition-all duration-150",
                  isSelected
                    ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
                    : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="or-g49-pill bg-[var(--or-block)] text-[var(--or-muted)] font-medium">
                    {t(`lib:questionTypes.${q.type}`, { defaultValue: q.type })}
                  </span>
                  {isBundle ? (
                    <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)] font-medium">
                      {t("compose:bundleBadge")}
                    </span>
                  ) : null}
                  <span data-question-id={q.qualified_id} className="min-w-0 font-mono text-[13px] text-[var(--or-muted)] [overflow-wrap:anywhere]">
                    {q.qualified_id}
                  </span>
                </div>
                <QuestionHoverDetails id={q.qualified_id}>
                  <KatexPlainPreview
                    text={q.content_preview}
                    className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[var(--or-muted)] [&_.katex]:text-[0.95em]"
                  />
                </QuestionHoverDetails>
                {Object.keys(q.metadata ?? {}).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(q.metadata ?? {}).map(([k, v]) => (
                      <span
                        key={k}
                        className="or-g49-pill bg-[var(--or-block)] text-[var(--or-muted)] text-[13px] px-2 py-0.5"
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
  );
});

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
  const activeFilterCount =
    Number(namespaceFilter !== "__all__") +
    Number(typeFilter !== "__all__") +
    Number(Boolean(search.trim())) +
    Number(hasActiveMetadataFilters(metadataFilters));

  return (
    <section
      className="flex max-h-[25vh] w-full min-w-0 shrink-0 flex-col border-[var(--or-outline)] bg-[var(--or-card)] md:max-h-none md:w-60 md:border-r xl:w-72"
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
      <div className="border-b border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--or-muted)]">
          {t("compose:bankSearchTitle")}
        </h2>
        <button
          type="button"
          className="mt-2.5 flex w-full items-center justify-between rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] px-3 py-2 text-left text-sm font-medium text-[var(--or-text)] transition-colors hover:bg-[var(--or-block)]"
          onClick={() => onFilterExpandedChange((v) => !v)}
        >
          <span className="flex items-center gap-1.5">
            <span>{t("compose:filter")}</span>
            <span className="or-g49-pill bg-[color-mix(in_srgb,var(--or-inset)_90%,transparent)] text-[var(--or-muted)] text-[13px] px-1.5 py-0.5">
              {activeFilterCount} 项
            </span>
          </span>
          <span className="truncate pl-2 text-[13px] font-normal text-[var(--or-muted)]">
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
            className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-label="组卷筛选"
            onClick={() => onFilterExpandedChange(false)}
          >
            <div
              className="or-g49-dialog-surface max-h-[85vh] w-full max-w-lg overflow-auto p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--or-text)]">筛选题目</h3>
                <button
                  type="button"
                  aria-label="关闭组卷筛选"
                  className="rounded-lg p-1 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-muted)] text-lg leading-none"
                  onClick={() => onFilterExpandedChange(false)}
                >
                  ×
                </button>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("compose:subjectForExport")}
                  <AppSelect
                    className="or-g49-input mt-1 w-full"
                    value={subject}
                    onValueChange={(value) => onSubjectChange(value)}
                  >
                    {subjectOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("compose:collection")}
                  <AppSelect
                    className="or-g49-input mt-1 w-full"
                    value={namespaceFilter}
                    onValueChange={(value) => onNamespaceFilterChange(value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    {namespaces.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("compose:questionType")}
                  <AppSelect
                    className="or-g49-input mt-1 w-full"
                    value={typeFilter}
                    onValueChange={(value) => onTypeFilterChange(value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    <option value="group">{t("compose:groupOption")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("compose:search")}
                  <input
                    className="or-g49-input mt-1 w-full placeholder:text-[var(--or-muted)]"
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
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => onFilterExpandedChange(false)}
                  className="or-g49-btn or-g49-btn-primary"
                >
                  查看结果
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ComposeQuestionList
        contentSyncing={contentSyncing}
        totalQuestionCount={totalQuestionCount}
        filteredQuestions={filteredQuestions}
        selectedLeftIds={selectedLeftIds}
        selectedLeftIdsSet={selectedLeftIdsSet}
        onLeftBankClick={onLeftBankClick}
      />
    </section>
  );
}
