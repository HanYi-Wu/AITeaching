import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Filter, Plus, Upload, Download, Save } from "lucide-react";
import { MetadataFilterControls } from "../../components/MetadataFilterControls";
import { useToolBarActions } from "../../contexts/ToolBarContext";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import { isImeComposingKeyboardEvent } from "../../lib/ime";
import { cn } from "../../lib/utils";
import type { MetadataFilters, MetadataFilterDefinition } from "../../lib/metadataFilters";
import type { BankListItem } from "./bankModel";
import type { BankImportTransactionState } from "./sessionCore/types";
import "../../ui-redesign/g48/g48-bank.css";
import { Select as AppSelect } from "../../components/ui/select";

function isBankSelectContentTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-or-select-content]") !== null;
}

export interface BankToolbarProps {
  busy: boolean;
  selectedExportIds: string[];
  onExport: () => void | Promise<void>;

  // Filter menu
  subjects: string[];
  items: BankListItem[];
  filterSubject: string;
  setFilterSubject: (v: string) => void;
  setFilterCollection: (v: string) => void;
  filterType: string;
  setFilterType: (v: string) => void;
  filterCategory: string;
  setFilterCategory: (v: string) => void;
  metadataFilters: MetadataFilters;
  setMetadataFilters: (v: MetadataFilters) => void;
  metadataFilterDefinitions: MetadataFilterDefinition[];
  searchInput: string;
  setSearchInput: (v: string) => void;
  commitSearch: (v: string) => void;
  bankFilterSummary: string;

  // New question
  importSubjectList: string[];
  newSubject: string;
  setNewSubject: (v: string) => void;
  newSubjectSelectValue: string;
  newCollection: string;
  newId: string;
  setNewId: (v: string) => void;
  newType: string;
  setNewType: (v: string) => void;
  newGroupUnified: string;
  setNewGroupUnified: (v: string) => void;
  newGroupMaterial: string;
  setNewGroupMaterial: (v: string) => void;
  onCreateQuestion: () => Promise<boolean | void>;

  // Import
  importSubject: string;
  setImportSubject: (v: string) => void;
  importSubjectSelectValue: string;
  importSummaryHint: string;
  importYaml: string;
  setImportYaml: (v: string) => void;
  onImportFile: (e: ChangeEvent<HTMLInputElement>) => Promise<boolean | void>;
  onImportYaml: () => Promise<boolean | void>;
  importTransaction?: BankImportTransactionState;
  onRetryRefreshOnly?: () => Promise<boolean | void>;

  // Right area
  selectedId: string | null;
  hasDetail: boolean;
  dirty: boolean;
  onSave: () => void | Promise<void>;
}

export function BankToolbar(props: BankToolbarProps) {
  const {
    busy,
    selectedExportIds = [],
    onExport,
    subjects,
    items,
    filterSubject,
    setFilterSubject,
    setFilterCollection,
    filterType,
    setFilterType,
    filterCategory,
    setFilterCategory,
    metadataFilters,
    setMetadataFilters,
    metadataFilterDefinitions,
    searchInput,
    setSearchInput,
    commitSearch,
    bankFilterSummary,
    importSubjectList,
    newSubject,
    setNewSubject,
    newSubjectSelectValue,
    newCollection,
    newId,
    setNewId,
    newType,
    setNewType,
    newGroupUnified,
    setNewGroupUnified,
    newGroupMaterial,
    setNewGroupMaterial,
    onCreateQuestion,
    importSubject,
    setImportSubject,
    importSubjectSelectValue,
    importSummaryHint,
    importYaml,
    setImportYaml,
    onImportFile,
    onImportYaml,
    importTransaction,
    onRetryRefreshOnly,
    selectedId,
    hasDetail,
    dirty,
    onSave,
  } = props;

  const { t } = useTranslation(["bank", "lib", "common"]);
  const { setToolBar, clearToolBar } = useToolBarActions();
  const searchDraftRef = useRef(searchInput);
  const commitSearchDraft = useCallback((value: string) => {
    searchDraftRef.current = value;
    setSearchInput(value);
    commitSearch(value);
  }, [commitSearch, setSearchInput]);

  const callbacksRef = useRef({
    onExport,
    onCreateQuestion,
    onImportFile,
    onImportYaml,
    onRetryRefreshOnly,
    onSave,
  });
  callbacksRef.current = {
    onExport,
    onCreateQuestion,
    onImportFile,
    onImportYaml,
    onRetryRefreshOnly,
    onSave,
  };

  useEffect(() => {
    return () => clearToolBar();
  }, [clearToolBar]);

  const [bankFilterMenuOpen, setBankFilterMenuOpen] = useState(false);
  const bankFilterDropdownRef = useRef<HTMLDivElement | null>(null);

  const [bankNewQuestionOpen, setBankNewQuestionOpen] = useState(false);
  const bankNewQuestionRef = useRef<HTMLDivElement | null>(null);

  const [bankImportOpen, setBankImportOpen] = useState(false);
  const bankImportRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Close filter dropdown on outside click or Escape
  useEffect(() => {
    if (!bankFilterMenuOpen) return;
    const root = bankFilterDropdownRef.current;
    if (!root) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.composedPath().includes(root) || isBankSelectContentTarget(e.target)) return;
      setBankFilterMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBankSelectContentTarget(e.target)) setBankFilterMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [bankFilterMenuOpen]);

  // Close new question dropdown on outside click or Escape
  useEffect(() => {
    if (!bankNewQuestionOpen) return;
    const root = bankNewQuestionRef.current;
    if (!root) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.composedPath().includes(root) || isBankSelectContentTarget(e.target)) return;
      if (!busy) setBankNewQuestionOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBankSelectContentTarget(e.target) && !busy) setBankNewQuestionOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [bankNewQuestionOpen, busy]);

  // Close import dropdown on outside click or Escape
  useEffect(() => {
    if (!bankImportOpen) return;
    const root = bankImportRef.current;
    if (!root) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.composedPath().includes(root) || isBankSelectContentTarget(e.target)) return;
      setBankImportOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBankSelectContentTarget(e.target)) setBankImportOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [bankImportOpen]);

  useEffect(() => {
    const left: ReactNode = (
      <div className="flex flex-wrap items-center gap-2 py-0.5">
        {/* 筛选菜单 */}
        <div className="relative shrink-0" ref={bankFilterDropdownRef}>
          <button
            type="button"
            className={cn(
              "or-button or-pill or-g48-pill-btn or-g48-pill-dropdown max-w-[min(100vw-2rem,22rem)] px-3.5 py-1.5 text-sm",
              bankFilterMenuOpen && "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] text-[var(--or-on-container)]",
            )}
            aria-expanded={bankFilterMenuOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setBankNewQuestionOpen(false);
              setBankImportOpen(false);
              setBankFilterMenuOpen((v) => !v);
            }}
          >
            <Filter className="h-4 w-4 shrink-0 text-[var(--or-muted)]" aria-hidden />
            <span className="inline-flex min-w-0 items-center justify-center gap-1.5 text-center">
              <span className="font-medium text-[var(--or-text)]">{t("filter")}</span>
              <span className="hidden max-w-[8rem] truncate text-[13px] text-[var(--or-muted)] sm:inline">
                {bankFilterSummary}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--or-muted)] transition-transform duration-200",
                bankFilterMenuOpen && "rotate-180 text-[var(--or-on-container)]",
              )}
              aria-hidden
            />
          </button>
          {bankFilterMenuOpen ? (
            <div
              className="or-g48-dialog fixed inset-x-3 top-14 z-[100] max-h-[min(75vh,30rem)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto p-4 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1.5 sm:w-[21rem]"
              role="dialog"
              aria-label={t("filter")}
            >
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("subject")}
                  <AppSelect
                    className="or-select or-g48-input mt-1 w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                    value={filterSubject}
                    onValueChange={(value) => {
                      setFilterSubject(value);
                      setFilterCollection("__all__");
                    }}
                  >
                    <option value="__all__">{t("filterAllLabel")}</option>
                    {(subjects.length
                      ? subjects
                      : [...new Set(items.map((i) => i.subject).filter(Boolean) as string[])]
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("questionType")}
                  <AppSelect
                    className="or-select or-g48-input mt-1 w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                    value={filterType}
                    onValueChange={(value) => setFilterType(value)}
                  >
                    <option value="__all__">{t("filterAllLabel")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("search")}
                  <input
                    className="or-input or-g48-input mt-1 w-full"
                    defaultValue={searchDraftRef.current}
                    onChange={(e) => {
                      searchDraftRef.current = e.currentTarget.value;
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || isImeComposingKeyboardEvent(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      commitSearchDraft(e.currentTarget.value);
                    }}
                    onBlur={(e) => commitSearchDraft(e.currentTarget.value)}
                    placeholder={t("searchPlaceholder")}
                  />
                </label>
                <MetadataFilterControls
                  definitions={metadataFilterDefinitions}
                  filters={metadataFilters}
                  onChange={setMetadataFilters}
                />
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  分类
                  <AppSelect
                    aria-label="题目分类筛选"
                    className="or-select or-g48-input mt-1 w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                    value={filterCategory}
                    onValueChange={(value) => setFilterCategory(value)}
                  >
                    <option value="__all__">全部分类</option>
                    {[
                      ...new Set([
                        "未分类",
                        ...items.map((it) => String(it.metadata?.category || "未分类")),
                      ]),
                    ]
                      .sort()
                      .map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                  </AppSelect>
                </label>
              </div>
            </div>
          ) : null}
        </div>

        {/* 新建题目菜单 */}
        <div className="relative shrink-0" ref={bankNewQuestionRef}>
          <button
            type="button"
            className={cn(
              "or-button or-pill or-g48-pill-btn or-g48-pill-dropdown px-3.5 py-1.5 text-sm",
              bankNewQuestionOpen && "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] text-[var(--or-on-container)]",
            )}
            disabled={busy}
            aria-expanded={bankNewQuestionOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setBankFilterMenuOpen(false);
              setBankImportOpen(false);
              setBankNewQuestionOpen((v) => !v);
            }}
          >
            <Plus className="h-4 w-4 shrink-0 text-[var(--or-muted)]" aria-hidden />
            <span className="font-medium text-[var(--or-text)] text-center">{t("newQuestion")}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--or-muted)] transition-transform duration-200",
                bankNewQuestionOpen && "rotate-180 text-[var(--or-on-container)]",
              )}
              aria-hidden
            />
          </button>
          {bankNewQuestionOpen ? (
            <div
              className="or-g48-dialog fixed inset-x-3 top-14 z-[100] max-h-[min(85vh,34rem)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto p-4 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1.5 sm:w-[22rem]"
              role="dialog"
              aria-label={t("newQuestion")}
            >
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("newSubject")}
                  <div className="mt-1 space-y-1.5">
                    <AppSelect
                      className="or-select or-g48-input w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                      value={newSubjectSelectValue}
                      onValueChange={(value) =>
                        setNewSubject(value === "__custom__" ? "" : value)
                      }
                    >
                      {importSubjectList.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      <option value="__custom__">{t("otherSubject")}</option>
                    </AppSelect>
                    {newSubjectSelectValue === "__custom__" && (
                      <input
                        className="or-input or-g48-input w-full"
                        value={newSubject}
                        onChange={(e) => setNewSubject(e.target.value)}
                        placeholder={t("newSubjectPh")}
                      />
                    )}
                  </div>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("newId")}
                  <input
                    className="or-input or-g48-input mt-1 w-full font-mono text-sm"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]">
                  {t("newType")}
                  <AppSelect
                    className="or-select or-g48-input mt-1 w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                    value={newType}
                    onValueChange={(value) => setNewType(value)}
                  >
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                {newType === "group" && (
                  <div className="space-y-2.5 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3">
                    <label className="block text-sm font-medium text-[var(--or-muted)]">
                      {t("subItemMode")}
                      <AppSelect
                        className="or-select or-g48-input mt-1 w-full bg-[var(--or-card)]"
                        value={newGroupUnified}
                        onValueChange={(value) => setNewGroupUnified(value)}
                      >
                        <option value="mixed">{t("mixedMode")}</option>
                        {QUESTION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t("sameType", { label: t(`lib:questionTypes.${o.value}`) })}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="block text-sm font-medium text-[var(--or-muted)]">
                      {t("sharedMaterial")}
                      <textarea
                        className="or-input or-g48-input mt-1 w-full bg-[var(--or-card)] font-mono text-sm leading-relaxed"
                        rows={3}
                        value={newGroupMaterial}
                        onChange={(e) => setNewGroupMaterial(e.target.value)}
                        placeholder={t("sharedMaterialPh")}
                      />
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  className="or-button or-button-primary or-g48-pill-btn or-g48-pill-btn-primary mt-1 w-full justify-center py-2 text-sm"
                  disabled={busy || !newSubject.trim() || !newCollection.trim() || !newId.trim()}
                  onClick={async () => {
                    const ok = await callbacksRef.current.onCreateQuestion();
                    if (ok !== false) {
                      setBankNewQuestionOpen(false);
                    }
                  }}
                >
                  {newType === "group" ? t("createGroup") : t("createDraft")}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 导入菜单 */}
        <div className="relative shrink-0" ref={bankImportRef}>
          <button
            type="button"
            className={cn(
              "or-button or-pill or-g48-pill-btn or-g48-pill-dropdown max-w-[min(100vw-2rem,24rem)] px-3.5 py-1.5 text-sm",
              bankImportOpen && "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] text-[var(--or-on-container)]",
            )}
            disabled={busy}
            aria-expanded={bankImportOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setBankFilterMenuOpen(false);
              setBankNewQuestionOpen(false);
              setBankImportOpen((v) => !v);
            }}
          >
            <Upload className="h-4 w-4 shrink-0 text-[var(--or-muted)]" aria-hidden />
            <span className="inline-flex min-w-0 items-center justify-center gap-1.5 text-center">
              <span className="font-medium text-[var(--or-text)]">{t("importToolbar")}</span>
              <span className="hidden max-w-[7rem] truncate text-[13px] text-[var(--or-muted)] sm:inline">
                {importSummaryHint}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--or-muted)] transition-transform duration-200",
                bankImportOpen && "rotate-180 text-[var(--or-on-container)]",
              )}
              aria-hidden
            />
          </button>
          {bankImportOpen ? (
            <div
              className="or-g48-dialog fixed inset-x-3 top-14 z-[100] max-h-[min(85vh,34rem)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto p-4 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1.5 sm:w-[22rem]"
              role="dialog"
              aria-label={t("importToolbar")}
            >
              <p className="text-[13px] leading-relaxed text-[var(--or-muted)]">{t("importFormats")}</p>
              <label className="mt-3 block text-sm font-medium text-[var(--or-muted)]">
                {t("targetSubject")}
                {importSubjectList.length > 0 ? (
                  <div className="mt-1 space-y-1.5">
                    <AppSelect
                      className="or-select or-g48-input w-full bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]"
                      value={importSubjectSelectValue}
                      onValueChange={(value) => {
                        const v = value;
                        if (v === "__custom__") {
                          setImportSubject("");
                        } else {
                          setImportSubject(v);
                        }
                      }}
                    >
                      {importSubjectList.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      <option value="__custom__">{t("otherSubject")}</option>
                    </AppSelect>
                    {importSubjectSelectValue === "__custom__" && (
                      <input
                        className="or-input or-g48-input w-full"
                        value={importSubject}
                        onChange={(e) => setImportSubject(e.target.value)}
                        placeholder={t("folderNamePh")}
                      />
                    )}
                  </div>
                ) : (
                  <input
                    className="or-input or-g48-input mt-1 w-full"
                    value={importSubject}
                    onChange={(e) => setImportSubject(e.target.value)}
                    placeholder={t("folderNamePh")}
                  />
                )}
              </label>
              <input
                ref={importFileRef}
                type="file"
                accept=".yaml,.yml,.zip,application/zip,application/x-yaml,text/yaml"
                className="hidden"
                aria-hidden
                onChange={async (e) => {
                  const ok = await callbacksRef.current.onImportFile(e);
                  if (ok !== false) {
                    setBankImportOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="or-button or-button-primary or-g48-pill-btn or-g48-pill-btn-primary mt-3 w-full justify-center py-2 text-sm"
                disabled={busy}
                onClick={() => importFileRef.current?.click()}
              >
                {t("importChooseFile")}
              </button>
              <details className="mt-3 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--or-muted)]">
                  {t("pasteYaml")}
                </summary>
                <p className="mt-1 text-[13px] text-[var(--or-muted)]">{t("pasteYamlHint")}</p>
                <textarea
                  className="or-input or-g48-input mt-2 w-full bg-[var(--or-card)] font-mono text-sm leading-relaxed"
                  rows={4}
                  placeholder={t("pasteYamlTextareaPh")}
                  value={importYaml}
                  onChange={(e) => setImportYaml(e.target.value)}
                />
                <button
                  type="button"
                  className="or-button or-button-tonal or-g48-pill-btn or-g48-pill-btn-tonal mt-2 w-full justify-center py-1.5 text-sm font-semibold"
                  disabled={busy || !importYaml.trim()}
                  onClick={async () => {
                    const ok = await callbacksRef.current.onImportYaml();
                    if (ok !== false) {
                      setBankImportOpen(false);
                    }
                  }}
                >
                  {t("importToCollection")}
                </button>
              </details>
              {importTransaction?.result ? (
                <div className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--or-success-container)_80%,transparent)] p-3 text-[13px] text-[var(--or-on-success)]">
                  <p className="font-semibold text-[var(--or-on-success)]">
                    已写入 {importTransaction.result.written} 题至 {importTransaction.result.namespace}
                  </p>
                  {importTransaction.result.warnings?.length ? (
                    <p className="mt-1 text-[var(--or-on-warning)] whitespace-pre-wrap">
                      提示: {importTransaction.result.warnings.join("\n")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {importTransaction?.stage === "refresh_failed" ? (
                <div className="mt-3 rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] p-3 text-[13px] text-[var(--or-on-warning)]">
                  <p className="font-semibold">题目已安全写入，但列表刷新失败</p>
                  <button
                    type="button"
                    className="or-button or-button-primary or-g48-pill-btn or-g48-pill-btn-primary mt-2 w-full justify-center py-1.5 text-sm"
                    onClick={() => void callbacksRef.current.onRetryRefreshOnly?.()}
                  >
                    重试刷新列表
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 导出按钮 */}
        <button
          type="button"
          className={cn(
            "or-button or-pill or-g48-pill-btn or-g48-pill-dropdown px-3.5 py-1.5 text-sm",
            (selectedExportIds?.length ?? 0) > 0 && "or-g48-pill-btn-tonal font-semibold",
          )}
          disabled={busy || (selectedExportIds?.length ?? 0) === 0}
          title={(selectedExportIds?.length ?? 0) === 0 ? "先在左侧勾选题目" : undefined}
          onClick={() => void callbacksRef.current.onExport()}
        >
          <Download className="h-4 w-4 shrink-0 text-[var(--or-muted)]" aria-hidden />
          <span className="text-center">导出已选（{selectedExportIds?.length ?? 0}）</span>
          <span className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </div>
    );

    const right: ReactNode =
      selectedId && hasDetail ? (
        <div className="flex items-center gap-2.5 py-0.5">
          {dirty ? (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--or-on-warning)]">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              {t("common:unsavedHint")}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(
              "or-button or-pill or-g48-pill-btn or-g48-pill-dropdown px-4 py-1.5 text-sm font-semibold",
              dirty ? "or-button-primary or-g48-pill-btn-primary shadow-sm" : "opacity-40 cursor-not-allowed",
            )}
            disabled={busy || !dirty}
            onClick={() => void callbacksRef.current.onSave()}
          >
            <Save className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-center">{t("components:bankEditor.save")}</span>
            <span className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        </div>
      ) : null;

    setToolBar({ left, right });
  }, [
    t,
    busy,
    selectedExportIds,
    bankFilterMenuOpen,
    bankFilterSummary,
    filterSubject,
    filterType,
    filterCategory,
    searchInput,
    commitSearchDraft,
    metadataFilterDefinitions,
    metadataFilters,
    subjects,
    items,
    setFilterSubject,
    setFilterCollection,
    setFilterType,
    setSearchInput,
    setMetadataFilters,
    setFilterCategory,
    bankNewQuestionOpen,
    newSubjectSelectValue,
    importSubjectList,
    newSubject,
    newId,
    newType,
    newGroupUnified,
    newGroupMaterial,
    newCollection,
    setNewSubject,
    setNewId,
    setNewType,
    setNewGroupUnified,
    setNewGroupMaterial,
    bankImportOpen,
    importSummaryHint,
    importSubjectSelectValue,
    importSubject,
    importYaml,
    importTransaction,
    setImportSubject,
    setImportYaml,
    selectedId,
    hasDetail,
    dirty,
    setToolBar,
  ]);

  return null;
}
