import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import {
  REL_COLOR,
  REL_KEYS,
  type GraphNodeRow,
  type GraphRelationRow,
} from "./types";

export interface NodeEditSectionProps {
  selectedNode: GraphNodeRow;
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  highlightEdgeId?: string | null;
  busy: boolean;
  draftName: string;
  setDraftName: (v: string) => void;
  draftSubject: string;
  draftTags: string;
  setDraftTags: (v: string) => void;
  draftAliases: string;
  setDraftAliases: (v: string) => void;
  draftKind: "concept" | "skill" | "causal";
  setDraftKind: (v: "concept" | "skill" | "causal") => void;
  draftPrimaryParent: string;
  setDraftPrimaryParent: (v: string) => void;
  saveEdits: () => Promise<void>;
  deleteNode: () => Promise<void>;
  // Relations
  relTo: string;
  setRelTo: (v: string) => void;
  relType: string;
  setRelType: (v: string) => void;
  addRelation: () => Promise<void>;
  removeRelation: (rid: string) => Promise<void>;
  reverseRelation: (rid: string) => Promise<void>;
  changeRelationType: (rid: string, newType: string) => Promise<void>;
}

export function NodeEditSection({
  selectedNode,
  graphNodes,
  relations,
  highlightEdgeId,
  busy,
  draftName,
  setDraftName,
  draftTags,
  setDraftTags,
  draftAliases,
  setDraftAliases,
  draftKind,
  setDraftKind,
  draftPrimaryParent,
  setDraftPrimaryParent,
  saveEdits,
  deleteNode,
  relTo,
  setRelTo,
  relType,
  setRelType,
  addRelation,
  removeRelation,
  reverseRelation,
  changeRelationType,
}: NodeEditSectionProps) {
  const { t } = useTranslation("graph");
  const edgeItemRef = useRef<HTMLLIElement | null>(null);

  // Scroll to highlighted edge
  useEffect(() => {
    if (highlightEdgeId && edgeItemRef.current) {
      edgeItemRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightEdgeId]);

  const relForSelected = relations.filter(
    (r) => r.from_node_id === selectedNode.id || r.to_node_id === selectedNode.id,
  );

  const relationTargetCandidates = graphNodes.filter((n) => {
    if (n.id === selectedNode.id) return false;
    const sk = selectedNode.node_kind ?? "concept";
    const nk = n.node_kind ?? "concept";
    return sk === "concept" || nk === "concept";
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0 text-[11px] font-medium text-slate-600">
          {t("canonicalName")}
          <input
            className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
        </label>
        <label className="block min-w-0 text-[11px] font-medium text-slate-600">
          {t("nodeType")}
          <select
            className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as "concept" | "skill" | "causal")}
          >
            <option value="concept">{t("nodeKind.concept")}</option>
            <option value="skill">{t("nodeKind.skill")}</option>
            <option value="causal">{t("nodeKind.causal")}</option>
          </select>
        </label>
      </div>

      <label className="block text-[11px] font-medium text-slate-600">
        {t("tags")}
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={draftTags}
          onChange={(e) => setDraftTags(e.target.value)}
        />
      </label>

      <label className="block text-[11px] font-medium text-slate-600">
        {t("aliases")}
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
          value={draftAliases}
          onChange={(e) => setDraftAliases(e.target.value)}
        />
      </label>

      <label className="block text-[11px] font-medium text-slate-600">
        {t("primaryParent")}
        <select
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={draftPrimaryParent}
          onChange={(e) => setDraftPrimaryParent(e.target.value)}
        >
          <option value="">{t("notSelected")}</option>
          {graphNodes
            .filter((n) => n.id !== selectedNode.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.canonical_name}
              </option>
            ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void saveEdits()}
        >
          {t("saveChanges")}
        </button>
        <button
          type="button"
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
          disabled={busy}
          onClick={() => void deleteNode()}
        >
          {t("delete")}
        </button>
      </div>

      {/* Relations section */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <h3 className="text-xs font-semibold text-slate-700">{t("relations")}</h3>
        <div className="mt-2 grid gap-2">
          <label className="text-[11px] font-medium text-slate-600">
            {t("targetNode")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={relTo}
              onChange={(e) => setRelTo(e.target.value)}
            >
              <option value="">{t("selectEllipsis")}</option>
              {relationTargetCandidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.canonical_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-600">
            {t("relationType")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={relType}
              onChange={(e) => setRelType(e.target.value)}
            >
              {REL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`edgeKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md bg-slate-900 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void addRelation()}
          >
            {t("createRelation")}
          </button>
        </div>

        <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
          {relForSelected.length === 0 ? (
            <li className="text-slate-500">{t("noRelations")}</li>
          ) : (
            relForSelected.map((r) => {
              const isHighlighted = r.id === highlightEdgeId;
              return (
                <li
                  key={r.id}
                  ref={isHighlighted ? edgeItemRef : null}
                  className={cn(
                    "flex items-start justify-between gap-2 rounded border p-1.5",
                    isHighlighted
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-white",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className="font-medium"
                      style={{ color: REL_COLOR[r.relation_type] ?? "#64748b" }}
                    >
                      {t(`edgeKind.${r.relation_type}`, { defaultValue: r.relation_type })}
                    </span>
                    <span className="mx-1 text-slate-400">·</span>
                    <span className="text-slate-700">
                      {r.from_node_id === selectedNode.id ? "→" : "←"}{" "}
                      {graphNodes.find(
                        (n) =>
                          n.id ===
                          (r.from_node_id === selectedNode.id ? r.to_node_id : r.from_node_id),
                      )?.canonical_name ??
                        (r.from_node_id === selectedNode.id ? r.to_node_id : r.from_node_id)}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <select
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                      value={r.relation_type}
                      disabled={busy}
                      onChange={(e) => void changeRelationType(r.id, e.target.value)}
                    >
                      {REL_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t(`edgeKind.${k}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      title={t("reverseRelation")}
                      disabled={busy}
                      onClick={() => void reverseRelation(r.id)}
                    >
                      ⇄
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-red-600"
                      disabled={busy}
                      onClick={() => void removeRelation(r.id)}
                    >
                      {t("remove")}
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
