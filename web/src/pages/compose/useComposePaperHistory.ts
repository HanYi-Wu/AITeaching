import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComposeDraftScope, ComposeDraftStorageStatus, ComposeHistoryState, ComposeLocalDraftRecord, ComposePaperState, TemplateRow } from "../../types/compose";
import { buildComposeDraftStorageKey, readScopedComposeDraft, removeScopedComposeDraft, shouldIgnoreComposeShortcut, writeScopedComposeDraft } from "./composeDraftStorage";
import { arePaperStatesEqual, clonePaperState, createEmptyPaperState, resolveSelectedTemplate, syncPaperStateWithTemplate } from "./composeModel";
import { createHistoryState, markHistorySaved, pushHistoryEdit, redoHistory, syncHistoryWithTemplate, undoHistory } from "./composeHistory";

type Session = { owner: string; history: ComposeHistoryState; dirtyKey: string | null };
type Recovery = { key: string | null; record: ComposeLocalDraftRecord | null; status: ComposeDraftStorageStatus };

export function useComposePaperHistory(params: {
  initialExportLabel: string; initialSubject: string; templates: TemplateRow[];
  scope: ComposeDraftScope | null; storageKey: string | null; ownerKey: string;
  shortcutsEnabled: boolean; onOwnerIdentityChanged?: () => void;
  onRestoredMsg?: () => void; onDiscardedMsg?: () => void;
}) {
  const { initialExportLabel, initialSubject, templates, scope, storageKey, ownerKey, shortcutsEnabled } = params;
  const freshHistory = () => createHistoryState(createEmptyPaperState({ exportLabel: initialExportLabel, subject: initialSubject }));
  const [session, setSession] = useState<Session>(() => ({ owner: ownerKey, history: freshHistory(), dirtyKey: null }));
  const sessionRef = useRef(session);
  const [recovery, setRecovery] = useState<Recovery>({ key: null, record: null, status: "idle" });
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;
  const callbacks = useRef(params);
  callbacks.current = params;
  // Mask the old owner's state during the render preceding layout effects.
  if (sessionRef.current.owner !== ownerKey) {
    sessionRef.current = { owner: ownerKey, history: freshHistory(), dirtyKey: null };
  }
  const visible = session.owner === ownerKey ? session : sessionRef.current;
  const history = visible.history;
  const paperState = history.present;
  const selectedTpl = useMemo(() => resolveSelectedTemplate(templates, paperState), [templates, paperState]);
  const recoverableDraft = recovery.key === storageKey ? recovery.record : null;
  const draftStorageStatus = recovery.key === storageKey ? recovery.status : scope ? "idle" : "scope_unavailable";

  const update = useCallback((next: Session) => { sessionRef.current = next; setSession(next); }, []);
  useLayoutEffect(() => {
    if (session.owner !== ownerKey) {
      setSession(sessionRef.current);
      setRecovery({ key: storageKey, record: null, status: scope ? "idle" : "scope_unavailable" });
      callbacks.current.onOwnerIdentityChanged?.();
    }
  }, [ownerKey, scope, session.owner, storageKey]);

  useEffect(() => {
    if (templates.length === 0 || paperState.templatePath.trim()) return;
    const first = templates[0]!;
    const current = sessionRef.current;
    if (current.history.present.templatePath.trim()) return;
    const next = syncPaperStateWithTemplate({ ...current.history.present, templatePath: first.path, templateRef: first.id }, first);
    update({ ...current, history: createHistoryState(next) });
  }, [paperState.templatePath, templates, update]);

  useEffect(() => {
    if (!selectedTpl) return;
    const current = sessionRef.current;
    const next = syncHistoryWithTemplate(current.history, selectedTpl);
    if (next !== current.history) update({ ...current, history: next });
  }, [selectedTpl, update]);

  useEffect(() => {
    if (!scope || !storageKey) {
      setRecovery({ key: storageKey, record: null, status: "scope_unavailable" });
      return;
    }
    if (sessionRef.current.dirtyKey === storageKey) return;
    const result = readScopedComposeDraft(scope);
    const record = result.record;
    const recordTemplate = record ? resolveSelectedTemplate(templates, record.paper) : undefined;
    const normalized = record ? syncPaperStateWithTemplate(record.paper, recordTemplate) : null;
    setRecovery({ key: storageKey, record: record && normalized && !arePaperStatesEqual(normalized, history.baseline) ? { ...record, paper: normalized } : null, status: result.status });
  }, [history.baseline, scope, storageKey, templates]);

  const flushDraft = useCallback(() => {
    const current = sessionRef.current;
    const currentScope = scopeRef.current;
    const key = keyRef.current;
    if (!currentScope || !key || current.dirtyKey !== key) return;
    if (recoveryRef.current.key === key && recoveryRef.current.record) return;
    if (arePaperStatesEqual(current.history.present, current.history.baseline)) return;
    const result = writeScopedComposeDraft(currentScope, current.history.present);
    setRecovery((previous) => ({ ...previous, key, status: result.status }));
  }, []);

  useEffect(() => {
    if (!scope || !storageKey || visible.dirtyKey !== storageKey || recoverableDraft) return;
    if (arePaperStatesEqual(history.present, history.baseline)) {
      removeScopedComposeDraft(scope);
      setRecovery({ key: storageKey, record: null, status: "idle" });
      return;
    }
    const timer = window.setTimeout(flushDraft, 300);
    return () => window.clearTimeout(timer);
  }, [flushDraft, history, recoverableDraft, scope, storageKey, visible.dirtyKey]);

  // Route changes and browser refresh should retain the last actual edit.
  useEffect(() => {
    const persist = () => flushDraft();
    window.addEventListener("pagehide", persist);
    return () => { window.removeEventListener("pagehide", persist); flushDraft(); };
  }, [flushDraft]);

  const commitEdit = useCallback((updater: ComposePaperState | ((previous: ComposePaperState) => ComposePaperState)) => {
    const current = sessionRef.current;
    const next = typeof updater === "function" ? updater(current.history.present) : updater;
    const history = pushHistoryEdit(current.history, next);
    if (history === current.history) return;
    update({ ...current, history, dirtyKey: keyRef.current ?? "__unscoped_dirty__" });
  }, [update]);

  const updateWithoutHistory = useCallback((updater: (previous: ComposePaperState) => ComposePaperState) => {
    const current = sessionRef.current;
    const present = updater(current.history.present), baseline = updater(current.history.baseline);
    if (arePaperStatesEqual(present, current.history.present) && arePaperStatesEqual(baseline, current.history.baseline)) return;
    update({ ...current, history: { ...current.history, present, baseline } });
  }, [update]);

  const resetPaperBaseline = useCallback((next: ComposePaperState) => {
    flushDraft();
    update({ ...sessionRef.current, history: createHistoryState(next), dirtyKey: null });
    setRecovery({ key: keyRef.current, record: null, status: scopeRef.current ? "idle" : "scope_unavailable" });
  }, [flushDraft, update]);

  const acceptSavedState = useCallback((saved: ComposePaperState, submitted: ComposePaperState, nextScope?: ComposeDraftScope | null) => {
    const current = sessionRef.current;
    const present = arePaperStatesEqual(current.history.present, submitted) ? clonePaperState(saved) : current.history.present;
    const history = markHistorySaved({ ...current.history, present }, saved);
    const dirty = !arePaperStatesEqual(present, saved);
    const targetScope = nextScope === undefined ? scopeRef.current : nextScope;
    const targetKey = targetScope ? buildComposeDraftStorageKey(targetScope) : null;
    const result = dirty ? writeScopedComposeDraft(targetScope, present) : null;
    if (!dirty || result?.ok) {
      if (!dirty || keyRef.current !== targetKey) removeScopedComposeDraft(scopeRef.current);
      if (!dirty) removeScopedComposeDraft(targetScope);
    }
    update({ ...current, history, dirtyKey: dirty ? targetKey ?? "__unscoped_dirty__" : null });
    setRecovery({ key: targetKey, record: null, status: result?.status ?? (targetScope ? "idle" : "scope_unavailable") });
  }, [update]);

  const travel = useCallback((direction: "undo" | "redo") => {
    const current = sessionRef.current;
    const history = direction === "undo" ? undoHistory(current.history) : redoHistory(current.history);
    if (history === current.history) return;
    update({ ...current, history, dirtyKey: keyRef.current ?? "__unscoped_dirty__" });
  }, [update]);
  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);

  const restoreLocalDraft = useCallback(() => {
    const record = recoverableDraft;
    if (!record || !scopeRef.current || buildComposeDraftStorageKey(record.scope) !== keyRef.current) return;
    commitEdit(record.paper);
    setRecovery({ key: keyRef.current, record: null, status: "saved" });
    callbacks.current.onRestoredMsg?.();
  }, [commitEdit, recoverableDraft]);
  const discardLocalDraft = useCallback(() => {
    removeScopedComposeDraft(scopeRef.current);
    setRecovery({ key: keyRef.current, record: null, status: "idle" });
    callbacks.current.onDiscardedMsg?.();
  }, []);

  useEffect(() => {
    if (!shortcutsEnabled) return;
    const handle = (event: KeyboardEvent) => {
      if (shouldIgnoreComposeShortcut(event) || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && !event.shiftKey)) {
        const redoRequested = key === "y" || event.shiftKey;
        const current = sessionRef.current.history;
        if (!(redoRequested ? current.future.length : current.past.length)) return;
        event.preventDefault();
        travel(redoRequested ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [shortcutsEnabled, travel]);

  return { paperState, selectedTpl, recoverableDraft, draftStorageStatus, isDirty: !arePaperStatesEqual(history.present, history.baseline), canUndo: history.past.length > 0, canRedo: history.future.length > 0, commitEdit, updateWithoutHistory, resetPaperBaseline, acceptSavedState, flushDraft, undo, redo, restoreLocalDraft, discardLocalDraft };
}
