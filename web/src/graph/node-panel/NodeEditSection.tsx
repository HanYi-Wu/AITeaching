import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Save, Trash2, ArrowRightLeft, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  REL_COLOR,
  REL_KEYS,
  type GraphNodeRow,
  type GraphRelationRow,
} from "./types";
import { Select as AppSelect } from "../../components/ui/select";

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
    <div className="space-y-4">
      {/* Node basic attributes */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0 text-xs font-medium text-[var(--or-muted)] ">
          <span>{t("canonicalName")}</span>
          <input
            className="or-g50-input mt-1.5 w-full"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
        </label>
        <label className="block min-w-0 text-xs font-medium text-[var(--or-muted)] ">
          <span>{t("nodeType")}</span>
          <AppSelect
            className="or-g50-input mt-1.5 w-full"
            value={draftKind}
            onValueChange={(value) => setDraftKind(value as "concept" | "skill" | "causal")}
          >
            <option value="concept">{t("nodeKind.concept")}</option>
            <option value="skill">{t("nodeKind.skill")}</option>
            <option value="causal">{t("nodeKind.causal")}</option>
          </AppSelect>
        </label>
      </div>

      <label className="block text-xs font-medium text-[var(--or-muted)] ">
        <span>{t("tags")}</span>
        <input
          className="or-g50-input mt-1.5 w-full"
          value={draftTags}
          onChange={(e) => setDraftTags(e.target.value)}
        />
      </label>

      <label className="block text-xs font-medium text-[var(--or-muted)] ">
        <span>{t("aliases")}</span>
        <input
          className="or-g50-input mt-1.5 w-full font-mono"
          value={draftAliases}
          onChange={(e) => setDraftAliases(e.target.value)}
        />
      </label>

      <label className="block text-xs font-medium text-[var(--or-muted)] ">
        <span>{t("primaryParent")}</span>
        <AppSelect
          className="or-g50-input mt-1.5 w-full"
          value={draftPrimaryParent}
          onValueChange={(value) => setDraftPrimaryParent(value)}
        >
          <option value="">{t("notSelected")}</option>
          {graphNodes
            .filter((n) => n.id !== selectedNode.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.canonical_name}
              </option>
            ))}
        </AppSelect>
      </label>

      {/* Main Save / Delete actions */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          className="or-g50-btn or-g50-btn-primary flex-1"
          disabled={busy}
          onClick={() => void saveEdits()}
        >
          <Save className="h-4 w-4" />
          <span>{t("saveChanges")}</span>
        </button>
        <button
          type="button"
          className="or-g50-btn or-g50-btn-danger"
          disabled={busy}
          onClick={() => void deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
          <span>{t("delete")}</span>
        </button>
      </div>

      {/* Relations subcard */}
      <div className="rounded-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5  ">
        <h3 className="text-sm font-semibold text-[var(--or-text)] ">
          {t("relations")}
        </h3>

        {/* Add relation inputs */}
        <div className="mt-3 grid gap-2.5">
          <label className="text-xs font-medium text-[var(--or-muted)] ">
            <span>{t("targetNode")}</span>
            <AppSelect
              className="or-g50-input mt-1 w-full"
              value={relTo}
              onValueChange={(value) => setRelTo(value)}
            >
              <option value="">{t("selectEllipsis")}</option>
              {relationTargetCandidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.canonical_name}
                </option>
              ))}
            </AppSelect>
          </label>

          <label className="text-xs font-medium text-[var(--or-muted)] ">
            <span>{t("relationType")}</span>
            <AppSelect
              className="or-g50-input mt-1 w-full"
              value={relType}
              onValueChange={(value) => setRelType(value)}
            >
              {REL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`edgeKind.${k}`)}
                </option>
              ))}
            </AppSelect>
          </label>

          <button
            type="button"
            className="or-g50-btn or-g50-btn-primary w-full"
            disabled={busy || !relTo}
            onClick={() => void addRelation()}
          >
            <Plus className="h-4 w-4" />
            <span>{t("createRelation")}</span>
          </button>
        </div>

        {/* Relations list with responsive wrapping */}
        <ul className="mt-3.5 max-h-48 space-y-1.5 overflow-y-auto text-xs">
          {relForSelected.length === 0 ? (
            <li className="py-2 text-center text-[var(--or-muted)] ">
              {t("noRelations")}
            </li>
          ) : (
            relForSelected.map((r) => {
              const isHighlighted = r.id === highlightEdgeId;
              const otherNodeId =
                r.from_node_id === selectedNode.id ? r.to_node_id : r.from_node_id;
              const otherNodeName =
                graphNodes.find((n) => n.id === otherNodeId)?.canonical_name ?? otherNodeId;
              const directionArrow = r.from_node_id === selectedNode.id ? "→" : "←";

              return (
                <li
                  key={r.id}
                  ref={isHighlighted ? edgeItemRef : null}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 transition-all",
                    isHighlighted
                      ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_80%,transparent)] shadow-sm  "
                      : "border-[var(--or-outline)] bg-[var(--or-card)]  ",
                  )}
                >
                  <div className="min-w-0 flex-1 flex items-center">
                    <span
                      className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-none mr-1.5 shrink-0"
                      style={{
                        backgroundColor: `${REL_COLOR[r.relation_type] ?? "#64748b"}20`,
                        color: REL_COLOR[r.relation_type] ?? "#64748b",
                      }}
                    >
                      <span className="inline-block transform translate-y-[0.5px]">
                        {t(`edgeKind.${r.relation_type}`, { defaultValue: r.relation_type })}
                      </span>
                    </span>
                    <span className="text-[var(--or-muted)]  font-medium truncate max-w-[140px] sm:max-w-xs">
                      {directionArrow} {otherNodeName}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 ml-auto">
                    <AppSelect
                      className="or-g50-input !h-7 !text-xs !py-0 !px-1.5"
                      value={r.relation_type}
                      disabled={busy}
                      onValueChange={(value) => void changeRelationType(r.id, value)}
                    >
                      {REL_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t(`edgeKind.${k}`)}
                        </option>
                      ))}
                    </AppSelect>

                    <button
                      type="button"
                      className="or-g50-btn or-g50-btn-secondary !h-7 !w-7 !p-0"
                      title={t("reverseRelation")}
                      disabled={busy}
                      onClick={() => void reverseRelation(r.id)}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      className="or-g50-btn or-g50-btn-danger !h-7 !px-2 !text-xs font-medium"
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
