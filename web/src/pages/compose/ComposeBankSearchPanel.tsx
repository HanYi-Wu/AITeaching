import { type MouseEvent, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MetadataFilterControls } from "../../components/MetadataFilterControls";
import { isImeComposingKeyboardEvent } from "../../lib/ime";
import {
  hasActiveMetadataFilters,
  type MetadataFilterDefinition,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import type { QuestionRow } from "../../types/compose";
import { Select as AppSelect } from "../../components/ui/select";
import {
  BankSelectionStore,
  BankQuestionList,
  useSelectedBankIds,
} from "./bank-search/rewrite-list";

export type ComposeBankSearchPanelProps = {
  subject: string;
  onSubjectChange: (subject: string) => void;
  subjectOptions: string[];
  namespaceFilter: string;
  onNamespaceFilterChange: (namespace: string) => void;
  namespaces: string[];
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
  search: string;
  onCommitSearch: (value: string) => void;
  searchDraftResetVersion: number;
  metadataFilterDefinitions: MetadataFilterDefinition[];
  metadataFilters: MetadataFilters;
  onMetadataFiltersChange: (filters: MetadataFilters) => void;
  filterExpanded: boolean;
  onFilterExpandedChange: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  contentSyncing: boolean;
  totalQuestionCount: number;
  filteredQuestions: QuestionRow[];
  bankSelectionStore: BankSelectionStore;
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
  search,
  onCommitSearch,
  searchDraftResetVersion,
  metadataFilterDefinitions,
  metadataFilters,
  onMetadataFiltersChange,
  filterExpanded,
  onFilterExpandedChange,
  contentSyncing,
  totalQuestionCount,
  filteredQuestions,
  onLeftBankClick,
  onDropPaperItemToRemove,
  onError,
  bankSelectionStore,
}: ComposeBankSearchPanelProps) {
  const { t } = useTranslation(["compose", "common", "lib"]);
  const searchDraftRef = useRef(search);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const committedSearchRef = useRef(search);
  committedSearchRef.current = search;
  useLayoutEffect(() => {
    const resetValue = committedSearchRef.current;
    searchDraftRef.current = resetValue;
    if (searchInputRef.current) searchInputRef.current.value = resetValue;
  }, [searchDraftResetVersion]);

  const commitSearchDraft = (value: string) => {
    searchDraftRef.current = value;
    onCommitSearch(value);
  };

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
                    ref={searchInputRef}
                    className="or-g49-input mt-1 w-full placeholder:text-[var(--or-muted)]"
                    placeholder={t("compose:searchPlaceholder")}
                    defaultValue={searchDraftRef.current}
                    onChange={(e) => { searchDraftRef.current = e.target.value; }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || isImeComposingKeyboardEvent(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      commitSearchDraft(e.currentTarget.value);
                    }}
                    onBlur={(e) => commitSearchDraft(e.currentTarget.value)}
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
      <BankQuestionList
        contentSyncing={contentSyncing}
        totalQuestionCount={totalQuestionCount}
        filteredQuestions={filteredQuestions}
        store={bankSelectionStore}
        onLeftBankClick={onLeftBankClick}
      />
    </section>
  );
}

export function ComposeBankActionBar({
  store,
  disabled,
  onAdd,
  onFill,
  onEditPaper,
}: {
  store: BankSelectionStore;
  disabled: boolean;
  onAdd: () => void;
  onFill: () => void;
  onEditPaper: () => void;
}) {
  const { t } = useTranslation(["compose"]);
  const selectedIds = useSelectedBankIds(store);

  return (
    <div className="or-g49-bank-actions">
      <button
        type="button"
        className="or-g49-btn or-g49-btn-secondary"
        disabled={disabled}
        onClick={onFill}
      >
        补齐空缺
      </button>
      <button
        type="button"
        className="or-g49-btn or-g49-btn-primary"
        disabled={!selectedIds.length || disabled}
        onClick={onAdd}
      >
        {t("compose:addToSection")}（{selectedIds.length}）
      </button>
      <button
        type="button"
        className="or-g49-btn or-g49-btn-secondary"
        onClick={onEditPaper}
      >
        编辑试卷
      </button>
    </div>
  );
}
