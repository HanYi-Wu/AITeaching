export type AutoComposeOptions = {
  total_count: number;
  knowledge_points: Array<{ id: string; name: string; question_count: number }>;
  difficulty_counts: Record<string, number>;
  type_counts: Record<string, number>;
  namespaces: string[];
  warnings: string[];
};

export type DuplicateMatch = {
  source: "bank" | "history" | "paper";
  kind: "exact" | "similar" | "reused";
  similarity: number;
  qualified_id: string;
  content_preview: string;
  exam_id?: string;
  exam_title?: string;
};

export type DuplicateQuestionReport = {
  qualified_id: string;
  occurrences: number;
  matches: DuplicateMatch[];
  match_count: number;
  truncated: boolean;
};

export type DuplicateReport = {
  method: "text_ngram_v1";
  threshold: number;
  complete?: boolean;
  summary: {
    question_count: number;
    flagged_count: number;
    exact_count: number;
    similar_count: number;
    history_count: number;
    within_paper_count: number;
  };
  questions: DuplicateQuestionReport[];
  warnings: string[];
};

export type AutoComposeRequest = {
  template_path: string;
  template_ref: string;
  subject: string;
  total_count: number;
  knowledge_points: string[];
  coverage_ratio: number;
  difficulty_distribution: Partial<Record<"easy" | "medium" | "hard" | "unknown", number>>;
  type_distribution: Record<string, number>;
  section_counts?: Record<string, number>;
  avoid_history: boolean;
  exclude_exam_id?: string | null;
  similarity_threshold: number;
  seed?: number;
  namespaces?: string[];
  exclude_question_ids?: string[];
};

export type AutoComposeResponse = {
  ok: true;
  complete: boolean;
  template_ref: string;
  template_path: string;
  selected_items: Array<{
    section_id: string;
    question_ids: string[];
    required_count: number;
    score_per_item: number;
  }>;
  requested_count: number;
  generated_count: number;
  candidate_count: number;
  excluded_history_count: number;
  goals: {
    knowledge: {
      target_points: string[];
      covered_points: string[];
      missing_points: string[];
      coverage_ratio: number;
      required_ratio: number;
      met: boolean;
    };
    difficulty: {
      target: Record<string, number>;
      actual: Record<string, number>;
      met: boolean;
    };
    types: {
      target: Record<string, number>;
      actual: Record<string, number>;
      met: boolean;
    };
    sections: Array<{ section_id: string; requested_count: number; actual_count: number }>;
    met: boolean;
  };
  duplicate_report: DuplicateReport;
  warnings: string[];
};

export type CheckDuplicatesRequest = {
  /** Keep repeated qualified IDs; they indicate reuse within this paper. */
  question_ids: string[];
  exclude_exam_id?: string | null;
  similarity_threshold: number;
};

