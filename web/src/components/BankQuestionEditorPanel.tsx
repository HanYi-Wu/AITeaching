import {
  type LegacyRef,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus } from "lucide-react";
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
      {label ? <span className="text-xs font-medium text-slate-600">{label}</span> : null}
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
  detail,
  setDetail,
  busy,
  editorTab,
  setEditorTab,
  rawYaml,
  setRawYaml,
  metaRows,
  setMetaRows,
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
          : "mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      }
    >
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="font-mono text-sm text-slate-800">{detail.qualified_id}</p>
            <p className="text-[11px] text-slate-500">
              {t("components:bankEditor.storage", { kind: detail.storage_kind, path: detail.storage_path })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onClose && (
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                onClick={onClose}
              >
                {t("components:bankEditor.close")}
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              {removeText}
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
          className={showTabSwitch ? "grid w-full max-w-md grid-cols-2" : "hidden"}
          aria-hidden={!showTabSwitch}
        >
          <TabsTrigger value="form">{t("components:bankEditor.tabForm")}</TabsTrigger>
          <TabsTrigger value="yaml">{t("components:bankEditor.tabYaml")}</TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="mt-4 space-y-3 text-sm">
          <input
            ref={imageInputRef as LegacyRef<HTMLInputElement>}
            type="file"
            accept="image/*"
            className="hidden"
            aria-hidden
            onChange={(e) => void onImageFileSelected(e)}
          />
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div><p className="text-xs font-semibold text-slate-800">{advancedToolsOpen ? "高级编辑模式" : "简单编辑模式"}</p><p className="text-[11px] text-slate-500">{advancedToolsOpen ? "公式、绘图、图表、表格与图片工具已展开。" : "保留题型、题干、选项、答案、解析和分值；公式可直接输入 $...$。"}</p></div>
            <button type="button" onClick={() => setAdvancedToolsOpen((value) => !value)} className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">{advancedToolsOpen ? "返回简单模式" : "展开公式与绘图工具"}</button>
          </div>
          {!qg && <label className="block text-xs font-medium text-slate-600">分类（可自定义）
            <input aria-label="题目分类" className="mt-1 w-full rounded border p-2" placeholder="例如：课前练习、单元复习、易错题" value={metaRows.find(row => row.key === 'category')?.value ?? ''}
              onChange={e => setMetaRows(updateCategoryMetaRow(metaRows, e.target.value))} />
          </label>}
          {qg ? (
            <>
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                {t("components:bankEditor.groupHint", { id: detail.question.id })}
              </p>
              <label className="block text-xs font-medium text-slate-600">
                {t("components:bankEditor.groupRootId")}
                <input
                  className="mt-1 w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-sm"
                  readOnly
                  value={qg.id}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                {t("components:bankEditor.unified")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={unifiedUi}
                  onChange={(e) => {
                    setDetail(updateGroupUnifiedType(detail, e.target.value));
                  }}
                >
                  <option value="mixed">{t("components:bankEditor.mixedOpt")}</option>
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(`lib:questionTypes.${o.value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="block">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">{t("components:bankEditor.sharedLatex")}</span>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                      className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                      className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                      className="inline-flex items-center gap-0.5 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      disabled={busy}
                      title={t("components:bankEditor.insertImageTitle")}
                      onClick={() => {
                        const el = materialGroupRef.current;
                        const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                        beginImageEmbed({ k: "gm" }, sel);
                      }}
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setDetail(addGroupSubItem(detail, unifiedUi, innerTypeForItems));
                  }}
                >
                  {t("components:bankEditor.addSub")}
                </button>
                {qg.items.length > 1 && (
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setDetail(removeLastGroupSubItem(detail));
                    }}
                  >
                    {t("components:bankEditor.removeLastSub")}
                  </button>
                )}
              </div>
              {qg.items.map((it, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-700">
                    {t("components:bankEditor.subItem", { n: i + 1 })}
                  </p>
                  {unifiedUi === "mixed" && (
                    <label className="mb-2 block text-xs font-medium text-slate-600">
                      {t("components:bankEditor.fieldType")}
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                        value={it.type ?? "single_choice"}
                        onChange={(e) => {
                          setDetail(updateGroupMemberType(detail, i, e.target.value));
                        }}
                      >
                        {QUESTION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t(`lib:questionTypes.${o.value}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">{t("components:bankEditor.fieldContent")}</span>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
                          className="inline-flex items-center gap-0.5 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          disabled={busy}
                          title={t("components:bankEditor.insertImageTitle")}
                          onClick={() => {
                            const el = document.getElementById(giFieldId(i, "content")) as HTMLTextAreaElement | null;
                            const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
                            beginImageEmbed({ k: "gi", i, f: "content" }, sel);
                          }}
                        >
                          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
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
              <label className="block text-xs font-medium text-slate-600">
                {t("components:bankEditor.fieldId")}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                  value={detail.question.id}
                  readOnly
                  title="题目编号创建后不可在此修改，避免与题库路径不一致"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                {t("components:bankEditor.fieldType")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={detail.question.type}
                  onChange={(e) => {
                    setDetail({
                      ...detail,
                      question: updateSingleQuestionType(detail.question, e.target.value),
                    });
                  }}
                >
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(`lib:questionTypes.${o.value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="block">
                <span className="text-xs font-medium text-slate-600">{t("components:bankEditor.contentLatex")}</span>
                <LatexRichTextField
                  textAreaRef={contentRef}
                  minRows={6}
                  value={detail.question.content}
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
                <span className="text-xs font-medium text-slate-600">{t("components:bankEditor.fieldAnswer")}</span>
                <AnswerRelationEditor teacher value={detail.question.answer} onChange={next => setDetail({ ...detail, question: { ...detail.question, answer: next } })} />
                {readAnswerLogic(detail.question.answer) ? <KatexText text={detail.question.answer} className="rounded border bg-emerald-50 p-3 text-sm" /> : <LatexRichTextField
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
                <span className="text-xs font-medium text-slate-600">{t("components:bankEditor.fieldAnalysis")}</span>
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
                <p className="text-xs font-medium text-slate-600">{t("components:bankEditor.tagsCustomFields")}</p>
                <div className="mt-2 space-y-2">
                  {metaRows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        placeholder={t("components:bankEditor.keyPh")}
                        value={row.key}
                        onChange={(e) => {
                          const next = [...metaRows];
                          next[i] = { ...row, key: e.target.value };
                          setMetaRows(next);
                        }}
                      />
                      <input
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
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
                        className="rounded border border-slate-300 px-2 text-xs"
                        onClick={() => setMetaRows(metaRows.filter((_, j) => j !== i))}
                      >
                        −
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-slate-600 underline"
                    onClick={() => setMetaRows([...metaRows, { key: "", value: "" }])}
                  >
                    {t("components:bankEditor.addField")}
                  </button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="yaml" className="mt-4">
          <textarea
            className="w-full rounded-md border border-slate-300 font-mono text-xs leading-relaxed"
            rows={24}
            value={rawYaml}
            onChange={(e) => setRawYaml(e.target.value)}
          />
          <p className="mt-2 text-[11px] text-slate-500">
            {qg ? t("components:bankEditor.saveHintGroup") : t("components:bankEditor.saveHintSingle")}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
