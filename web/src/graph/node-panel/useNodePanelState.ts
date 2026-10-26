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

  // Synchronize when selectedNode changes
  useEffect(() => {
    activeNodeIdRef.current = selectedNode?.id ?? null;
    requestSeqRef.current += 1;
    const currentSeq = requestSeqRef.current;

    if (!selectedNode) {
      setBoundQuestions([]);
      setNodeFiles([]);
      setBoundSel(new Set());
      setBankOpen(false);
      setFileOpen(false);
      setNotesList([]);
      setDraftName("");
      setDraftSubject("");
      setDraftTags("");
      setDraftAliases("");
      setDraftKind("concept");
      setDraftPrimaryParent("");
      setNoteComposerOpen(false);
      setNoteEditingId(null);
      setNoteDraftBody("");
      return;
    }

    setDraftName(selectedNode.canonical_name ?? "");
    setDraftSubject(selectedNode.subject ?? "");
    setDraftTags((selectedNode.tags ?? []).join(", "));
    setDraftAliases((selectedNode.aliases ?? []).join(", "));
    setDraftKind((selectedNode.node_kind as "concept" | "skill" | "causal") ?? "concept");
    setDraftPrimaryParent(selectedNode.primary_parent_id ?? "");
    setNotesList(
      (selectedNode.notes ?? []).map((n) => ({
        id: n.id,
        body: n.body ?? "",
        created_at: n.created_at,
      })),
    );
    setNoteComposerOpen(false);
    setNoteEditingId(null);
    setNoteDraftBody("");

    // Load bound questions and files with sequence and nodeId guard
    const nodeId = selectedNode.id;
    void (async () => {
      try {
        const [q, f] = await Promise.all([
          apiGraphListQuestionsForNode(nodeId, activeSlug),
          apiGraphListNodeFiles(nodeId, activeSlug),
        ]);
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          setBoundQuestions(q.questions as BoundQuestion[]);
          setNodeFiles(f.links as NodeFileLink[]);
        }
      } catch (e) {
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
  }, [selectedNode, activeSlug, onError]);

  // File search with debounce
  useEffect(() => {
    if (!fileOpen) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await apiGraphListResourceFiles(fileQ, 600);
          setFileList(r.files ?? []);
        } catch {
          /* ignore */
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fileOpen, fileQ]);

  // Persist notes with late response guard
  const persistNotes = useCallback(
    async (next: GraphNodeNoteRow[]): Promise<boolean> => {
      if (!selectedNode) return false;
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
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          setNotesList(next);
        }
        onSaved();
        return true;
      } catch (e) {
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          onError(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          setBusy(false);
        }
      }
    },
    [selectedNode, activeSlug, onSaved, onError],
  );

  // Save node edit changes with late response guard
  const saveEdits = async () => {
    if (isImeCompositionActive()) return;
    if (!selectedNode) return;
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
          source: null,
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
      onSaved();
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  // Delete node
  const deleteNode = async () => {
    if (!selectedNode) return;
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
      onDeleted();
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  // Relations
  const addRelation = async () => {
    if (!selectedNode) return;
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
      onSaved();
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const removeRelation = async (rid: string) => {
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphDeleteRelation(rid, activeSlug);
      onSaved();
    } catch (e) {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const reverseRelation = async (rid: string) => {
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { reverse: true }, activeSlug);
      onSaved();
    } catch (e) {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const changeRelationType = async (rid: string, newType: string) => {
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { relation_type: newType }, activeSlug);
      onSaved();
    } catch (e) {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  // Questions
  const openBank = async () => {
    setBankOpen(true);
    setBankSel(new Set());
    setBankSubject("");
    setBankType("");
    try {
      const r = await apiBankItems();
      setBankItems(r.items ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const bindSelectedQuestions = async () => {
    if (!selectedNode || bankSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphBindBatch(nodeId, Array.from(bankSel), activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBankOpen(false);
        setBankSel(new Set());
      }
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const unbindQ = async (qid: string) => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBinding({ question_qualified_id: qid, node_id: nodeId }, activeSlug);
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const unbindSelectedBound = async () => {
    if (!selectedNode || boundSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBatch(nodeId, Array.from(boundSel), activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBoundSel(new Set());
      }
      const q = await apiGraphListQuestionsForNode(nodeId, activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBoundQuestions(q.questions as BoundQuestion[]);
      }
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  // Files
  const attachSelectedFiles = async () => {
    if (!selectedNode || fileSel.size === 0) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      for (const p of fileSel) {
        await apiGraphAttachFile({ node_id: nodeId, relative_path: p }, activeSlug);
      }
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setFileOpen(false);
      }
      const f = await apiGraphListNodeFiles(nodeId, activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setNodeFiles(f.links as NodeFileLink[]);
      }
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const uploadAndAttach = async (file: File | null) => {
    if (!file || !selectedNode) return;
    const nodeId = selectedNode.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      const up = await apiGraphUploadMaterial(file);
      await apiGraphAttachFile({ node_id: nodeId, relative_path: up.relative_path }, activeSlug);
      const f = await apiGraphListNodeFiles(nodeId, activeSlug);
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setNodeFiles(f.links as NodeFileLink[]);
      }
    } catch (e) {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        setBusy(false);
      }
    }
  };

  const detachFile = async (linkId: string) => {
    const nodeId = selectedNode?.id;
    const currentSeq = requestSeqRef.current;
    setBusy(true);
    onError(null);
    try {
      await apiGraphDetachFile(linkId, activeSlug);
      if (nodeId) {
        const f = await apiGraphListNodeFiles(nodeId, activeSlug);
        if (activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
          setNodeFiles(f.links as NodeFileLink[]);
        }
      }
    } catch (e) {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (nodeId && activeNodeIdRef.current === nodeId && requestSeqRef.current === currentSeq) {
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
