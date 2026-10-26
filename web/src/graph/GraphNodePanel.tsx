import { useTranslation } from "react-i18next";
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
      <div className="flex h-full flex-col items-center justify-center p-4 text-xs text-slate-400">
        {t("pickNodeFirst")}
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
    <aside className="flex h-full w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:w-[380px] lg:max-w-[380px] xl:w-[420px] xl:max-w-[420px]">
      {/* Panel header with tab switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex gap-0.5">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tab === tb.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => onTabChange(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={onClose}
        >
          {t("collapse")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
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
