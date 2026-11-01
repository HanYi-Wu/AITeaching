import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import type {
  GraphNodeRow,
  GraphRelationRow,
  PanelTab,
} from "./useGraphStore";
import {
  REL_COLOR,
  REL_KEYS,
  splitCsv,
  useNodePanelState,
  NodeEditSection,
  NodeQuestionsSection,
  NodeFilesSection,
  NodeNotesSection,
} from "./node-panel";

export { REL_COLOR, REL_KEYS, splitCsv };

export interface GraphNodePanelProps {
  selectedNode: GraphNodeRow | null;
  relations: GraphRelationRow[];
  graphNodes: GraphNodeRow[];
  activeSlug: string | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onSaved: () => void;
  /** 侧栏删除后调用（工作区负责乐观更新与 API） */
  onDeleteNode?: () => Promise<void>;
  onDeleted: () => void;
  onError: (e: string | null) => void;
  onClose: () => void;
  /** ID of the edge to highlight in the relations list */
  highlightEdgeId?: string | null;
}

export function GraphNodePanel({
  selectedNode,
  relations,
  graphNodes,
  activeSlug,
  tab,
  onTabChange,
  onSaved,
  onDeleteNode,
  onDeleted,
  onError,
  onClose,
  highlightEdgeId,
}: GraphNodePanelProps) {
  const { t } = useTranslation("graph");

  const state = useNodePanelState({
    selectedNode,
    activeSlug,
    onSaved,
    onDeleteNode,
    onDeleted,
    onError,
  });

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-[var(--or-muted)] ">
        <p>{t("pickNodeFirst")}</p>
      </div>
    );
  }

  const TABS: { id: PanelTab; label: string }[] = [
    { id: "edit", label: t("panelTabEdit") },
    { id: "questions", label: t("panelTabQuestions") },
    { id: "files", label: t("panelTabFiles") },
    { id: "notes", label: t("panelTabNotes") },
  ];

  return (
    <aside className="or-g50-panel flex h-full w-full flex-col overflow-hidden">
      {/* Panel header with tab switcher */}
      <div className="flex items-center justify-between border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_95%,transparent)] px-3 py-2.5 backdrop-blur-sm   gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--or-block)] p-1  overflow-x-auto scrollbar-none min-w-0">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={cn(
                "inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 whitespace-nowrap",
                tab === tb.id
                  ? "bg-[var(--or-card)] text-[var(--or-text)] shadow-sm  "
                  : "text-[var(--or-muted)] hover:text-[var(--or-text)]  dark:hover:text-[var(--or-text)]",
              )}
              onClick={() => onTabChange(tb.id)}
            >
              <span className="inline-block transform translate-y-[0.5px]">
                {tb.label}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="or-g50-btn or-g50-btn-secondary !h-7 !px-2 !text-xs font-medium shrink-0"
          onClick={onClose}
          title={t("collapse")}
        >
          <span>{t("collapse")}</span>
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Tab 1: Node edit + Relations */}
        {tab === "edit" && (
          <NodeEditSection
            selectedNode={selectedNode}
            graphNodes={graphNodes}
            relations={relations}
            highlightEdgeId={highlightEdgeId}
            busy={state.busy}
            draftName={state.draftName}
            setDraftName={state.setDraftName}
            draftSubject={state.draftSubject}
            draftTags={state.draftTags}
            setDraftTags={state.setDraftTags}
            draftAliases={state.draftAliases}
            setDraftAliases={state.setDraftAliases}
            draftKind={state.draftKind}
            setDraftKind={state.setDraftKind}
            draftPrimaryParent={state.draftPrimaryParent}
            setDraftPrimaryParent={state.setDraftPrimaryParent}
            saveEdits={state.saveEdits}
            deleteNode={state.deleteNode}
            relTo={state.relTo}
            setRelTo={state.setRelTo}
            relType={state.relType}
            setRelType={state.setRelType}
            addRelation={state.addRelation}
            removeRelation={state.removeRelation}
            reverseRelation={state.reverseRelation}
            changeRelationType={state.changeRelationType}
          />
        )}

        {/* Tab 2: Bound questions */}
        {tab === "questions" && (
          <NodeQuestionsSection
            busy={state.busy}
            boundQuestions={state.boundQuestions}
            boundSel={state.boundSel}
            setBoundSel={state.setBoundSel}
            bankOpen={state.bankOpen}
            setBankOpen={state.setBankOpen}
            bankItems={state.bankItems}
            bankNs={state.bankNs}
            setBankNs={state.setBankNs}
            bankQ={state.bankQ}
            setBankQ={state.setBankQ}
            bankSubject={state.bankSubject}
            setBankSubject={state.setBankSubject}
            bankType={state.bankType}
            setBankType={state.setBankType}
            bankSel={state.bankSel}
            setBankSel={state.setBankSel}
            openBank={state.openBank}
            bindSelectedQuestions={state.bindSelectedQuestions}
            unbindQ={state.unbindQ}
            unbindSelectedBound={state.unbindSelectedBound}
          />
        )}

        {/* Tab 3: Bound files */}
        {tab === "files" && (
          <NodeFilesSection
            nodeFiles={state.nodeFiles}
            fileOpen={state.fileOpen}
            setFileOpen={state.setFileOpen}
            fileQ={state.fileQ}
            setFileQ={state.setFileQ}
            fileList={state.fileList}
            fileSel={state.fileSel}
            setFileSel={state.setFileSel}
            attachSelectedFiles={state.attachSelectedFiles}
            uploadAndAttach={state.uploadAndAttach}
            detachFile={state.detachFile}
          />
        )}

        {/* Tab 4: Notes */}
        {tab === "notes" && (
          <NodeNotesSection
            selectedNode={selectedNode}
            busy={state.busy}
            notesList={state.notesList}
            noteComposerOpen={state.noteComposerOpen}
            setNoteComposerOpen={state.setNoteComposerOpen}
            noteEditingId={state.noteEditingId}
            setNoteEditingId={state.setNoteEditingId}
            noteDraftBody={state.noteDraftBody}
            setNoteDraftBody={state.setNoteDraftBody}
            noteTextAreaRef={state.noteTextAreaRef}
            persistNotes={state.persistNotes}
          />
        )}
      </div>
    </aside>
  );
}
