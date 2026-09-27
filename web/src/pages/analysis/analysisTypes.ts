

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExamResult = {
  exam_id: string;
  exam_title: string;
  subject: string | null;
  question_count: number;
  section_count: number;
  score_batch_count: number;
  has_score: boolean;
  latest_batch_id: string | null;
  exam_dir: string;
  mtime: string;
};

type ScoreBatch = {
  batch_id: string;
  imported_at: string;
  student_count: number;
  question_count: number;
};

export type ExamSummary = ExamResult & {
  questions: ExamQuestion[];
  score_batches: ScoreBatch[];
};

type ExamQuestion = {
  idx: number;
  header: string;
  section_id: string;
  question_id: string;
  question_in_section: number;
  score_per_item: number;
};

export type ImportResult = {
  batch_id: string;
  student_count: number;
  question_count: number;
  warnings: Array<{ question_id: string; header: string; message: string }>;
  missing_headers: string[];
};

type QuestionStat = {
  question_id: string;
  header: string;
  section_id: string;
  score_per_item: number;
  answered_count: number;
  error_rate: number | null;
  avg_score_ratio: number | null;
  avg_raw_score: number | null;
};

type NodeStat = {
  node_id: string;
  bound_question_count: number;
  bound_questions: string[];
  mastery_fuzzy: number;
  error_rate: number;
};

type StudentStat = {
  name: string;
  student_id: string;
  raw_total: number;
  score_ratio: number;
  fuzzy_score: number;
  rank: number;
  class_rank: number;
  total_in_class: number;
};

export type ScoreAnalysis = {
  batch_id: string;
  exam_id: string;
  student_count: number;
  question_count: number;
  warnings: Array<{ question_id: string; header: string; section_id: string; message: string }>;
  question_stats: QuestionStat[];
  node_stats: NodeStat[];
  student_stats: StudentStat[];
  class_avg_ratio: number;
  class_avg_fuzzy: number;
};

export type ToolSpec = { name: string; description?: string };

export type ChartSpec = { id: string; type: string; title?: string; series_id?: string; x?: string; y?: string };

export type ChartSeries = { id: string; points?: Array<{ label: string; value: number }> };
