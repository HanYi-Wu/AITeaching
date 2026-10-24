import { clusterAdjacentGroupSlots } from "../../lib/groupQuestions";
import { fillSectionGaps } from "../../lib/manualPaperShortcuts";
import { normalizeQuestionTypeForFilter } from "../../lib/questionTypes";
import type {
  ComposeAddQuestionsResult,
  ComposeMoveQuestionsResult,
  ComposePaperState,
  ComposeRemoveQuestionsResult,
  ComposeSelectedItem,
  ExamDoc,
  GraphBindingNode,
  QuestionRow,
  TemplateRow,
  TemplateSection,
} from "../../types/compose";
import { normTemplatePath, questionTypeMatchesSection, sectionTypeToFilter } from "./composeHelpers";

export function createEmptyPaperState(init?: Partial<ComposePaperState>): ComposePaperState {
  return {
    exportLabel: init?.exportLabel ?? "",
    subject: init?.subject ?? "",
    templatePath: init?.templatePath ?? "",
    templateRef: init?.templateRef ?? "",
    draftName: init?.draftName ?? "",
    bySection: cloneStringListRecord(init?.bySection ?? {}),
    scoreBySection: { ...(init?.scoreBySection ?? {}) },
    countBySection: { ...(init?.countBySection ?? {}) },
    scoreOverrides: cloneScoreOverrides(init?.scoreOverrides ?? {}),
    perQuestionMode: { ...(init?.perQuestionMode ?? {}) },
  };
}

function cloneStringListRecord(record: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = Array.isArray(v) ? [...v] : [];
  }
  return out;
}

function cloneScoreOverrides(
  overrides: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [secId, map] of Object.entries(overrides)) {
    if (map && typeof map === "object" && Object.keys(map).length > 0) {
      out[secId] = { ...map };
    }
  }
  return out;
}

export function clonePaperState(state: ComposePaperState): ComposePaperState {
  return createEmptyPaperState(state);
}

function areStringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areNumberRecordsEqual(
  a: Record<string, number | undefined>,
  b: Record<string, number | undefined>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (va !== vb) return false;
  }
  return true;
}

function areBooleanRecordsEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (Boolean(a[k]) !== Boolean(b[k])) return false;
  }
  return true;
}

export function arePaperStatesEqual(a: ComposePaperState, b: ComposePaperState): boolean {
  if (
    a.exportLabel !== b.exportLabel ||
    a.subject !== b.subject ||
    normTemplatePath(a.templatePath) !== normTemplatePath(b.templatePath) ||
    a.templateRef !== b.templateRef ||
    a.draftName !== b.draftName
  ) {
    return false;
  }
  const sectionKeys = new Set([...Object.keys(a.bySection), ...Object.keys(b.bySection)]);
  for (const key of sectionKeys) {
    if (!areStringArraysEqual(a.bySection[key] ?? [], b.bySection[key] ?? [])) {
      return false;
    }
  }
  if (!areNumberRecordsEqual(a.scoreBySection, b.scoreBySection)) return false;
  if (!areNumberRecordsEqual(a.countBySection, b.countBySection)) return false;
  if (!areBooleanRecordsEqual(a.perQuestionMode, b.perQuestionMode)) return false;

  const overrideSections = new Set([
    ...Object.keys(a.scoreOverrides),
    ...Object.keys(b.scoreOverrides),
  ]);
  for (const secId of overrideSections) {
    const oa = a.scoreOverrides[secId] ?? {};
    const ob = b.scoreOverrides[secId] ?? {};
    if (!areNumberRecordsEqual(oa, ob)) return false;
  }
  return true;
}

export function resolveSelectedTemplate(
  templates: readonly TemplateRow[],
  state: Pick<ComposePaperState, "templatePath" | "templateRef" | "bySection" | "scoreBySection">,
): TemplateRow | undefined {
  const tp = normTemplatePath(state.templatePath);
  const found = templates.find((t) => tp && normTemplatePath(t.path) === tp) ??
    templates.find((t) => state.templateRef && t.id === state.templateRef);
  if (found) {
    return found;
  }
  if (state.templateRef === "remediation_practice") {
    const sectionIds = Object.keys(state.bySection);
    const sectionId = sectionIds[0] ?? "练习题";
    return {
      id: "remediation_practice",
      path: state.templatePath,
      layout: "single_column",
      sections: [
        {
          section_id: sectionId,
          type: "practice",
          required_count: state.bySection[sectionId]?.length ?? 0,
          score_per_item: state.scoreBySection[sectionId] ?? 5,
        },
      ],
    } satisfies TemplateRow;
  }
  return undefined;
}

export function resolveFallbackTemplatePathByRef(
  templates: readonly TemplateRow[],
  templatePath: string,
  templateRef: string,
): string | null {
  if (templates.length === 0 || !templatePath.trim()) {
    return null;
  }
  const tp = normTemplatePath(templatePath);
  if (templates.some((x) => normTemplatePath(x.path) === tp)) {
    return null;
  }
  const ref = templateRef.trim();
  if (!ref) {
    return null;
  }
  const byRef = templates.find((x) => x.id === ref);
  if (byRef && normTemplatePath(byRef.path) !== tp) {
    return byRef.path;
  }
  return null;
}

export function syncPaperStateWithTemplate(
  state: ComposePaperState,
  template: TemplateRow | undefined,
): ComposePaperState {
  if (!template) {
    return state;
  }
  const nextBySection: Record<string, string[]> = {};
  const nextScoreBySection: Record<string, number | undefined> = {};
  const nextCountBySection: Record<string, number> = {};
  const nextScoreOverrides: Record<string, Record<string, number>> = {};
  const nextPerQuestionMode: Record<string, boolean> = {};

  for (const s of template.sections) {
    nextBySection[s.section_id] = [...(state.bySection[s.section_id] ?? [])];
    nextScoreBySection[s.section_id] = state.scoreBySection[s.section_id];
    if (state.countBySection[s.section_id] !== undefined) {
      nextCountBySection[s.section_id] = state.countBySection[s.section_id]!;
    }
    if (state.scoreOverrides[s.section_id] && Object.keys(state.scoreOverrides[s.section_id]!).length > 0) {
      nextScoreOverrides[s.section_id] = { ...state.scoreOverrides[s.section_id] };
    }
    if (state.perQuestionMode[s.section_id]) {
      nextPerQuestionMode[s.section_id] = state.perQuestionMode[s.section_id]!;
    }
  }

  const candidate: ComposePaperState = {
    ...state,
    templateRef: template.id,
    bySection: nextBySection,
    scoreBySection: nextScoreBySection,
    countBySection: nextCountBySection,
    scoreOverrides: nextScoreOverrides,
    perQuestionMode: nextPerQuestionMode,
  };
  const sameSections = Object.keys(state.bySection).length === template.sections.length &&
    template.sections.every((section) => section.section_id in state.bySection);
  return sameSections && arePaperStatesEqual(state, candidate) ? state : candidate;
}

export function resolveActiveSectionForTemplate(
  activeSection: string | null,
  template: TemplateRow | undefined,
): string | null {
  if (!template) {
    return activeSection;
  }
  const sectionIds = new Set(template.sections.map((s) => s.section_id));
  if (activeSection && sectionIds.has(activeSection)) {
    return activeSection;
  }
  return template.sections[0]?.section_id ?? null;
}

export function clampSectionRequiredCount(raw: number | string): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(500, Math.trunc(num)));
}

export function getSectionRequiredCount(
  section: TemplateSection,
  countBySection: Record<string, number>,
): number {
  const override = countBySection[section.section_id];
  return override !== undefined ? override : section.required_count;
}

export function isSectionSatisfied(
  section: TemplateSection,
  bySection: Record<string, string[]>,
  countBySection: Record<string, number>,
): boolean {
  if (section.type === "text") {
    return true;
  }
  const picked = bySection[section.section_id]?.length ?? 0;
  if (section.type === "practice") {
    return picked > 0;
  }
  return picked === getSectionRequiredCount(section, countBySection);
}

export function areAllSectionsSatisfied(
  template: TemplateRow | undefined,
  bySection: Record<string, string[]>,
  countBySection: Record<string, number>,
): boolean {
  if (!template) {
    return false;
  }
  return template.sections.every((s) => isSectionSatisfied(s, bySection, countBySection));
}

export function computeTotalScore(
  template: TemplateRow | undefined,
  bySection: Record<string, string[]>,
  scoreBySection: Record<string, number | undefined>,
  scoreOverrides: Record<string, Record<string, number>>,
): number {
  if (!template) {
    return 0;
  }
  let total = 0;
  for (const s of template.sections) {
    if (s.type === "text") {
      continue;
    }
    const ids = bySection[s.section_id] ?? [];
    const base = scoreBySection[s.section_id] ?? s.score_per_item;
    const ov = scoreOverrides[s.section_id] ?? {};
    for (const qid of ids) {
      total += ov[qid] !== undefined ? ov[qid]! : base;
    }
  }
  return Math.round(total * 1000) / 1000;
}

export function addQuestionsToSectionInModel(params: {
  state: ComposePaperState;
  template: TemplateRow | undefined;
  sectionId: string | null;
  questionIds: readonly string[];
  questionMap: ReadonlyMap<string, QuestionRow>;
}): ComposeAddQuestionsResult {
  const { state, template, sectionId, questionIds, questionMap } = params;
  if (!template || !sectionId || questionIds.length === 0) {
    return { ok: false, errorCode: "selectQuestionFirst" };
  }
  const sec = template.sections.find((s) => s.section_id === sectionId);
  if (!sec) {
    return { ok: false, errorCode: "sectionNotFound" };
  }
  if (sec.type === "text") {
    return { ok: false, errorCode: "textSectionNoPick" };
  }
  const compatible = questionIds.filter((qid) => {
    const row = questionMap.get(qid);
    return row && questionTypeMatchesSection(row.type, sec.type, row.answer);
  });
  const skippedTypeCount = questionIds.length - compatible.length;
  if (compatible.length === 0) {
    const first = questionMap.get(questionIds[0]!);
    return {
      ok: false,
      errorCode: "typeMismatch",
      need: sectionTypeToFilter(sec),
      got: first ? normalizeQuestionTypeForFilter(first.type, first.answer) : "?",
    };
  }
  const cur = state.bySection[sectionId] ?? [];
  const seen = new Set(cur);
  const newIds: string[] = [];
  for (const id of compatible) {
    if (!seen.has(id)) {
      seen.add(id);
      newIds.push(id);
    }
  }
  if (newIds.length === 0) {
    return {
      ok: true,
      changed: false,
      nextState: state,
      addedIds: [],
      skippedTypeCount,
    };
  }
  const requiredCount = getSectionRequiredCount(sec, state.countBySection);
  if (sec.type !== "practice" && cur.length + newIds.length > requiredCount) {
    return { ok: false, errorCode: "sectionFull" };
  }
  const nextState: ComposePaperState = {
    ...state,
    bySection: {
      ...state.bySection,
      [sectionId]: [...cur, ...newIds],
    },
  };
  return {
    ok: true,
    changed: true,
    nextState,
    addedIds: newIds,
    skippedTypeCount,
  };
}

export function removeQuestionsFromSectionInModel(
  state: ComposePaperState,
  sectionId: string | null | undefined,
  questionIds: readonly string[],
): ComposeRemoveQuestionsResult {
  if (!sectionId || questionIds.length === 0) {
    return { ok: false, errorCode: "selectPaperItemFirst" };
  }
  const removeSet = new Set(questionIds);
  const cur = state.bySection[sectionId] ?? [];
  const nextList = cur.filter((id) => !removeSet.has(id));
  const removedIds = cur.filter((id) => removeSet.has(id));

  let nextOverrides = state.scoreOverrides;
  const secOverrides = state.scoreOverrides[sectionId];
  if (secOverrides) {
    const updatedSecOverrides = { ...secOverrides };
    let overrideChanged = false;
    for (const id of questionIds) {
      if (id in updatedSecOverrides) {
        delete updatedSecOverrides[id];
        overrideChanged = true;
      }
    }
    if (overrideChanged) {
      nextOverrides = { ...state.scoreOverrides };
      if (Object.keys(updatedSecOverrides).length === 0) {
        delete nextOverrides[sectionId];
      } else {
        nextOverrides[sectionId] = updatedSecOverrides;
      }
    }
  }

  const changed = nextList.length !== cur.length || nextOverrides !== state.scoreOverrides;
  if (!changed) {
    return { ok: true, changed: false, nextState: state, removedIds: [] };
  }

  return {
    ok: true,
    changed: true,
    removedIds,
    nextState: {
      ...state,
      bySection: {
        ...state.bySection,
        [sectionId]: nextList,
      },
      scoreOverrides: nextOverrides,
    },
  };
}

export function moveQuestionsInSectionInModel(
  state: ComposePaperState,
  sectionId: string,
  questionIds: readonly string[],
  direction: "up" | "down",
  questionMap?: ReadonlyMap<string, QuestionRow>,
): ComposeMoveQuestionsResult {
  const cur = state.bySection[sectionId] ?? [];
  if (cur.length <= 1 || questionIds.length === 0) {
    return { ok: true, changed: false, nextState: state };
  }
  const selectedSet = new Set(questionIds);

  if (questionMap) {
    const slots = clusterAdjacentGroupSlots(cur, new Map(questionMap));
    const slotUnits = slots.map((slot) => (slot.kind === "single" ? [slot.qid] : [...slot.qids]));
    const isUnitSelected = (unit: string[]) => unit.some((id) => selectedSet.has(id));
    const nextUnits = [...slotUnits];

    if (direction === "up") {
      for (let i = 1; i < nextUnits.length; i++) {
        if (isUnitSelected(nextUnits[i]!) && !isUnitSelected(nextUnits[i - 1]!)) {
          const tmp = nextUnits[i - 1]!;
          nextUnits[i - 1] = nextUnits[i]!;
          nextUnits[i] = tmp;
        }
      }
    } else {
      for (let i = nextUnits.length - 2; i >= 0; i--) {
        if (isUnitSelected(nextUnits[i]!) && !isUnitSelected(nextUnits[i + 1]!)) {
          const tmp = nextUnits[i + 1]!;
          nextUnits[i + 1] = nextUnits[i]!;
          nextUnits[i] = tmp;
        }
      }
    }

    const nextFlat = nextUnits.flat();
    if (areStringArraysEqual(cur, nextFlat)) {
      return { ok: true, changed: false, nextState: state };
    }
    return {
      ok: true,
      changed: true,
      nextState: {
        ...state,
        bySection: {
          ...state.bySection,
          [sectionId]: nextFlat,
        },
      },
    };
  }

  const nextList = [...cur];
  if (direction === "up") {
    for (let i = 1; i < nextList.length; i++) {
      if (selectedSet.has(nextList[i]!) && !selectedSet.has(nextList[i - 1]!)) {
        const tmp = nextList[i - 1]!;
        nextList[i - 1] = nextList[i]!;
        nextList[i] = tmp;
      }
    }
  } else {
    for (let i = nextList.length - 2; i >= 0; i--) {
      if (selectedSet.has(nextList[i]!) && !selectedSet.has(nextList[i + 1]!)) {
        const tmp = nextList[i + 1]!;
        nextList[i + 1] = nextList[i]!;
        nextList[i] = tmp;
      }
    }
  }

  if (areStringArraysEqual(cur, nextList)) {
    return { ok: true, changed: false, nextState: state };
  }
  return {
    ok: true,
    changed: true,
    nextState: {
      ...state,
      bySection: {
        ...state.bySection,
        [sectionId]: nextList,
      },
    },
  };
}

export function fillSectionGapsInModel(params: {
  state: ComposePaperState;
  template: TemplateRow | undefined;
  candidateQuestions: QuestionRow[];
}): { nextState: ComposePaperState; addedCount: number; changed: boolean } {
  const { state, template, candidateQuestions } = params;
  if (!template) {
    return { nextState: state, addedCount: 0, changed: false };
  }
  const effectiveSections = template.sections.map((section) => ({
    ...section,
    required_count: getSectionRequiredCount(section, state.countBySection),
  }));
  const nextBySection = fillSectionGaps(
    effectiveSections,
    state.bySection,
    candidateQuestions,
    questionTypeMatchesSection,
  );
  const beforeCount = Object.values(state.bySection).flat().length;
  const afterCount = Object.values(nextBySection).flat().length;
  const addedCount = afterCount - beforeCount;
  if (addedCount <= 0) {
    return { nextState: state, addedCount: 0, changed: false };
  }
  return {
    nextState: {
      ...state,
      bySection: nextBySection,
    },
    addedCount,
    changed: true,
  };
}

export function setSectionRequiredCountInModel(
  state: ComposePaperState,
  sectionId: string,
  rawCount: number | string,
): ComposePaperState {
  const clamped = clampSectionRequiredCount(rawCount);
  if (state.countBySection[sectionId] === clamped) {
    return state;
  }
  return {
    ...state,
    countBySection: {
      ...state.countBySection,
      [sectionId]: clamped,
    },
  };
}

export function setSectionScorePerItemInModel(
  state: ComposePaperState,
  sectionId: string,
  rawScore: string | number,
): ComposePaperState {
  const parsed = typeof rawScore === "number" ? rawScore : parseFloat(rawScore);
  const nextVal = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  if (state.scoreBySection[sectionId] === nextVal) {
    return state;
  }
  return {
    ...state,
    scoreBySection: {
      ...state.scoreBySection,
      [sectionId]: nextVal,
    },
  };
}

export function setPerQuestionScoreModeInModel(
  state: ComposePaperState,
  sectionId: string,
  enabled: boolean,
): ComposePaperState {
  if (Boolean(state.perQuestionMode[sectionId]) === enabled) {
    return state;
  }
  return {
    ...state,
    perQuestionMode: {
      ...state.perQuestionMode,
      [sectionId]: enabled,
    },
  };
}

export function setQuestionScoreOverrideInModel(
  state: ComposePaperState,
  sectionId: string,
  qid: string,
  rawScore: string,
): ComposePaperState {
  const raw = rawScore.trim();
  const curSection = { ...(state.scoreOverrides[sectionId] ?? {}) };
  if (raw === "") {
    if (!(qid in curSection)) {
      return state;
    }
    delete curSection[qid];
  } else {
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val < 0) {
      return state;
    }
    if (curSection[qid] === val) {
      return state;
    }
    curSection[qid] = val;
  }
  const nextOverrides = { ...state.scoreOverrides };
  if (Object.keys(curSection).length === 0) {
    delete nextOverrides[sectionId];
  } else {
    nextOverrides[sectionId] = curSection;
  }
  return {
    ...state,
    scoreOverrides: nextOverrides,
  };
}

export function examDocToPaperState(
  doc: ExamDoc,
  fallbackState?: Pick<ComposePaperState, "templatePath">,
): { examId: string | null; state: ComposePaperState } {
  const tp = normTemplatePath(String(doc.template_path ?? ""));
  const effectiveTemplatePath = tp || (fallbackState?.templatePath ?? "");
  const eid = String(doc.exam_id ?? "").trim();
  const items = doc.selected_items ?? [];
  const bySection: Record<string, string[]> = {};
  const scoreBySection: Record<string, number | undefined> = {};
  const countBySection: Record<string, number> = {};
  const scoreOverrides: Record<string, Record<string, number>> = {};
  const perQuestionMode: Record<string, boolean> = {};

  for (const it of items) {
    bySection[it.section_id] = [...(it.question_ids ?? [])];
    if (it.score_per_item !== undefined && it.score_per_item !== null) {
      scoreBySection[it.section_id] = Number(it.score_per_item);
    }
    if (it.required_count !== undefined && it.required_count !== null) {
      countBySection[it.section_id] = Number(it.required_count);
    }
    if (it.score_overrides && Object.keys(it.score_overrides).length > 0) {
      scoreOverrides[it.section_id] = { ...it.score_overrides };
      perQuestionMode[it.section_id] = true;
    }
  }

  return {
    examId: eid || null,
    state: {
      exportLabel: String(doc.export_label ?? ""),
      subject: String(doc.subject ?? ""),
      templatePath: effectiveTemplatePath,
      templateRef: String(doc.template_ref ?? ""),
      draftName: String(doc.name ?? ""),
      bySection,
      scoreBySection,
      countBySection,
      scoreOverrides,
      perQuestionMode,
    },
  };
}

export function buildSelectedItemsForApi(
  template: TemplateRow | undefined,
  state: ComposePaperState,
): ComposeSelectedItem[] {
  if (!template) {
    return [];
  }
  return template.sections.map((s) => {
    const def = s.score_per_item;
    const spi = state.scoreBySection[s.section_id];
    const score_per_item = spi !== undefined && spi !== def ? spi : null;
    const rawOv = state.scoreOverrides[s.section_id];
    const score_overrides = rawOv && Object.keys(rawOv).length > 0 ? { ...rawOv } : null;
    return {
      section_id: s.section_id,
      question_ids: [...(state.bySection[s.section_id] ?? [])],
      score_per_item,
      score_overrides,
      required_count: state.countBySection[s.section_id] ?? null,
    };
  });
}

export function computeKnowledgeDistribution(
  bySection: Record<string, string[]>,
  questionBindingsIndex: Record<string, GraphBindingNode[]>,
  limit = 14,
): [string, number][] {
  const counts = new Map<string, number>();
  let unassigned = 0;
  for (const ids of Object.values(bySection)) {
    for (const qid of ids) {
      const nodes = questionBindingsIndex[qid] ?? [];
      if (nodes.length === 0) {
        unassigned += 1;
      } else {
        for (const n of nodes) {
          const name = (n.canonical_name || n.id).trim() || n.id;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
  }
  const rows: [string, number][] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (unassigned > 0) {
    rows.push(["__unassigned__", unassigned]);
  }
  return rows.slice(0, limit);
}

