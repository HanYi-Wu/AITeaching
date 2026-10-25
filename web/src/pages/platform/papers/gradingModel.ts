export type GradingDraftField = {
  value: string;
  baseline: string;
  dirty: boolean;
};

export type GradingDraft = {
  score: GradingDraftField;
  feedback: GradingDraftField;
};

export type GradingDrafts = Record<string, GradingDraft>;

export type GradingDraftSource = {
  score?: number | null;
  aiSuggestedScore?: number | null;
  feedback?: string | null;
  aiFeedback?: string | null;
};

export type GradingDraftSourceEntry = {
  key: string;
  source: GradingDraftSource;
};

export type GradingSuggestion = {
  key: string;
  score?: number | null;
  feedback?: string | null;
};

export function createGradingDraft(source: GradingDraftSource): GradingDraft {
  return {
    score: cleanField(String(source.score ?? source.aiSuggestedScore ?? "")),
    feedback: cleanField(source.feedback ?? source.aiFeedback ?? ""),
  };
}

export function getGradingDraft(
  drafts: GradingDrafts,
  key: string,
  source: GradingDraftSource,
): GradingDraft {
  return drafts[key] ?? createGradingDraft(source);
}

export function updateGradingDraft(
  drafts: GradingDrafts,
  key: string,
  source: GradingDraftSource,
  field: keyof GradingDraft,
  value: string,
): GradingDrafts {
  const draft = getGradingDraft(drafts, key, source);
  return {
    ...drafts,
    [key]: {
      ...draft,
      [field]: {
        ...draft[field],
        value,
        dirty: value !== draft[field].baseline,
      },
    },
  };
}

export function reconcileGradingDrafts(
  drafts: GradingDrafts,
  sources: GradingDraftSourceEntry[],
  canReplaceField: (key: string, field: keyof GradingDraft) => boolean = () => true,
): GradingDrafts {
  const next = { ...drafts };
  sources.forEach(({ key, source }) => {
    const current = drafts[key];
    const refreshed = createGradingDraft(source);
    next[key] = current
      ? {
          score: canReplaceField(key, "score") ? reconcileField(current.score, refreshed.score) : current.score,
          feedback: canReplaceField(key, "feedback") ? reconcileField(current.feedback, refreshed.feedback) : current.feedback,
        }
      : refreshed;
  });
  return next;
}

export function applyGradingSuggestions(
  drafts: GradingDrafts,
  suggestions: GradingSuggestion[],
): GradingDrafts {
  const next = { ...drafts };
  suggestions.forEach(({ key, score, feedback }) => {
    const current = next[key] ?? createGradingDraft({});
    next[key] = {
      score: score == null ? current.score : cleanField(String(score)),
      feedback: feedback == null || feedback === "" ? current.feedback : cleanField(feedback),
    };
  });
  return next;
}

export function parseGradingScore(value: string): number | null {
  if (!value.trim()) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

export function gradingFeedbackForSave(field: GradingDraftField): string | null {
  if (field.value === "" && !field.dirty) return null;
  return field.value;
}

export function markGradingDraftSaved(
  current: GradingDraft,
  saved: { score: string; feedback: string },
  fields: readonly (keyof GradingDraft)[] = ["score", "feedback"],
): GradingDraft {
  return {
    score: fields.includes("score") ? cleanField(saved.score) : rebaseField(current.score, saved.score),
    feedback: fields.includes("feedback") ? cleanField(saved.feedback) : rebaseField(current.feedback, saved.feedback),
  };
}

function cleanField(value: string): GradingDraftField {
  return { value, baseline: value, dirty: false };
}

function reconcileField(current: GradingDraftField, refreshed: GradingDraftField): GradingDraftField {
  return current.dirty ? current : refreshed;
}

function rebaseField(current: GradingDraftField, savedValue: string): GradingDraftField {
  return { value: current.value, baseline: savedValue, dirty: current.value !== savedValue };
}
