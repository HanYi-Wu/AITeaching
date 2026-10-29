import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiGraphAttachFile,
  apiGraphBindBatch,
  apiGraphCreateRelation,
  apiGraphDeleteNode,
  apiGraphDeleteRelation,
  apiGraphDetachFile,
  apiGraphListNodeFiles,
  apiGraphListQuestionsForNode,
  apiGraphListResourceFiles,
  apiGraphUnbindBatch,
  apiGraphUnbindBinding,
  apiGraphUpdateNode,
  apiGraphUpdateRelation,
  apiGraphUploadMaterial,
  apiBankItems,
} from "../../api/client";
import { isImeCompositionActive } from "../../lib/ime";
import {
  splitCsv,
  type BankItemPreview,
  type BoundQuestion,
  type GraphNodeNoteRow,
  type GraphNodeRow,
  type NodeFileLink,
  type ResourceFileEntry,
} from "./types";

export interface UseNodePanelStateOptions {
  selectedNode: GraphNodeRow | null;
  activeSlug: string | null;
  onSaved: () => void;
  onDeleteNode?: () => Promise<void>;
  onDeleted: () => void;
  onError: (e: string | null) => void;
}

export function useNodePanelState({
  selectedNode,
  activeSlug,
  onSaved,
  onDeleteNode,
  onDeleted,
  onError,
}: UseNodePanelStateOptions) {
  const { t } = useTranslation("graph");
  const [busy, setBusy] = useState(false);

  // Active tracking for race condition and late response guard
  const activeNodeIdRef = useRef<string | null>(selectedNode?.id ?? null);
  const requestSeqRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const identity = JSON.stringify([activeSlug, selectedNode?.id ?? null]);
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    requestSeqRef.current += 1;
  }
  activeNodeIdRef.current = selectedNode?.id ?? null;
  const snapshotRef = useRef<{ identity: string; node: GraphNodeRow | null } | null>(null);
  const detailsSeqRef = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const isCurrent = (nodeId: string | undefined, sequence: number) =>
    mountedRef.current && Boolean(nodeId) && activeNodeIdRef.current === nodeId && requestSeqRef.current === sequence;
  const canStart = () => mountedRef.current && identityRef.current === identity && Boolean(selectedNode);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      detailsSeqRef.current += 1;
    };
  }, []);

  // Edit state
  const [draftName, setDraftName] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftAliases, setDraftAliases] = useState("");
  const [draftKind, setDraftKind] = useState<"concept" | "skill" | "causal">("concept");
  const [draftPrimaryParent, setDraftPrimaryParent] = useState("");

  // Relations
  const [relTo, setRelTo] = useState("");
  const [relType, setRelType] = useState("related");

  // Questions
  const [boundQuestions, setBoundQuestions] = useState<BoundQuestion[]>([]);
  const [boundSel, setBoundSel] = useState<Set<string>>(() => new Set());
  const [bankOpen, setBankOpen] = useState(false);
  const [bankItems, setBankItems] = useState<BankItemPreview[]>([]);
  const [bankNs, setBankNs] = useState("");
  const [bankQ, setBankQ] = useState("");
  const [bankSubject, setBankSubject] = useState("");
  const [bankType, setBankType] = useState("");
  const [bankSel, setBankSel] = useState<Set<string>>(() => new Set());

  // Files
  const [nodeFiles, setNodeFiles] = useState<NodeFileLink[]>([]);
  const [fileOpen, setFileOpen] = useState(false);
  const [fileQ, setFileQ] = useState("");
  const [fileList, setFileList] = useState<ResourceFileEntry[]>([]);
  const [fileSel, setFileSel] = useState<Set<string>>(() => new Set());

  // Notes
  const [notesList, setNotesList] = useState<GraphNodeNoteRow[]>([]);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraftBody, setNoteDraftBody] = useState("");
  const noteTextAreaRef = useRef<HTMLTextAreaElement>(null);

  // Identity changes discard the previous node's activity. A refreshed snapshot
  // only updates fields that still match the previous server value.
  useEffect(() => {
    const previous = snapshotRef.current;
    const switched = previous?.identity !== identity;
    snapshotRef.current = { identity, node: selectedNode };
    const currentSeq = requestSeqRef.current;
    const detailsSeq = ++detailsSeqRef.current;

    if (switched) {
      setBusy(false);
      setBoundQuestions([]);
      setNodeFiles([]);
      setBoundSel(new Set());
      setBankSel(new Set());
      setFileSel(new Set());
      setBankOpen(false);
      setFileOpen(false);
      setNoteComposerOpen(false);
      setNoteEditingId(null);
      setNoteDraftBody("");
      setRelTo("");
    }
    if (!selectedNode) {
      setNotesList([]);
      setDraftName(""); setDraftSubject(""); setDraftTags(""); setDraftAliases("");
      setDraftKind("concept"); setDraftPrimaryParent("");
      return;
    }
    const old = switched ? null : previous?.node;
    const updateText = (setter: React.Dispatch<React.SetStateAction<string>>, value: string, before: string) =>
      setter((current) => switched || current === before ? value : current);
    updateText(setDraftName, selectedNode.canonical_name ?? "", old?.canonical_name ?? "");
    updateText(setDraftSubject, selectedNode.subject ?? "", old?.subject ?? "");
    updateText(setDraftTags, (selectedNode.tags ?? []).join(", "), (old?.tags ?? []).join(", "));
    updateText(setDraftAliases, (selectedNode.aliases ?? []).join(", "), (old?.aliases ?? []).join(", "));
    updateText(setDraftPrimaryParent, selectedNode.primary_parent_id ?? "", old?.primary_parent_id ?? "");
    setDraftKind((current) => switched || current === (old?.node_kind ?? "concept")
      ? (selectedNode.node_kind as "concept" | "skill" | "causal") ?? "concept" : current);
    setNotesList((current) => {
      const before = old?.notes ?? [];
      const unchanged = current.length === before.length && current.every((note, index) =>
        note.id === before[index].id && note.body === (before[index].body ?? "") && note.created_at === before[index].created_at);
      return switched || unchanged ? (selectedNode.notes ?? []).map((note) => ({ ...note, body: note.body ?? "" })) : current;
    });

    const nodeId = selectedNode.id;
    void (async () => {
      try {
        const [questions, files] = await Promise.all([
          apiGraphListQuestionsForNode(nodeId, activeSlug), apiGraphListNodeFiles(nodeId, activeSlug),
        ]);
        if (isCurrent(nodeId, currentSeq) && detailsSeqRef.current === detailsSeq) {
          setBoundQuestions(questions.questions as BoundQuestion[]);
          setNodeFiles(files.links as NodeFileLink[]);
        }
      } catch (error) {
        if (isCurrent(nodeId, currentSeq) && detailsSeqRef.current === detailsSeq) {
          errorRef.current(error instanceof Error ? error.message : String(error));
        }
      }
    })();
  }, [selectedNode, activeSlug, identity]);

  // File search with debounce
  useEffect(() => {
    if (!fileOpen) return;
    const nodeId = selectedNode?.id;
    const sequence = requestSeqRef.current;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!active || !isCurrent(nodeId, sequence)) return;
          const r = await apiGraphListResourceFiles(fileQ, 600);
          if (active && isCurrent(nodeId, sequence)) setFileList(r.files ?? []);
        } catch {
          /* ignore */
        }
      })();
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [fileOpen, fileQ, identity]);

  // Persist notes with late response guard
  const persistNotes = useCallback(
    async (next: GraphNodeNoteRow[]): Promise<boolean> => {
      if (!selectedNode || !canStart()) return false;
      const nodeId = selectedNode.id;
      const currentSeq = requestSeqRef.current;
      setBusy(true);
      onError(null);
      try {
        await apiGraphUpdateNode(
          nodeId,
          {
            id: nodeId,
            canonical_name: (selectedNode.canonical_name ?? "").trim() || nodeId,
            notes: next.map((n) => ({
              id: n.id,
              body: n.body,
              ...(n.created_at ? { created_at: n.created_at } : {}),
            })),
          },
          activeSlug,
        );
        if (!isCurrent(nodeId, currentSeq)) return false;
        setNotesList(next);
        onSaved();
        return true;
      } catch (e) {
        if (isCurrent(nodeId, currentSeq)) {
          onError(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        if (isCurrent(nodeId, currentSeq)) {
          setBusy(false);
        }
      }
    },
    [selectedNode, activeSlug, onSaved, onError],
  );

  // Save node edit changes with late response guard
  const saveEdits = async () => {
    if (isImeCompositionActive()) return;
    if (!selectedNode || !canStart()) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateNode(
        nodeId,
        {
          id: nodeId,
          node_kind: draftKind,
          canonical_name: draftName.trim(),
          aliases: splitCsv(draftAliases),
          subject: draftSubject.trim() || null,
          level: (selectedNode.level ?? "").trim() || null,
          tags: splitCsv(draftTags),
          layout_x: selectedNode.layout_x ?? null,
          layout_y: selectedNode.layout_y ?? null,
          primary_parent_id: draftPrimaryParent.trim() || null,
          notes: notesList.map((n) => ({
            id: n.id,
            body: n.body,
            ...(n.created_at ? { created_at: n.created_at } : {}),
          })),
        },
        activeSlug,
      );
      if (isCurrent(nodeId, currentSeq)) onSaved();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  // Delete node
  const deleteNode = async () => {
    if (!selectedNode || !canStart()) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      if (onDeleteNode) {
        await onDeleteNode();
      } else {
        await apiGraphDeleteNode(nodeId, activeSlug);
      }
      if (isCurrent(nodeId, currentSeq)) onDeleted();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  // Relations
  const addRelation = async () => {
    if (!selectedNode || !canStart()) return;
    if (!relTo) {
      onError(t("errPickNodeRel"));
      return;
    }
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphCreateRelation(
        { from_node_id: nodeId, to_node_id: relTo, relation_type: relType },
        activeSlug,
      );
      if (isCurrent(nodeId, currentSeq)) onSaved();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const removeRelation = async (rid: string) => {
    if (!canStart()) return;
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphDeleteRelation(rid, activeSlug);
      if (isCurrent(nodeId, currentSeq)) onSaved();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const reverseRelation = async (rid: string) => {
    if (!canStart()) return;
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { reverse: true }, activeSlug);
      if (isCurrent(nodeId, currentSeq)) onSaved();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const changeRelationType = async (rid: string, newType: string) => {
    if (!canStart()) return;
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { relation_type: newType }, activeSlug);
      if (isCurrent(nodeId, currentSeq)) onSaved();
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  // Questions
  const openBank = async () => {
    if (!selectedNode || !canStart()) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBankOpen(true);
    setBankSel(new Set());
    setBankSubject("");
    setBankType("");
    try {
      const r = await apiBankItems();
      if (isCurrent(nodeId, currentSeq)) setBankItems(r.items ?? []);
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) onError(e instanceof Error ? e.message : String(e));
    }
  };

  const bindSelectedQuestions = async () => {
    if (!selectedNode || !canStart() || bankSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphBindBatch(nodeId, Array.from(bankSel), activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setBankOpen(false);
        setBankSel(new Set());
      }
      if (!isCurrent(nodeId, currentSeq)) return;
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const unbindQ = async (qid: string) => {
    if (!selectedNode || !canStart()) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBinding({ question_qualified_id: qid, node_id: nodeId }, activeSlug);
      if (!isCurrent(nodeId, currentSeq)) return;
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const unbindSelectedBound = async () => {
    if (!selectedNode || !canStart() || boundSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBatch(nodeId, Array.from(boundSel), activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setBoundSel(new Set());
      }
      if (!isCurrent(nodeId, currentSeq)) return;
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  // Files
  const attachSelectedFiles = async () => {
    if (!selectedNode || !canStart() || fileSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      for (const p of fileSel) {
        if (!isCurrent(nodeId, currentSeq)) return;
        await apiGraphAttachFile({ node_id: nodeId, relative_path: p }, activeSlug);
      }
      if (isCurrent(nodeId, currentSeq)) {
        setFileOpen(false);
      }
      if (!isCurrent(nodeId, currentSeq)) return;
      const f = await apiGraphListNodeFiles(nodeId, activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setNodeFiles(f.links as NodeFileLink[]);
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const uploadAndAttach = async (file: File | null) => {
    if (!file || !selectedNode || !canStart()) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      const up = await apiGraphUploadMaterial(file);
      if (!isCurrent(nodeId, currentSeq)) return;
      await apiGraphAttachFile({ node_id: nodeId, relative_path: up.relative_path }, activeSlug);
      if (!isCurrent(nodeId, currentSeq)) return;
      const f = await apiGraphListNodeFiles(nodeId, activeSlug);
      if (isCurrent(nodeId, currentSeq)) {
        setNodeFiles(f.links as NodeFileLink[]);
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  const detachFile = async (linkId: string) => {
    if (!canStart()) return;
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphDetachFile(linkId, activeSlug);
      if (nodeId) {
        if (!isCurrent(nodeId, currentSeq)) return;
      const f = await apiGraphListNodeFiles(nodeId, activeSlug);
        if (isCurrent(nodeId, currentSeq)) {
          setNodeFiles(f.links as NodeFileLink[]);
        }
      }
    } catch (e) {
      if (isCurrent(nodeId, currentSeq)) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent(nodeId, currentSeq)) {
        setBusy(false);
      }
    }
  };

  return {
    busy,
    // Draft edit states
    draftName,
    setDraftName,
    draftSubject,
    setDraftSubject,
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
    // Relations
    relTo,
    setRelTo,
    relType,
    setRelType,
    addRelation,
    removeRelation,
    reverseRelation,
    changeRelationType,
    // Questions
    boundQuestions,
    boundSel,
    setBoundSel,
    bankOpen,
    setBankOpen,
    bankItems,
    bankNs,
    setBankNs,
    bankQ,
    setBankQ,
    bankSubject,
    setBankSubject,
    bankType,
    setBankType,
    bankSel,
    setBankSel,
    openBank,
    bindSelectedQuestions,
    unbindQ,
    unbindSelectedBound,
    // Files
    nodeFiles,
    fileOpen,
    setFileOpen,
    fileQ,
    setFileQ,
    fileList,
    fileSel,
    setFileSel,
    attachSelectedFiles,
    uploadAndAttach,
    detachFile,
    // Notes
    notesList,
    noteComposerOpen,
    setNoteComposerOpen,
    noteEditingId,
    setNoteEditingId,
    noteDraftBody,
    setNoteDraftBody,
    noteTextAreaRef,
    persistNotes,
  };
}
