import type { ComposeHistoryState, ComposePaperState, TemplateRow } from "../../types/compose";
import { normTemplatePath } from "./composeHelpers";
import { arePaperStatesEqual, clonePaperState, syncPaperStateWithTemplate } from "./composeModel";

export const MAX_COMPOSE_HISTORY_DEPTH = 50;

export function createHistoryState(initial: ComposePaperState): ComposeHistoryState {
  const snap = clonePaperState(initial);
  return {
    past: [],
    present: snap,
    future: [],
    baseline: clonePaperState(snap),
  };
}

export function pushHistoryEdit(
  history: ComposeHistoryState,
  next: ComposePaperState,
  maxDepth = MAX_COMPOSE_HISTORY_DEPTH,
): ComposeHistoryState {
  if (arePaperStatesEqual(history.present, next)) {
    return history;
  }
  const nextPast = [...history.past, clonePaperState(history.present)];
  const trimmedPast = nextPast.length > maxDepth ? nextPast.slice(nextPast.length - maxDepth) : nextPast;
  return {
    past: trimmedPast,
    present: clonePaperState(next),
    future: [],
    baseline: history.baseline,
  };
}

export function undoHistory(history: ComposeHistoryState): ComposeHistoryState {
  if (history.past.length === 0) {
    return history;
  }
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: clonePaperState(previous),
    future: [clonePaperState(history.present), ...history.future],
    baseline: history.baseline,
  };
}

export function redoHistory(history: ComposeHistoryState): ComposeHistoryState {
  if (history.future.length === 0) {
    return history;
  }
  const next = history.future[0]!;
  return {
    past: [...history.past, clonePaperState(history.present)],
    present: clonePaperState(next),
    future: history.future.slice(1),
    baseline: history.baseline,
  };
}

export function resetHistory(nextBaseline: ComposePaperState): ComposeHistoryState {
  return createHistoryState(nextBaseline);
}

export function markHistorySaved(
  history: ComposeHistoryState,
  savedState?: ComposePaperState,
): ComposeHistoryState {
  return {
    ...history,
    baseline: clonePaperState(savedState ?? history.present),
  };
}

/**
 * 同步模板结构到当前状态与基线（不产生多余的撤销栈条目）
 */
export function syncHistoryWithTemplate(
  history: ComposeHistoryState,
  template: TemplateRow | undefined,
): ComposeHistoryState {
  if (!template) {
    return history;
  }
  const sync = (snapshot: ComposePaperState) => {
    if (snapshot.templateRef !== template.id && normTemplatePath(snapshot.templatePath) !== normTemplatePath(template.path)) return snapshot;
    const next = syncPaperStateWithTemplate(snapshot, template);
    return normTemplatePath(next.templatePath) === normTemplatePath(template.path)
      ? next : { ...next, templatePath: template.path };
  };
  const nextPresent = sync(history.present);
  const nextBaseline = sync(history.baseline);
  const past = history.past.map(sync);
  const future = history.future.map(sync);
  if (nextPresent === history.present && nextBaseline === history.baseline &&
    past.every((item, index) => item === history.past[index]) &&
    future.every((item, index) => item === history.future[index])) {
    return history;
  }
  return {
    ...history,
    past,
    future,
    present: nextPresent,
    baseline: nextBaseline,
  };
}
