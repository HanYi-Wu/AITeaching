import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react";
import { ContentTags } from "../../components/ContentTags";
import { KatexPlainPreview } from "../../components/KatexText";
import { QuestionHoverDetails } from "../../components/QuestionHoverDetails";
import { clusterAdjacentGroupSlots, type SectionSlot } from "../../lib/groupQuestions";
import { cn } from "../../lib/utils";
import type { ContentFolder } from "../../platform/auth";
import type {
  ComposeDraftStorageStatus,
  ComposeLocalDraftRecord,
  ComposePaperState,
  QuestionRow,
  RightSelection,
  TemplateRow,
} from "../../types/compose";
import { sectionTypeToFilter } from "./composeHelpers";
import { OverwriteExportDialog } from "./ComposeDialogs";
import { getSectionRequiredCount, isSectionSatisfied } from "./composeModel";

export type ComposePaperEditorPanelProps = {
  busy: boolean;
  contentSyncing: boolean;
  templatesCount: number;
  selectedTpl: TemplateRow | undefined;
  paperState: ComposePaperState;
  activeSection: string | null;
  onActiveSectionChange: (sectionId: string | null) => void;
  onSelectSectionAndFilter: (sectionId: string, filterType: string) => void;
  countsOk: boolean;
  totalScore: number;
  knowledgeDistributionRows: [string, number][];
  questionMap: ReadonlyMap<string, QuestionRow>;
  selectedRight: RightSelection | null;
  onFillSectionGaps: () => void;
  onAddFromLeft: () => void;
  onRemoveFromRight: () => void;
  onMoveSelectedRight: (direction: "up" | "down") => void;
  onDropBankQuestionsToSection: (questionIds: string[], sectionId: string) => void;
  onRightPaperSlotClick: (
    sectionId: string,
    slots: SectionSlot<QuestionRow>[],
    slotIndex: number,
    slot: SectionSlot<QuestionRow>,
    e: MouseEvent<HTMLButtonElement>,
  ) => void;
  onSectionRequiredCountChange: (sectionId: string, rawValue: string) => void;
  onSectionScorePerItemChange: (sectionId: string, rawValue: string) => void;
  onPerQuestionModeChange: (sectionId: string, enabled: boolean) => void;
  onQuestionScoreOverrideChange: (sectionId: string, qid: string, rawValue: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isDirty: boolean;
  draftScopeReady: boolean;
  draftStorageStatus: ComposeDraftStorageStatus;
  recoverableDraft: ComposeLocalDraftRecord | null;
  onRestoreLocalDraft: () => void;
  onDiscardLocalDraft: () => void;
  currentExamId: string | null;
  composeFolders: ContentFolder[];
  composeFolderItems: Record<string, string>;
  onAssignCurrentExamFolder: (examId: string, folderId: string) => void;
  onRefreshTaggedItems: () => void;
  conflictOpen: boolean;
  onCancelConflictOverwrite: () => void;
  onConfirmConflictOverwrite: () => void;
  onError: (msg: string | null) => void;
};

export function ComposePaperEditorPanel({
  busy,
  contentSyncing,
  templatesCount,
  selectedTpl,
  paperState,
  activeSection,
  onActiveSectionChange,
  onSelectSectionAndFilter,
  countsOk,
  totalScore,
  knowledgeDistributionRows,
  questionMap,
  selectedRight,
  onFillSectionGaps,
  onAddFromLeft,
  onRemoveFromRight,
  onMoveSelectedRight,
  onDropBankQuestionsToSection,
  onRightPaperSlotClick,
  onSectionRequiredCountChange,
  onSectionScorePerItemChange,
  onPerQuestionModeChange,
  onQuestionScoreOverrideChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isDirty,
  draftScopeReady,
  draftStorageStatus,
  recoverableDraft,
  onRestoreLocalDraft,
  onDiscardLocalDraft,
  currentExamId,
  composeFolders,
  composeFolderItems,
  onAssignCurrentExamFolder,
  onRefreshTaggedItems,
  conflictOpen,
  onCancelConflictOverwrite,
  onConfirmConflictOverwrite,
  onError,
}: ComposePaperEditorPanelProps) {
  const { t } = useTranslation(["compose", "common"]);
  const {
    exportLabel,
    subject,
    bySection,
    scoreBySection,
    countBySection,
    scoreOverrides,
    perQuestionMode,
  } = paperState;
  const canMoveRight = Boolean(selectedRight && selectedRight.qids.length > 0);

  return (
    <>
      <div className="flex w-full shrink-0 flex-row items-center justify-center gap-2 border-y border-slate-200 bg-slate-100/90 py-2 md:w-11 md:flex-col md:justify-start md:gap-3 md:border-x md:border-y-0 md:py-4">
        <button
          type="button"
          disabled={!selectedTpl}
          className="rounded border bg-white p-1 text-xs"
          title="按当前筛选题目补齐各大题空缺；保留已选题目，不重复添加"
          onClick={onFillSectionGaps}
        >
          补齐空缺
        </button>
        <button
          type="button"
          title={t("compose:addToSection")}
          onClick={onAddFromLeft}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          title={t("compose:removeFromPaper")}
          onClick={onRemoveFromRight}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          title={t("compose:moveUp")}
          aria-label={t("compose:moveUp")}
          disabled={!canMoveRight}
          onClick={() => onMoveSelectedRight("up")}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={t("compose:moveDown")}
          aria-label={t("compose:moveDown")}
          disabled={!canMoveRight}
          onClick={() => onMoveSelectedRight("down")}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>

      <section className="min-h-0 min-w-0 flex-1 basis-0 overflow-auto bg-slate-50 p-4 lg:min-w-0">
        {currentExamId ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-xs">
            <span>当前试卷归类</span>
            <select
              aria-label="组卷所在文件夹"
              value={composeFolderItems[currentExamId] ?? ""}
              onChange={(event) => onAssignCurrentExamFolder(currentExamId, event.target.value)}
              className="rounded border px-2 py-1"
            >
              <option value="">未归类</option>
              {composeFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <ContentTags
              scope="compose"
              itemId={currentExamId}
              onError={onError}
              onChange={onRefreshTaggedItems}
            />
          </div>
        ) : null}

        <OverwriteExportDialog
          open={conflictOpen}
          busy={busy}
          onCancel={onCancelConflictOverwrite}
          onConfirm={onConfirmConflictOverwrite}
        />

        {recoverableDraft ? (
          <div
            role="region"
            aria-label={t("compose:draftRecoveryTitle")}
            data-testid="compose-draft-recovery-banner"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          >
            <span>{t("compose:draftRecoveryBanner")}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onRestoreLocalDraft}
                className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {t("compose:restoreLocalDraft")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDiscardLocalDraft}
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {t("compose:discardLocalDraft")}
              </button>
            </div>
          </div>
        ) : null}

        {draftStorageStatus === "corrupted_cleared" ? (
          <div
            data-testid="compose-draft-storage-warning"
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
          >
            {t("compose:draftCorruptedNotice")}
          </div>
        ) : draftStorageStatus === "quota_exceeded" || draftStorageStatus === "storage_error" ? (
          <div
            data-testid="compose-draft-storage-warning"
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
          >
            {t("compose:draftQuotaNotice")}
          </div>
        ) : !draftScopeReady && isDirty ? (
          <div
            data-testid="compose-draft-scope-notice"
            className="mb-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-600"
          >
            {t("compose:draftScopeUnavailableHint")}
          </div>
        ) : null}

        <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy || !canUndo}
                onClick={onUndo}
                title={t("compose:undoShortcutTitle")}
                aria-label={t("compose:undo")}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t("compose:undo")}
              </button>
              <button
                type="button"
                disabled={busy || !canRedo}
                onClick={onRedo}
                title={t("compose:redoShortcutTitle")}
                aria-label={t("compose:redo")}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
              >
                <Redo2 className="h-3.5 w-3.5" />
                {t("compose:redo")}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("compose:examLabel")}
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">
                {exportLabel.trim() || "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("compose:subjectPdf")}
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">{subject.trim() || "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("compose:template")}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
                {selectedTpl?.id ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("compose:totalScoreLabel")}
              </p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{totalScore}</p>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-medium text-slate-700">
              {t("compose:knowledgeDistributionTitle")}
            </p>
            {knowledgeDistributionRows.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                {t("compose:knowledgeDistributionEmpty")}
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {knowledgeDistributionRows.map(([name, n]) => (
                  <li
                    key={name}
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-800"
                  >
                    {name === "__unassigned__" ? t("compose:knowledgeUnassigned") : name}
                    <span className="text-slate-500"> · {n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {contentSyncing ? null : (
          templatesCount === 0 && (
            <p className="text-sm text-red-600">{t("compose:templatesMissing")}</p>
          )
        )}

        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {t("compose:activeSection")}
            <select
              className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              value={activeSection ?? ""}
              onChange={(e) => onActiveSectionChange(e.target.value || null)}
            >
              {selectedTpl?.sections.map((s) => (
                <option key={s.section_id} value={s.section_id}>
                  {s.section_id}
                  {s.type === "text"
                    ? t("compose:sectionOptionText")
                    : s.type === "practice"
                      ? t("compose:sectionOptionPractice")
                      : t("compose:sectionOptionNeed", {
                          n: getSectionRequiredCount(s, countBySection),
                        })}
                </option>
              ))}
            </select>
          </p>
          <p className="text-[10px] leading-snug text-slate-500">
            拖回左侧题库可从试卷移除；点击题目可多选后用箭头移除。
          </p>

          {selectedTpl?.sections.map((s) => {
            const n = bySection[s.section_id]?.length ?? 0;
            const isText = s.type === "text";
            const isPractice = s.type === "practice";
            const ok = isSectionSatisfied(s, bySection, countBySection);
            const sectionBaseScore = scoreBySection[s.section_id] ?? s.score_per_item;
            const slots = clusterAdjacentGroupSlots(bySection[s.section_id] ?? [], new Map(questionMap));
            return (
              <div
                key={s.section_id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  onSelectSectionAndFilter(
                    s.section_id,
                    s.type === "text" ? "__all__" : sectionTypeToFilter(s),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectSectionAndFilter(
                      s.section_id,
                      s.type === "text" ? "__all__" : sectionTypeToFilter(s),
                    );
                  }
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("application/x-originreach-bank-qids")) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  const raw = event.dataTransfer.getData("application/x-originreach-bank-qids");
                  if (!raw) return;
                  event.preventDefault();
                  event.stopPropagation();
                  try {
                    onDropBankQuestionsToSection(JSON.parse(raw) as string[], s.section_id);
                  } catch {
                    onError("无法读取拖动的题目");
                  }
                }}
                className={cn(
                  "rounded-xl border bg-white shadow-sm transition-shadow",
                  activeSection === s.section_id
                    ? "border-slate-900 ring-1 ring-slate-900/10"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{s.section_id}</h3>
                    <p className="text-[11px] text-slate-500">
                      {isText ? (
                        <>
                          {t("compose:textSectionLine")}
                          {ok && (
                            <span className="ml-2 text-emerald-600">
                              {t("compose:configured")}
                            </span>
                          )}
                        </>
                      ) : isPractice ? (
                        <>
                          {t("compose:practicePickedCount", { n })}
                          {ok && (
                            <span className="ml-2 text-emerald-600">{t("compose:satisfied")}</span>
                          )}
                        </>
                      ) : (
                        <>
                          {t("compose:pickedCount", {
                            n,
                            need: getSectionRequiredCount(s, countBySection),
                          })}
                          {ok && (
                            <span className="ml-2 text-emerald-600">{t("compose:satisfied")}</span>
                          )}
                        </>
                      )}
                    </p>
                    {s.describe ? (
                      <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">{s.describe}</p>
                    ) : null}
                    {!isText ? (
                      <div
                        className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-50 pt-2"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {s.type !== "practice" ? (
                          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            题目数量
                            <input
                              aria-label={`${s.section_id}题目数量`}
                              type="number"
                              min={0}
                              max={500}
                              value={getSectionRequiredCount(s, countBySection)}
                              onChange={(event) =>
                                onSectionRequiredCountChange(s.section_id, event.target.value)
                              }
                              className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-sm"
                            />
                          </label>
                        ) : null}
                        <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                          {t("compose:scorePerItem")}
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            className="w-20 rounded-md border border-slate-300 px-1.5 py-1 text-sm"
                            value={scoreBySection[s.section_id] ?? s.score_per_item}
                            onChange={(e) =>
                              onSectionScorePerItemChange(s.section_id, e.target.value)
                            }
                          />
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={perQuestionMode[s.section_id] ?? false}
                            onChange={(e) =>
                              onPerQuestionModeChange(s.section_id, e.target.checked)
                            }
                          />
                          {t("compose:perQuestionScores")}
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-1 p-3">
                  {isText ? (
                    <li className="text-center text-xs text-slate-500">
                      {t("compose:textSectionNoPickHere")}
                    </li>
                  ) : (
                    <>
                      {slots.map((slot, si) => {
                        if (slot.kind === "single") {
                          const qid = slot.qid;
                          const selectedHere =
                            selectedRight?.sectionId === s.section_id &&
                            selectedRight.qids.includes(qid);
                          return (
                            <li key={qid}>
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.stopPropagation();
                                  event.dataTransfer.setData(
                                    "application/x-originreach-paper-item",
                                    JSON.stringify({ sectionId: s.section_id, qid }),
                                  );
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRightPaperSlotClick(s.section_id, slots, si, slot, e);
                                }}
                                className={cn(
                                  "w-full rounded-md border px-2 py-2 text-left text-sm",
                                  selectedHere
                                    ? "border-slate-900 bg-slate-100"
                                    : "border-slate-100 bg-slate-50 hover:bg-white",
                                )}
                              >
                                <span className="font-mono text-xs text-slate-800">{qid}</span>
                                <QuestionHoverDetails id={qid}>
                                  <KatexPlainPreview
                                    text={questionMap.get(qid)?.content_preview ?? ""}
                                    className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                  />
                                </QuestionHoverDetails>
                                {perQuestionMode[s.section_id] ? (
                                  <div
                                    className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="text-[10px] text-slate-500">
                                      {t("compose:scoreThisQuestion")}
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                      value={
                                        scoreOverrides[s.section_id]?.[qid] !== undefined
                                          ? scoreOverrides[s.section_id]![qid]
                                          : ""
                                      }
                                      placeholder={String(sectionBaseScore)}
                                      onChange={(e) =>
                                        onQuestionScoreOverrideChange(
                                          s.section_id,
                                          qid,
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                ) : null}
                              </button>
                            </li>
                          );
                        }
                        const headQid = slot.qids[0]!;
                        const mat = slot.rep.group_material?.trim();
                        const prevText = mat
                          ? mat.replace(/\s+/g, " ").slice(0, 120) + (mat.length > 120 ? "…" : "")
                          : questionMap.get(headQid)?.content_preview;
                        const selectedHere =
                          selectedRight?.sectionId === s.section_id &&
                          slot.qids.every((q) => selectedRight.qids.includes(q));
                        return (
                          <li key={`grp-${slot.rep.group_id}-${si}`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRightPaperSlotClick(s.section_id, slots, si, slot, e);
                              }}
                              className={cn(
                                "w-full rounded-md border px-2 py-2 text-left text-sm",
                                selectedHere
                                  ? "border-slate-900 bg-slate-100"
                                  : "border-slate-100 bg-slate-50 hover:bg-white",
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                                  {t("compose:groupBadge", { count: slot.qids.length })}
                                </span>
                                <span className="font-mono text-[11px] text-slate-800">
                                  {slot.rep.group_id}
                                </span>
                              </div>
                              <p className="mt-0.5 font-mono text-[10px] leading-tight text-slate-500">
                                {slot.qids.join(" · ")}
                              </p>
                              <QuestionHoverDetails id={headQid}>
                                <KatexPlainPreview
                                  text={prevText ?? ""}
                                  className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                />
                              </QuestionHoverDetails>
                              {perQuestionMode[s.section_id] ? (
                                <div
                                  className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-[10px] text-slate-500">
                                    {t("compose:groupScore")}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                    value={
                                      scoreOverrides[s.section_id]?.[headQid] !== undefined
                                        ? scoreOverrides[s.section_id]![headQid]
                                        : ""
                                    }
                                    placeholder={String(sectionBaseScore)}
                                    onChange={(e) =>
                                      onQuestionScoreOverrideChange(
                                        s.section_id,
                                        headQid,
                                        e.target.value,
                                      )
                                    }
                                  />
                                </div>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                      {(bySection[s.section_id] ?? []).length === 0 && (
                        <li className="text-center text-xs text-slate-400">
                          {t("compose:emptySlotHint")}
                        </li>
                      )}
                    </>
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        {!countsOk && selectedTpl && (
          <p className="mt-2 text-xs text-slate-500">{t("compose:exportWhenReady")}</p>
        )}
      </section>
    </>
  );
}
