import {
  type LegacyRef,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Plus, Minus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { QUESTION_TYPE_OPTIONS, isChoiceQuestionType } from "../lib/questionTypes";
import { ChoiceOptionsFields } from "./ChoiceOptionsFields";
import { LatexRichTextField } from "./LatexRichTextField";
import { readAnswerLogic } from '../lib/answerLogic';
import { AnswerRelationEditor } from './AnswerRelationEditor';
import { KatexText } from './KatexText';
import type {
  BankQuestionEditorPanelProps,
  GiLatexMemberField,
} from "./bankEditorTypes";
import {
  addGroupSubItem,
  getUnifiedUiInfo,
  giFieldId,
  parseGroupMemberIndex,
  removeLastGroupSubItem,
  resolveEditorSaveAction,
  updateCategoryMetaRow,
  updateGroupMaterial,
  updateGroupMemberField,
  updateGroupMemberOptions,
  updateGroupMemberType,
  updateGroupUnifiedType,
  updateSingleQuestionType,
} from "./bankEditorAdapters";
import { Select as AppSelect } from "./ui/select";

const NOOP_SUBSCRIBE = (_listener: () => void) => () => undefined;

export type {
  QuestionJson,
  GroupMemberJson,
  QuestionGroupJson,
  BankDetailState,
  BankQuestionEditorPanelProps,
  MetaRow,
  GiLatexMemberField,
  EmbedKind,
  MathFieldKey,
} from "./bankEditorTypes";
export { giFieldId } from "./bankEditorAdapters";

function BankGiLatexField({
  memberIndex,
  field,
  label,
  value,
  minRows,
  onChange,
  beginMermaidEmbed,
  beginPrimeBrushEmbed,
  beginImageEmbed,
  busy,
  hideToolbar,
}: {
  memberIndex: number;
  field: GiLatexMemberField;
  label: string;
  value: string;
  minRows: number;
  onChange: (next: string) => void;
  beginMermaidEmbed: BankQuestionEditorPanelProps["beginMermaidEmbed"];
  beginPrimeBrushEmbed: BankQuestionEditorPanelProps["beginPrimeBrushEmbed"];
  beginImageEmbed: BankQuestionEditorPanelProps["beginImageEmbed"];
  busy: boolean;
  hideToolbar: boolean;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const syncId = giFieldId(memberIndex, field);
  return (
    <div className="block">
      {label ? <span className="mb-1 block text-sm font-medium text-[var(--or-muted)]">{label}</span> : null}
      <LatexRichTextField
        textAreaRef={textAreaRef}
        syncTextAreaId={syncId}
        minRows={minRows}
        value={value}
        onChange={onChange}
        onRequestMermaid={(sel) => beginMermaidEmbed({ k: "gi", i: memberIndex, f: field }, sel)}
        onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed({ k: "gi", i: memberIndex, f: field }, sel)}
        onRequestImage={(sel) => beginImageEmbed({ k: "gi", i: memberIndex, f: field }, sel)}
        busy={busy}
        hideToolbar={hideToolbar}
      />
    </div>
  );
}

export function BankQuestionEditorPanel({
  panelMode = "full",
  detail: initialDetail,
  setDetail: initialSetDetail,
  draftStore,
  busy,
  editorTab,
  setEditorTab,
  rawYaml: initialRawYaml,
  setRawYaml: initialSetRawYaml,
  metaRows: initialMetaRows,
  setMetaRows: initialSetMetaRows,
  contentRef,
  answerRef,
  analysisRef,
  materialGroupRef,
  imageInputRef,
  beginMathEmbed,
  beginMermaidEmbed,
  beginPrimeBrushEmbed,
  beginImageEmbed,
  onImageFileSelected,
  onRemove,
  onSave,
  onSaveYaml,
  onClose,
  removeLabel,
  embedded = false,
}: BankQuestionEditorPanelProps) {
  const { t } = useTranslation(["lib", "components", "bank"]);
  const fallbackDraft = useMemo(
    () => ({ detail: initialDetail, rawYaml: initialRawYaml, metaRows: initialMetaRows }),
    [initialDetail, initialRawYaml, initialMetaRows],
  );
  const draft = useSyncExternalStore(
    draftStore?.subscribe ?? NOOP_SUBSCRIBE,
    draftStore?.getSnapshot ?? (() => fallbackDraft),
    draftStore?.getSnapshot ?? (() => fallbackDraft),
  );
  const detail = draftStore ? draft.detail ?? initialDetail : initialDetail;
  // Keep writes flowing through the session hook's wrapped setters. They update
  // the external snapshot and synchronously maintain dirty/switch-confirm state.
  const setDetail = initialSetDetail;
  const rawYaml = draftStore ? draft.rawYaml : initialRawYaml;
  const setRawYaml = initialSetRawYaml;
  const metaRows = draftStore ? draft.metaRows : initialMetaRows;
  const setMetaRows = initialSetMetaRows;
  const removeText = removeLabel ?? t("bank:remove");
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);
  const qg = detail.question_group;
  /** 同型题组：与 synthetic question id 的 __01 后缀对应；整组编辑时为 0 */
  const memberIdx = useMemo(() => parseGroupMemberIndex(detail.question.id), [detail.question.id]);

  const { unifiedUi, innerTypeForItems } = useMemo(() => getUnifiedUiInfo(qg), [qg]);

  const tabsValue =
    panelMode === "full" ? editorTab : panelMode === "form" ? "form" : "yaml";
  const showTabSwitch = panelMode === "full";

  const runSave = () => {
    return resolveEditorSaveAction(panelMode, editorTab) === "yaml" ? onSaveYaml() : onSave();
  };

  return (
    <div
      className={
        embedded
          ? "mx-auto w-full max-w-3xl"
          : "mx-auto max-w-3xl rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] p-3.5 shadow-sm sm:p-5"
      }
    >
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--or-outline)] pb-4">
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono text-sm font-semibold text-[var(--or-text)] sm:text-base">{detail.qualified_id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onClose && (
              <button
                type="button"
                className="or-button or-pill inline-flex h-9 items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
                onClick={onClose}
              >
                {t("components:bankEditor.close")}
              </button>
            )}
            <button
              type="button"
              className="or-button or-button-danger or-pill inline-flex h-9 items-center justify-center rounded-full border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_50%,transparent)] px-3.5 text-sm font-medium text-[var(--or-on-error)] hover:bg-[color-mix(in_srgb,var(--or-error-container)_60%,transparent)] active:bg-[var(--or-error-container)] transition-colors disabled:opacity-50"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              {removeText}
            </button>
            <button
              type="button"
              className="or-button or-button-primary or-pill inline-flex h-9 items-center justify-center rounded-full bg-[var(--or-primary)] px-4 text-sm font-medium text-[var(--or-on-primary)] shadow-sm hover:bg-[var(--or-primary)] active:bg-slate-950 transition-colors disabled:opacity-50"
              disabled={busy}
              onClick={() => void runSave()}
            >
              {t("components:bankEditor.save")}
            </button>
          </div>
        </div>
      ) : null}

      <Tabs
        value={tabsValue}
        onValueChange={
          showTabSwitch ? (v) => setEditorTab(v as "form" | "yaml") : () => undefined
        }
        className={embedded ? "mt-0" : "mt-4"}
      >
        <TabsList
          className={showTabSwitch ? "or-tabs grid w-full max-w-xs grid-cols-2 rounded-full bg-[var(--or-block)] p-1" : "hidden"}
          aria-hidden={!showTabSwitch}
        >
          <TabsTrigger value="form" className="or-tab rounded-full py-1 text-sm font-medium transition-all data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-sm">
            {t("components:bankEditor.tabForm")}
          </TabsTrigger>
          <TabsTrigger value="yaml" className="or-tab rounded-full py-1 text-sm font-medium transition-all data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-sm">
            {t("components:bankEditor.tabYaml")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="mt-4 space-y-4 text-sm">
          <input
            ref={imageInputRef as LegacyRef<HTMLInputElement>}
            type="file"
            accept="image/*"
            className="hidden"
            aria-hidden
            onChange={(e) => void onImageFileSelected(e)}
          />
          <div className="or-surface flex flex-col items-start justify-between gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3.5 sm:flex-row sm:items-center sm:gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--or-text)]">{advancedToolsOpen ? "高级编辑模式" : "简单编辑模式"}</p>
              {advancedToolsOpen ? (
                <p className="text-[13px] text-[var(--or-muted)]">公式、绘图、图表、表格与图片工具已展开。</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setAdvancedToolsOpen((value) => !value)}
              className="or-button or-pill inline-flex w-full shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-4 py-1.5 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-block)] active:bg-[var(--or-inset)] transition-colors sm:w-auto"
            >
              {advancedToolsOpen ? "返回简单模式" : "展开公式与绘图工具"}
            </button>
          </div>
          {!qg && (
            <label className="block text-sm font-medium text-[var(--or-muted)]">
              分类（可自定义）
              <input
                aria-label="题目分类"
                className="or-input mt-1 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                placeholder="例如：课前练习、单元复习、易错题"
                value={metaRows.find((row) => row.key === 'category')?.value ?? ''}
                onChange={(e) => setMetaRows(updateCategoryMetaRow(metaRows, e.target.value))}
              />
            </label>
          )}
          {qg ? (
            <>
              <p className="rounded-xl border border-[color-mix(in_srgb,var(--or-success)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-success-container)_70%,transparent)] px-3 py-2 text-[13px] text-[var(--or-on-success)]">
                {t("components:bankEditor.groupHint", { id: detail.question.id })}
              </p>
              <label className="block text-sm font-medium text-[var(--or-muted)]">
                {t("components:bankEditor.groupRootId")}
                <input
                  className="or-input mt-1 w-full cursor-not-allowed rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-3 py-2 font-mono text-sm text-[var(--or-muted)]"
                  readOnly
                  value={qg.id}
                />
              </label>
              <label className="block text-sm font-medium text-[var(--or-muted)]">
                {t("components:bankEditor.unified")}
                <AppSelect
                  className="or-select mt-1 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                  value={unifiedUi}
                  onValueChange={(value) => {
                    setDetail(updateGroupUnifiedType(detail, value));
                  }}
                >
                  <option value="mixed">{t("components:bankEditor.mixedOpt")}</option>
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(`lib:questionTypes.${o.value}`)}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <div className="block">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.sharedLatex")}</span>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                      onClick={() => {
                        const el = materialGroupRef.current;
                        const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                        beginMathEmbed({ k: "gm" }, sel);
                      }}
                    >
                      {t("components:bankEditor.insertMath")}
                    </button>
                    <button
                      type="button"
                      className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                      onClick={() => {
                        const el = materialGroupRef.current;
                        const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                        beginMermaidEmbed({ k: "gm" }, sel);
                      }}
                    >
                      {t("components:bankEditor.insertDiagram")}
                    </button>
                    <button
                      type="button"
                      className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                      onClick={() => {
                        const el = materialGroupRef.current;
                        const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                        beginPrimeBrushEmbed({ k: "gm" }, sel);
                      }}
                    >
                      绘图
                    </button>
                    <button
                      type="button"
                      className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors disabled:opacity-50"
                      disabled={busy}
                      title={t("components:bankEditor.insertImageTitle")}
                      onClick={() => {
                        const el = materialGroupRef.current;
                        const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                        beginImageEmbed({ k: "gm" }, sel);
                      }}
                    >
                      <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="hidden sm:inline">{t("components:bankEditor.image")}</span>
                    </button>
                  </div>
                </div>
                <LatexRichTextField
                  textAreaRef={materialGroupRef}
                  minRows={5}
                  value={qg.material}
                  onChange={(next) => {
                    setDetail(updateGroupMaterial(detail, next));
                  }}
                  onRequestMermaid={(sel) => beginMermaidEmbed({ k: "gm" }, sel)}
                  onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed({ k: "gm" }, sel)}
                  onRequestImage={(sel) => beginImageEmbed({ k: "gm" }, sel)}
                  busy={busy}
                  hideToolbar={!advancedToolsOpen}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
                  onClick={() => {
                    setDetail(addGroupSubItem(detail, unifiedUi, innerTypeForItems));
                  }}
                >
                  {t("components:bankEditor.addSub")}
                </button>
                {qg.items.length > 1 && (
                  <button
                    type="button"
                    className="or-button or-button-danger or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_40%,transparent)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-on-error)] hover:bg-[color-mix(in_srgb,var(--or-error-container)_50%,transparent)] active:bg-[var(--or-error-container)] transition-colors"
                    onClick={() => {
                      setDetail(removeLastGroupSubItem(detail));
                    }}
                  >
                    {t("components:bankEditor.removeLastSub")}
                  </button>
                )}
              </div>
              {qg.items.map((it, i) => (
                <div key={i} className="or-surface rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4 space-y-3">
                  <p className="text-sm font-semibold text-[var(--or-text)]">
                    {t("components:bankEditor.subItem", { n: i + 1 })}
                  </p>
                  {unifiedUi === "mixed" && (
                    <label className="block text-sm font-medium text-[var(--or-muted)]">
                      {t("components:bankEditor.fieldType")}
                      <AppSelect
                        className="or-select mt-1 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                        value={it.type ?? "single_choice"}
                        onValueChange={(value) => {
                          setDetail(updateGroupMemberType(detail, i, value));
                        }}
                      >
                        {QUESTION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t(`lib:questionTypes.${o.value}`)}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}
                  <div className="block">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.fieldContent")}</span>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                          onClick={() => {
                            const el = document.getElementById(giFieldId(i, "content")) as HTMLTextAreaElement | null;
                            const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                            beginMathEmbed({ k: "gi", i, f: "content" }, sel);
                          }}
                        >
                          {t("components:bankEditor.insertMath")}
                        </button>
                        <button
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                          onClick={() => {
                            const el = document.getElementById(giFieldId(i, "content")) as HTMLTextAreaElement | null;
                            const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                            beginMermaidEmbed({ k: "gi", i, f: "content" }, sel);
                          }}
                        >
                          {t("components:bankEditor.insertDiagram")}
                        </button>
                        <button
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                          onClick={() => {
                            const el = document.getElementById(giFieldId(i, "content")) as HTMLTextAreaElement | null;
                            const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                            beginPrimeBrushEmbed({ k: "gi", i, f: "content" }, sel);
                          }}
                        >
                          绘图
                        </button>
                        <button
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors disabled:opacity-50"
                          disabled={busy}
                          title={t("components:bankEditor.insertImageTitle")}
                          onClick={() => {
                            const el = document.getElementById(giFieldId(i, "content")) as HTMLTextAreaElement | null;
                            const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                            beginImageEmbed({ k: "gi", i, f: "content" }, sel);
                          }}
                        >
                          <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="hidden sm:inline">{t("components:bankEditor.image")}</span>
                        </button>
                      </div>
                    </div>
                    <BankGiLatexField
                      memberIndex={i}
                      field="content"
                      label=""
                      value={it.content}
                      minRows={4}
                      onChange={(next) => {
                        setDetail(updateGroupMemberField(detail, memberIdx, i, "content", next));
                      }}
                      beginMermaidEmbed={beginMermaidEmbed}
                      beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                      beginImageEmbed={beginImageEmbed}
                      busy={busy}
                      hideToolbar={!advancedToolsOpen}
                    />
                  </div>
                  {(unifiedUi === "mixed" ? isChoiceQuestionType(it.type) : isChoiceQuestionType(innerTypeForItems)) && (
                    <div className="mt-2">
                      <ChoiceOptionsFields
                        options={it.options ?? { A: "", B: "", C: "", D: "" }}
                        onCommit={(opts) => {
                          setDetail(updateGroupMemberOptions(detail, memberIdx, i, opts));
                        }}
                        idPrefix={`bank-opt-gi-${i}`}
                        busy={busy}
                        makeEmbedKind={(key) => ({ k: "gio", i, key })}
                        beginMermaidEmbed={beginMermaidEmbed}
                        beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                        beginImageEmbed={beginImageEmbed}
                        hideToolbar={!advancedToolsOpen}
                      />
                    </div>
                  )}
                  <div className="mt-2">
                    <AnswerRelationEditor teacher value={it.answer} onChange={next => {
                      setDetail(updateGroupMemberField(detail, memberIdx, i, "answer", next));
                    }} />
                    {readAnswerLogic(it.answer) ? <KatexText text={it.answer} /> : <BankGiLatexField
                      memberIndex={i}
                      field="answer"
                      label={t("components:bankEditor.fieldAnswer")}
                      value={it.answer}
                      minRows={2}
                      onChange={(next) => {
                        setDetail(updateGroupMemberField(detail, memberIdx, i, "answer", next));
                      }}
                      beginMermaidEmbed={beginMermaidEmbed}
                      beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                      beginImageEmbed={beginImageEmbed}
                      busy={busy}
                      hideToolbar={!advancedToolsOpen}
                    />}
                  </div>
                  <div className="mt-2">
                    <BankGiLatexField
                      memberIndex={i}
                      field="analysis"
                      label={t("components:bankEditor.fieldAnalysis")}
                      value={it.analysis ?? ""}
                      minRows={2}
                      onChange={(next) => {
                        setDetail(updateGroupMemberField(detail, memberIdx, i, "analysis", next));
                      }}
                      beginMermaidEmbed={beginMermaidEmbed}
                      beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                      beginImageEmbed={beginImageEmbed}
                      busy={busy}
                      hideToolbar={!advancedToolsOpen}
                    />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <label className="block text-sm font-medium text-[var(--or-muted)]">
                {t("components:bankEditor.fieldId")}
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-3 py-2 font-mono text-sm text-[var(--or-muted)] cursor-not-allowed"
                  value={detail.question.id}
                  readOnly
                  title="题目编号创建后不可在此修改，避免与题库路径不一致"
                />
              </label>
              <label className="block text-sm font-medium text-[var(--or-muted)]">
                {t("components:bankEditor.fieldType")}
                <AppSelect
                  className="mt-1 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                  value={detail.question.type}
                  onValueChange={(value) => {
                    setDetail({
                      ...detail,
                      question: updateSingleQuestionType(detail.question, value),
                    });
                  }}
                >
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(`lib:questionTypes.${o.value}`)}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <div className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.contentLatex")}</span>
                <LatexRichTextField
                  textAreaRef={contentRef}
                  minRows={6}
                  value={detail.question.content}
                  placeholder={t("bank:latexStemPh")}
                  onChange={(next) => setDetail({ ...detail, question: { ...detail.question, content: next } })}
                  onRequestMermaid={(sel) => beginMermaidEmbed({ k: "q", f: "content" }, sel)}
                  onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed({ k: "q", f: "content" }, sel)}
                  onRequestImage={(sel) => beginImageEmbed({ k: "q", f: "content" }, sel)}
                  busy={busy}
                  hideToolbar={!advancedToolsOpen}
                />
              </div>
              {isChoiceQuestionType(detail.question.type) && (
                <div className="mt-2">
                  <ChoiceOptionsFields
                    options={detail.question.options ?? { A: "", B: "", C: "", D: "" }}
                    onCommit={(opts) => setDetail({ ...detail, question: { ...detail.question, options: opts } })}
                    idPrefix="bank-opt-q"
                    busy={busy}
                    makeEmbedKind={(key) => ({ k: "qo", key })}
                    beginMermaidEmbed={beginMermaidEmbed}
                    beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                    beginImageEmbed={beginImageEmbed}
                    hideToolbar={!advancedToolsOpen}
                  />
                </div>
              )}
              <div className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.fieldAnswer")}</span>
                <AnswerRelationEditor teacher value={detail.question.answer} onChange={next => setDetail({ ...detail, question: { ...detail.question, answer: next } })} />
                {readAnswerLogic(detail.question.answer) ? <KatexText text={detail.question.answer} className="rounded-xl border border-[var(--or-success)] bg-[color-mix(in_srgb,var(--or-success-container)_70%,transparent)] p-3 text-sm text-[var(--or-on-success)]" /> : <LatexRichTextField
                  textAreaRef={answerRef}
                  minRows={3}
                  value={detail.question.answer}
                  onChange={(next) => setDetail({ ...detail, question: { ...detail.question, answer: next } })}
                  onRequestMermaid={(sel) => beginMermaidEmbed({ k: "q", f: "answer" }, sel)}
                  onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed({ k: "q", f: "answer" }, sel)}
                  onRequestImage={(sel) => beginImageEmbed({ k: "q", f: "answer" }, sel)}
                  busy={busy}
                  hideToolbar={!advancedToolsOpen}
                />}
              </div>
              <div className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.fieldAnalysis")}</span>
                <LatexRichTextField
                  textAreaRef={analysisRef}
                  minRows={3}
                  value={detail.question.analysis}
                  onChange={(next) => setDetail({ ...detail, question: { ...detail.question, analysis: next } })}
                  onRequestMermaid={(sel) => beginMermaidEmbed({ k: "q", f: "analysis" }, sel)}
                  onRequestPrimeBrush={(sel) => beginPrimeBrushEmbed({ k: "q", f: "analysis" }, sel)}
                  onRequestImage={(sel) => beginImageEmbed({ k: "q", f: "analysis" }, sel)}
                  busy={busy}
                  hideToolbar={!advancedToolsOpen}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--or-muted)]">{t("components:bankEditor.tagsCustomFields")}</p>
                <div className="mt-2 space-y-2">
                  {metaRows.map((row, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                      <input
                        className="min-w-0 flex-1 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-sm text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                        placeholder={t("components:bankEditor.keyPh")}
                        value={row.key}
                        onChange={(e) => {
                          const next = [...metaRows];
                          next[i] = { ...row, key: e.target.value };
                          setMetaRows(next);
                        }}
                      />
                      <input
                        className="min-w-0 flex-1 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-sm text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
                        placeholder={t("components:bankEditor.valuePh")}
                        value={row.value}
                        onChange={(e) => {
                          const next = [...metaRows];
                          next[i] = { ...row, value: e.target.value };
                          setMetaRows(next);
                        }}
                      />
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] hover:text-[var(--or-on-error)] transition-colors"
                        onClick={() => setMetaRows(metaRows.filter((_, j) => j !== i))}
                        aria-label="删除此字段"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="or-button or-pill or-g48-pill-btn or-g48-pill-dropdown rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
                    onClick={() => setMetaRows([...metaRows, { key: "", value: "" }])}
                  >
                    <Plus className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="text-center">{t("components:bankEditor.addField")}</span>
                    <span className="h-4 w-4 shrink-0" aria-hidden />
                  </button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="yaml" className="mt-4">
          <textarea
            className="or-input w-full rounded-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-3.5 font-mono text-sm leading-relaxed focus:bg-[var(--or-card)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)]"
            rows={24}
            value={rawYaml}
            onChange={(e) => setRawYaml(e.target.value)}
          />
          <p className="mt-2 text-[13px] text-[var(--or-muted)]">
            {qg ? t("components:bankEditor.saveHintGroup") : t("components:bankEditor.saveHintSingle")}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
