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
): GradingDrafts {
  const next = { ...drafts };
  sources.forEach(({ key, source }) => {
    const current = drafts[key];
    const refreshed = createGradingDraft(source);
    next[key] = current
      ? {
          score: reconcileField(current.score, refreshed.score),
          feedback: reconcileField(current.feedback, refreshed.feedback),
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

export function markGradingDraftSaved(saved: { score: string; feedback: string }): GradingDraft {
  return {
    score: cleanField(saved.score),
    feedback: cleanField(saved.feedback),
  };
}

function cleanField(value: string): GradingDraftField {
  return { value, baseline: value, dirty: false };
}

function reconcileField(current: GradingDraftField, refreshed: GradingDraftField): GradingDraftField {
  return current.dirty ? current : refreshed;
}
