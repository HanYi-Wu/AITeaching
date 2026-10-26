import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { MetadataFilterControls } from "../../components/MetadataFilterControls";
import { useToolBar } from "../../contexts/ToolBarContext";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import { isImeComposingKeyboardEvent } from "../../lib/ime";
import { cn } from "../../lib/utils";
import type { MetadataFilters, MetadataFilterDefinition } from "../../lib/metadataFilters";
import type { BankListItem } from "./bankModel";

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

  // Right area
  selectedId: string | null;
  hasDetail: boolean;
  dirty: boolean;
  onSave: () => void | Promise<void>;
}

export function BankToolbar(props: BankToolbarProps) {
  const {
    busy,
    selectedExportIds,
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
    selectedId,
    hasDetail,
    dirty,
    onSave,
  } = props;

  const { t } = useTranslation(["bank", "lib", "common"]);
  const { setToolBar, clearToolBar } = useToolBar();

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
      if (e.composedPath().includes(root)) return;
      setBankFilterMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBankFilterMenuOpen(false);
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
      if (e.composedPath().includes(root)) return;
      if (!busy) setBankNewQuestionOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setBankNewQuestionOpen(false);
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
      if (e.composedPath().includes(root)) return;
      setBankImportOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBankImportOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [bankImportOpen]);

  useEffect(() => {
    const left: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        {/* 筛选菜单 */}
        <div className="relative shrink-0" ref={bankFilterDropdownRef}>
          <button
            type="button"
            className={cn(
              "flex max-w-[min(100vw-8rem,20rem)] items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-left text-xs font-medium text-slate-800 hover:bg-slate-50",
              bankFilterMenuOpen && "border-slate-400 bg-slate-100",
            )}
            aria-expanded={bankFilterMenuOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setBankNewQuestionOpen(false);
              setBankImportOpen(false);
              setBankFilterMenuOpen((v) => !v);
            }}
          >
            <span className="shrink-0">{t("filter")}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="truncate text-[10px] font-normal text-slate-500">
                {bankFilterSummary}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200",
                  bankFilterMenuOpen && "rotate-180",
                )}
                aria-hidden
              />
            </span>
          </button>
          {bankFilterMenuOpen ? (
            <div
              className="absolute left-0 top-full z-[100] mt-1 w-72 max-h-[min(70vh,28rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg"
              role="dialog"
              aria-label={t("filter")}
            >
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("subject")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm"
                    value={filterSubject}
                    onChange={(e) => {
                      setFilterSubject(e.target.value);
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
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("questionType")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="__all__">{t("filterAllLabel")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("search")}
                  <input
                    className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || isImeComposingKeyboardEvent(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      commitSearch(e.currentTarget.value);
                    }}
                    onBlur={(e) => commitSearch(e.currentTarget.value)}
                    placeholder={t("searchPlaceholder")}
                  />
                </label>
                <MetadataFilterControls
                  definitions={metadataFilterDefinitions}
                  filters={metadataFilters}
                  onChange={setMetadataFilters}
                />
                <label className="block text-xs">
                  分类
                  <select
                    aria-label="题目分类筛选"
                    className="mt-1 w-full rounded border p-2"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
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
                  </select>
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
              "flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50",
              bankNewQuestionOpen && "border-slate-400 bg-slate-100",
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
            {t("newQuestion")}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200",
                bankNewQuestionOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {bankNewQuestionOpen ? (
            <div
              className="absolute left-0 top-full z-[100] mt-1 w-80 max-h-[min(85vh,32rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg"
              role="dialog"
              aria-label={t("newQuestion")}
            >
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("newSubject")}
                  <div className="mt-0.5 space-y-1">
                    <select
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                      value={newSubjectSelectValue}
                      onChange={(e) =>
                        setNewSubject(e.target.value === "__custom__" ? "" : e.target.value)
                      }
                    >
                      {importSubjectList.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      <option value="__custom__">{t("otherSubject")}</option>
                    </select>
                    {newSubjectSelectValue === "__custom__" && (
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        value={newSubject}
                        onChange={(e) => setNewSubject(e.target.value)}
                        placeholder={t("newSubjectPh")}
                      />
                    )}
                  </div>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("newId")}
                  <input
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                  />
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("newType")}
                  <select
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                  >
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {newType === "group" && (
                  <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
                    <label className="block text-[11px] font-medium text-slate-600">
                      {t("subItemMode")}
                      <select
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                        value={newGroupUnified}
                        onChange={(e) => setNewGroupUnified(e.target.value)}
                      >
                        <option value="mixed">{t("mixedMode")}</option>
                        {QUESTION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t("sameType", { label: t(`lib:questionTypes.${o.value}`) })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[11px] font-medium text-slate-600">
                      {t("sharedMaterial")}
                      <textarea
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
                        rows={4}
                        value={newGroupMaterial}
                        onChange={(e) => setNewGroupMaterial(e.target.value)}
                        placeholder={t("sharedMaterialPh")}
                      />
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  className="w-full rounded-md border border-slate-300 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                  disabled={busy || !newSubject.trim() || !newCollection.trim() || !newId.trim()}
                  onClick={async () => {
                    const ok = await onCreateQuestion();
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
              "flex max-w-[min(100vw-8rem,22rem)] items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50",
              bankImportOpen && "border-slate-400 bg-slate-100",
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
            <span className="shrink-0">{t("importToolbar")}</span>
            <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
              <span className="truncate text-[10px] font-normal text-slate-500">
                {importSummaryHint}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200",
                  bankImportOpen && "rotate-180",
                )}
                aria-hidden
              />
            </span>
          </button>
          {bankImportOpen ? (
            <div
              className="absolute left-0 top-full z-[100] mt-1 w-80 max-h-[min(85vh,32rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg"
              role="dialog"
              aria-label={t("importToolbar")}
            >
              <p className="text-[10px] leading-snug text-slate-500">{t("importFormats")}</p>
              <label className="mt-2 block text-[11px] font-medium text-slate-600">
                {t("targetSubject")}
                {importSubjectList.length > 0 ? (
                  <div className="mt-0.5 space-y-1">
                    <select
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                      value={importSubjectSelectValue}
                      onChange={(e) => {
                        const v = e.target.value;
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
                    </select>
                    {importSubjectSelectValue === "__custom__" && (
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        value={importSubject}
                        onChange={(e) => setImportSubject(e.target.value)}
                        placeholder={t("folderNamePh")}
                      />
                    )}
                  </div>
                ) : (
                  <input
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
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
                  const ok = await onImportFile(e);
                  if (ok !== false) {
                    setBankImportOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="mt-2 w-full rounded-md bg-slate-900 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => importFileRef.current?.click()}
              >
                {t("importChooseFile")}
              </button>
              <details className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
                <summary className="cursor-pointer text-[11px] font-medium text-slate-700">
                  {t("pasteYaml")}
                </summary>
                <p className="mt-1 text-[10px] text-slate-500">{t("pasteYamlHint")}</p>
                <textarea
                  className="mt-2 w-full rounded border border-slate-300 bg-white font-mono text-xs"
                  rows={5}
                  placeholder={t("pasteYamlTextareaPh")}
                  value={importYaml}
                  onChange={(e) => setImportYaml(e.target.value)}
                />
                <button
                  type="button"
                  className="mt-2 w-full rounded-md border border-slate-800 bg-slate-50 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50"
                  disabled={busy || !importYaml.trim()}
                  onClick={async () => {
                    const ok = await onImportYaml();
                    if (ok !== false) {
                      setBankImportOpen(false);
                    }
                  }}
                >
                  {t("importToCollection")}
                </button>
              </details>
            </div>
          ) : null}
        </div>

        {/* 导出按钮 */}
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || selectedExportIds.length === 0}
          title={selectedExportIds.length === 0 ? "先在左侧勾选题目" : undefined}
          onClick={() => void onExport()}
        >
          导出已选（{selectedExportIds.length}）
        </button>
      </div>
    );

    const right: ReactNode =
      selectedId && hasDetail ? (
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-[11px] text-amber-700">{t("common:unsavedHint")}</span>
          ) : null}
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            disabled={busy || !dirty}
            onClick={() => void onSave()}
          >
            {t("components:bankEditor.save")}
          </button>
        </div>
      ) : null;

    setToolBar({ left, right });
    return () => clearToolBar();
  }, [
    t,
    busy,
    selectedExportIds,
    onExport,
    bankFilterMenuOpen,
    bankFilterSummary,
    filterSubject,
    filterType,
    filterCategory,
    searchInput,
    commitSearch,
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
    onCreateQuestion,
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
    onImportFile,
    onImportYaml,
    setImportSubject,
    setImportYaml,
    selectedId,
    hasDetail,
    dirty,
    onSave,
    setToolBar,
    clearToolBar,
  ]);

  return null;
}
