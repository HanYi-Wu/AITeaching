import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react";
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
import { Select as AppSelect } from "../../components/ui/select";

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
    <div className="or-g49-compose-paper-content">
      <div className="or-g49-compose-actions flex w-full shrink-0 flex-row flex-nowrap items-center justify-start gap-1.5 overflow-x-auto border-y border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-block)_70%,transparent)] px-2 py-2.5 touch-pan-x">
        <button
          type="button"
          disabled={!selectedTpl}
          className="or-g49-btn or-g49-btn-secondary px-2 py-1 text-xs font-medium"
          title="按当前筛选题目补齐各大题空缺；保留已选题目，不重复添加"
          onClick={onFillSectionGaps}
        >
          补齐空缺
        </button>
        <button
          type="button"
          title={t("compose:addToSection")}
          aria-label={t("compose:addToSection")}
          onClick={onAddFromLeft}
          className="or-g49-add-from-left flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-2 text-[var(--or-text)] shadow-sm transition-colors hover:bg-[var(--or-page)]"
        >
          <ChevronRight className="h-4 w-4 shrink-0" />
          <span className="or-g49-compose-action-label whitespace-nowrap text-xs">{t("compose:addToSection")}</span>
        </button>
        <button
          type="button"
          title={t("compose:removeFromPaper")}
          aria-label={t("compose:removeFromPaper")}
          onClick={onRemoveFromRight}
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-2 text-[var(--or-text)] shadow-sm transition-colors hover:bg-[var(--or-page)]"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" />
          <span className="or-g49-compose-action-label whitespace-nowrap text-xs">{t("compose:removeFromPaper")}</span>
        </button>
        <button
          type="button"
          title={t("compose:moveUp")}
          aria-label={t("compose:moveUp")}
          disabled={!canMoveRight}
          onClick={() => onMoveSelectedRight("up")}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] shadow-sm transition-colors hover:bg-[var(--or-page)] disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={t("compose:moveDown")}
          aria-label={t("compose:moveDown")}
          disabled={!canMoveRight}
          onClick={() => onMoveSelectedRight("down")}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] shadow-sm transition-colors hover:bg-[var(--or-page)] disabled:opacity-40"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>

      <section className="or-g49-compose-paper-body min-h-0 min-w-0 flex-1 basis-0 overflow-auto bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-4">
        {currentExamId ? (
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-3 text-sm">
            <span className="font-medium text-[var(--or-muted)]">当前试卷归类</span>
            <AppSelect
              aria-label="组卷所在文件夹"
              value={composeFolderItems[currentExamId] ?? ""}
              onValueChange={(value) => onAssignCurrentExamFolder(currentExamId, value)}
              className="or-g49-input py-1 text-sm"
            >
              <option value="">未归类</option>
              {composeFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </AppSelect>
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
            className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-300 bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] px-4 py-2.5 text-sm text-[var(--or-on-warning)]"
          >
            <span className="font-medium">{t("compose:draftRecoveryBanner")}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onRestoreLocalDraft}
                className="or-g49-btn bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 text-sm px-3 py-1.5"
              >
                {t("compose:restoreLocalDraft")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDiscardLocalDraft}
                className="or-g49-btn border border-amber-300 bg-[var(--or-card)] text-[var(--or-on-warning)] hover:bg-[var(--or-warning-container)] disabled:opacity-50 text-sm px-3 py-1.5"
              >
                {t("compose:discardLocalDraft")}
              </button>
            </div>
          </div>
        ) : null}

        {draftStorageStatus === "corrupted_cleared" ? (
          <div
            data-testid="compose-draft-storage-warning"
            className="mb-3.5 rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] px-3.5 py-2 text-sm text-[var(--or-on-warning)]"
          >
            {t("compose:draftCorruptedNotice")}
          </div>
        ) : draftStorageStatus === "quota_exceeded" || draftStorageStatus === "storage_error" ? (
          <div
            data-testid="compose-draft-storage-warning"
            className="mb-3.5 rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] px-3.5 py-2 text-sm text-[var(--or-on-warning)]"
          >
            {t("compose:draftQuotaNotice")}
          </div>
        ) : !draftScopeReady && isDirty ? (
          <div
            data-testid="compose-draft-scope-notice"
            className="mb-3.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-block)] px-3.5 py-2 text-sm text-[var(--or-muted)]"
          >
            {t("compose:draftScopeUnavailableHint")}
          </div>
        ) : null}

        <div className="or-g49-static-card mb-4 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--or-outline)] pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !canUndo}
                onClick={onUndo}
                title={t("compose:undoShortcutTitle")}
                aria-label={t("compose:undo")}
                className="or-g49-btn or-g49-btn-secondary py-1 px-2.5 text-sm font-medium disabled:opacity-40"
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
                className="or-g49-btn or-g49-btn-secondary py-1 px-2.5 text-sm font-medium disabled:opacity-40"
              >
                <Redo2 className="h-3.5 w-3.5" />
                {t("compose:redo")}
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--or-muted)]">
                {t("compose:examLabel")}
              </p>
              <p title={exportLabel.trim() || undefined} className="mt-0.5 truncate text-[15px] font-semibold text-[var(--or-text)]">
                {exportLabel.trim() || "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--or-muted)]">
                {t("compose:subjectPdf")}
              </p>
              <p title={subject.trim() || undefined} className="mt-0.5 truncate text-[15px] font-semibold text-[var(--or-text)]">
                {subject.trim() || "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--or-muted)]">
                {t("compose:template")}
              </p>
              <p title={selectedTpl?.id} className="mt-0.5 truncate text-[15px] font-semibold text-[var(--or-text)]">
                {selectedTpl?.id ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[13px] font-medium text-[var(--or-muted)]">
                {t("compose:totalScoreLabel")}
              </p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-[var(--or-text)]">{totalScore}</p>
            </div>
          </div>
          <div className="mt-3 border-t border-[var(--or-outline)] pt-3">
            <p className="text-sm font-medium text-[var(--or-muted)]">
              {t("compose:knowledgeDistributionTitle")}
            </p>
            {knowledgeDistributionRows.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--or-muted)]">
                {t("compose:knowledgeDistributionEmpty")}
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {knowledgeDistributionRows.map(([name, n]) => (
                  <li
                    key={name}
                    className="or-g49-pill bg-[var(--or-block)] text-[var(--or-text)]"
                  >
                    <span>{name === "__unassigned__" ? t("compose:knowledgeUnassigned") : name}</span>
                    <span className="ml-1 text-[var(--or-muted)]">· {n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {contentSyncing ? null : (
          templatesCount === 0 && (
            <div role="status" className="mb-3.5 flex shrink-0 items-start gap-2.5 border-y border-[var(--or-warning)] bg-[var(--or-warning-container)] px-3.5 py-3 text-sm leading-relaxed text-[var(--or-on-warning)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0 font-medium">{t("compose:templatesMissing")}</p>
            </div>
          )
        )}

        <div className="space-y-4">
          <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:w-fit sm:grid-cols-[auto_minmax(18rem,1fr)] sm:items-center sm:gap-3">
            <label htmlFor="compose-active-section" className="min-w-0 text-sm font-medium text-[var(--or-muted)]">
              {t("compose:activeSection")}
            </label>
            <AppSelect
              id="compose-active-section"
              aria-label={t("compose:activeSection")}
              title={selectedTpl?.sections.find((section) => section.section_id === activeSection)?.section_id ?? ""}
              className="or-g49-input min-h-11 w-full min-w-0 px-3 py-2 text-sm sm:min-w-[18rem] sm:max-w-[36rem]"
              value={activeSection ?? ""}
              onValueChange={(value) => onActiveSectionChange(value || null)}
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
            </AppSelect>
          </div>

          {selectedTpl?.sections.map((s) => {
            const n = bySection[s.section_id]?.length ?? 0;
            const isText = s.type === "text";
            const isPractice = s.type === "practice";
            const ok = isSectionSatisfied(s, bySection, countBySection);
            const sectionBaseScore = scoreBySection[s.section_id] ?? s.score_per_item;
            const slots = clusterAdjacentGroupSlots(bySection[s.section_id] ?? [], new Map(questionMap));
            const isActive = activeSection === s.section_id;

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
                  "rounded-2xl border bg-[var(--or-card)] p-4 transition-all duration-150",
                  isActive
                    ? "border-[var(--or-primary)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)]"
                    : "border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] hover:border-[var(--or-outline)]",
                )}
              >
                <div className="border-b border-[var(--or-outline)] pb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-[var(--or-text)]">{s.section_id}</h3>
                      <div className="flex items-center gap-2">
                        {isText ? (
                          <>
                            <span className="text-sm text-[var(--or-muted)]">{t("compose:textSectionLine")}</span>
                            {ok && (
                              <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)]">
                                {t("compose:configured")}
                              </span>
                            )}
                          </>
                        ) : isPractice ? (
                          <>
                            <span className="text-sm text-[var(--or-muted)]">{t("compose:practicePickedCount", { n })}</span>
                            {ok && (
                              <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)]">
                                {t("compose:satisfied")}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-[var(--or-muted)]">
                              {t("compose:pickedCount", {
                                n,
                                need: getSectionRequiredCount(s, countBySection),
                              })}
                            </span>
                            {ok && (
                              <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)]">
                                {t("compose:satisfied")}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {s.describe ? (
                      <p className="mt-1 line-clamp-3 text-sm text-[var(--or-muted)]">{s.describe}</p>
                    ) : null}

                    {!isText ? (
                      <div
                        className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--or-outline)] pt-2.5"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {s.type !== "practice" ? (
                          <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--or-muted)]">
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
                              className="or-g49-input w-20 py-1 text-sm tabular-nums"
                            />
                          </label>
                        ) : null}
                        <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--or-muted)]">
                          {t("compose:scorePerItem")}
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            className="or-g49-input w-20 py-1 text-sm tabular-nums"
                            value={scoreBySection[s.section_id] ?? s.score_per_item}
                            onChange={(e) =>
                              onSectionScorePerItemChange(s.section_id, e.target.value)
                            }
                          />
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--or-muted)]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
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
                <ul className="space-y-2 pt-3">
                  {isText ? (
                    <li className="py-2 text-center text-sm text-[var(--or-muted)]">
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
                                  "w-full rounded-xl border p-2.5 text-left text-sm transition-all duration-150",
                                  selectedHere
                                    ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
                                    : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] hover:border-[var(--or-outline)] hover:bg-[var(--or-card)]",
                                )}
                              >
                                <span title={qid} className="font-mono text-[13px] font-medium text-[var(--or-text)] [overflow-wrap:anywhere]">
                                  {qid}
                                </span>
                                <QuestionHoverDetails id={qid}>
                                  <KatexPlainPreview
                                    text={questionMap.get(qid)?.content_preview ?? ""}
                                    className="line-clamp-2 text-sm leading-relaxed text-[var(--or-muted)] [&_.katex]:text-[0.95em]"
                                  />
                                </QuestionHoverDetails>
                                {perQuestionMode[s.section_id] ? (
                                  <div
                                    className="mt-2 flex items-center gap-2 border-t border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] pt-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="text-[13px] font-medium text-[var(--or-muted)]">
                                      {t("compose:scoreThisQuestion")}
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      className="or-g49-input w-20 py-0.5 text-sm tabular-nums"
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
                                "w-full rounded-xl border p-2.5 text-left text-sm transition-all duration-150",
                                selectedHere
                                  ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
                                  : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] hover:border-[var(--or-outline)] hover:bg-[var(--or-card)]",
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)] font-medium">
                                  {t("compose:groupBadge", { count: slot.qids.length })}
                                </span>
                                <span className="font-mono text-[13px] text-[var(--or-text)] [overflow-wrap:anywhere]">
                                  {slot.rep.group_id}
                                </span>
                              </div>
                              <p className="mt-1 font-mono text-[13px] leading-normal text-[var(--or-muted)] [overflow-wrap:anywhere]">
                                {slot.qids.join(" · ")}
                              </p>
                              <QuestionHoverDetails id={headQid}>
                                <KatexPlainPreview
                                  text={prevText ?? ""}
                                  className="line-clamp-2 text-sm leading-relaxed text-[var(--or-muted)] [&_.katex]:text-[0.95em]"
                                />
                              </QuestionHoverDetails>
                              {perQuestionMode[s.section_id] ? (
                                <div
                                  className="mt-2 flex items-center gap-2 border-t border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] pt-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-[13px] font-medium text-[var(--or-muted)]">
                                    {t("compose:groupScore")}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    className="or-g49-input w-20 py-0.5 text-sm tabular-nums"
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
                        <li className="py-3 text-center text-sm text-[var(--or-muted)]">
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
          <p className="mt-3 text-sm text-[var(--or-muted)]">{t("compose:exportWhenReady")}</p>
        )}
      </section>
    </div>
  );
}
