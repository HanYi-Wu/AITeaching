import type { PlatformRole } from "./roles";

export type PlatformUser = {
  id: string;
  school_id?: string | null;
  role: PlatformRole;
  username: string;
  display_name: string;
  email?: string | null;
  status: string;
  must_change_password?: boolean;
  teacher_guide_step?: number;
  avatar_data_url?: string | null;
  preferences?: { theme?: string; density?: string; font_scale?: number };
  subjects?: string[];
};

export type PlatformStatus = {
  project_bound: boolean;
  admin_exists: boolean;
  public_mode: boolean;
};

export type PlatformAuthResponse = {
  user: PlatformUser;
  token: string;
};

export type SchoolRecord = {
  id: string;
  name: string;
  status: string;
  ai_enabled: number;
  created_at: string;
  updated_at: string;
  school_user_count?: number;
};

export type SchoolAiSettings = {
  school: SchoolRecord;
  ai_available: boolean;
  ai_enabled: boolean;
};

export type SchoolAiCapability = {
  id: string;
  label: string;
  description: string;
};

export type SchoolAiResponse = SchoolAiSettings & {
  capabilities: SchoolAiCapability[];
  stats: {
    teachers: number;
    classes: number;
    students: number;
    assignments: number;
  };
  reply?: string;
  source?: "llm" | "local" | string;
  error?: string;
};

export type SchoolImportKind = "teachers" | "classes" | "students" | "assignments" | "all";

export type SchoolAiImportResponse = SchoolAiSettings & {
  kind: SchoolImportKind;
  imported: number;
  review: string;
  result: unknown;
};

export type SchoolAiImportReviewResponse = SchoolAiSettings & {
  kind: SchoolImportKind;
  class_id?: string | null;
  row_count: number;
  review: string;
  preview: Array<Record<string, unknown>>;
  stats?: SchoolAiResponse["stats"];
};

export type PagedResult = {
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
};

export type ListQuery = {
  q?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
};

export type TeacherRecord = PlatformUser & {
  subjects: string[];
};

export type ClassRecord = {
  id: string;
  school_id: string;
  name: string;
  grade?: string | null;
  subject_hint?: string | null;
  student_count?: number;
  teacher_count?: number;
};

export type StudentRecord = {
  id: string;
  school_id: string;
  user_id?: string | null;
  student_no: string;
  display_name: string;
  email?: string | null;
  account_username?: string | null;
  initial_password?: string | null;
  class_names?: string | null;
  status: string;
};

export type PaperSubmissionMode = "online" | "image_manual" | "image_ai" | "offline_scan";
export type PracticePublishMode = "current" | "wrong_questions" | "reinforcement";

export type PracticeHistoryRecord = {
  id: string;
  paper_id: string;
  title: string;
  subject?: string | null;
  created_at?: string | null;
  status?: string;
  practice_kind?: string | null;
  submitted_student_count: number;
  wrong_answer_count: number;
};

export type PracticeHistoryResponse = {
  class_id: string;
  publication_count: number;
  minimum_reinforcement_history: number;
  eligible_for_reinforcement: boolean;
  publications: PracticeHistoryRecord[];
};

export type StudentAnswerImage = {
  name: string;
  mime_type?: string | null;
  data_url: string;
};

export type PlatformPaperRecord = {
  paper_id: string;
  exam_id: string;
  title: string;
  subject: string;
  delivery_mode: "offline" | "online";
  status: string;
  owner_teacher_id?: string | null;
  school_id?: string | null;
  folder_id?: string | null;
  question_count: number;
  section_count: number;
  score_batch_count: number;
  has_score: boolean;
  has_pdf: boolean;
  has_docx: boolean;
  latest_batch_id?: string | null;
  publication_count: number;
  published_class_count: number;
  total_student_count?: number;
  submitted_student_count?: number;
  in_progress_student_count?: number;
  graded_student_count?: number;
  published_student_count?: number;
  mtime?: string | null;
};

export type TeacherClassRecord = ClassRecord & {
  subject?: string | null;
};

export type PaperPublicationRecord = {
  id: string;
  paper_id: string;
  teacher_id?: string;
  teacher_name?: string | null;
  teacher_username?: string | null;
  title: string;
  description?: string | null;
  status: string;
  class_ids: string[];
  folder_id?: string | null;
  recipient_scope?: "class" | "student";
  class_names?: string[];
  student_names?: string[];
  attempt_count?: number;
  submitted_count?: number;
  proctor_event_count?: number;
  show_results_immediately?: boolean;
  randomize_questions?: boolean;
  randomize_answers?: boolean;
  submission_mode?: PaperSubmissionMode;
  max_screen_switches?: number;
  time_limit_minutes?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PaperSubmissionAnswerRecord = {
  grading_version?: string;
  correct_answer?: string | null;
  question_id: string;
  header?: string | null;
  content?: string | null;
  type?: string | null;
  score_per_item?: number | null;
  options?: Record<string, string> | null;
  analysis?: string | null;
  section_id?: string | null;
  tags?: string[];
  answer?: unknown;
  images?: StudentAnswerImage[];
  score?: number | null;
  is_correct?: boolean | null;
  grading_status?: string | null;
  feedback?: string | null;
  ai_suggested_score?: number | null;
  ai_feedback?: string | null;
  ai_ocr_text?: string | null;
  responded_at?: string | null;
};

export type PaperSubmissionRecord = {
  attempt_id: string;
  publication_id: string;
  paper_id?: string;
  exam_id?: string;
  title?: string;
  subject?: string | null;
  student_id?: string;
  student_no?: string;
  student_name?: string;
  account_username?: string | null;
  status: string;
  score?: number | null;
  max_score?: number | null;
  submitted_at?: string | null;
  grading_completed_at?: string | null;
  screen_switch_count?: number;
  submission_mode?: PaperSubmissionMode;
  scan_images?: Array<{ page_index: number; name: string; mime_type: string; size: number }>;
  answers: PaperSubmissionAnswerRecord[];
};

export type TeacherClassStudentRecord = {
  id: string;
  student_no: string;
  display_name: string;
  account_username?: string | null;
  email?: string | null;
  status: string;
};

export type TeacherStudentProfile = {
  student: TeacherClassStudentRecord;
  class_id: string;
  summary: {
    exam_count: number;
    submitted_exam_count: number;
    graded_exam_count: number;
    completion_rate: number;
    average_score_percent?: number | null;
    average_time_per_question_seconds?: number | null;
    integrity_event_count: number;
    behavior_event_average_per_exam: number;
  };
  recent_exams: Array<{
    attempt_id: string;
    paper_id: string;
    title: string;
    subject?: string | null;
    status: string;
    score?: number | null;
    max_score?: number | null;
    score_percent?: number | null;
    submitted_at?: string | null;
    submission_mode?: PaperSubmissionMode;
    scan_image_count?: number;
    integrity_event_count?: number;
  }>;
  weak_questions: Array<{
    paper_id: string;
    paper_title: string;
    question_id: string;
    attempt_count: number;
    wrong_count: number;
    average_score_percent?: number | null;
    header?: string | null;
    content?: string | null;
    section_id?: string | null;
    tags?: string[];
  }>;
  radar?: Array<{ id: string; label: string; value: number }>;
  date_range?: { from?: string | null; to?: string | null };
};

export type TeacherClassAssignmentRecord = {
  teacher_id: string;
  class_id: string;
  subject?: string | null;
  teacher_username: string;
  teacher_name: string;
  teacher_status: string;
  class_name: string;
  class_grade?: string | null;
};

export type ContentFolder = {
  id: string;
  owner_teacher_id: string;
  scope: "template" | "compose" | "paper";
  parent_id: string | null;
  kind: "category" | "paper";
  name: string;
};

export type ContentTag = { id: string; name: string; color: "slate" | "blue" | "green" | "amber" | "rose" | "violet" };

export type FolderDeleteResult = { parent_id: string | null; folders: ContentFolder[]; items: Record<string, string> };

export type PlatformPaperAnalysis = {
  publication_id?: string | null;
  class_id?: string | null;
  available_classes?: Array<{ id: string; name: string; grade?: string | null }>;
  publications?: Array<{ id: string; title: string; created_at: string; status: string }>;
  paper: {
    paper_id: string;
    exam_id: string;
    title: string;
    subject: string;
    delivery_mode: "offline" | "online";
    status: string;
  };
  summary: {
    total_students: number;
    completed_students: number;
    in_progress_students: number;
    not_started_students: number;
    completion_rate: number;
    average_score?: number | null;
    average_time_seconds?: number | null;
    publication_count: number;
  };
  proctoring: {
    event_count?: number;
    event_type_counts?: Record<string, number>;
    screen_switch_count: number;
    screen_switch_duration_ms: number;
    flagged_student_count: number;
    exceeded_student_count?: number;
  };
  modules?: Array<{
    module_id: string;
    label?: string;
    question_ids?: string[];
    question_count: number;
    student_count: number;
    answered_count: number;
    scored_count: number;
    correct_count?: number;
    wrong_count?: number;
    max_score?: number;
    average_score_percent?: number | null;
    accuracy_rate?: number | null;
    risk_level?: "no_data" | "low" | "medium" | "high" | string;
  }>;
  questions?: Array<{
    question_id: string;
    header?: string | null;
    section_id?: string | null;
    type?: string | null;
    content?: string | null;
    score_per_item?: number | null;
    answered_count: number;
    scored_count: number;
    correct_count?: number;
    wrong_count?: number;
    average_score_percent?: number | null;
    accuracy_rate?: number | null;
    risk_level?: "no_data" | "low" | "medium" | "high" | string;
  }>;
  classes?: Array<{
    class_id: string;
    class_name: string;
    class_grade?: string | null;
    student_count: number;
    completed_count: number;
    in_progress_count: number;
    not_started_count: number;
    completion_rate: number;
    average_score?: number | null;
    average_time_seconds?: number | null;
    screen_switch_count: number;
  }>;
  radar?: Array<{
    id: "completion" | "score" | "time_efficiency" | "proctoring" | "module_mastery" | string;
    label: string;
    value: number;
  }>;
  students: Array<{
    student_id: string;
    student_no: string;
    display_name: string;
    account_username?: string | null;
    status: "completed" | "in_progress" | "not_started";
    score?: number | null;
    max_score?: number | null;
    score_percent?: number | null;
    time_spent_seconds: number;
    screen_switch_count: number;
    screen_switch_limit?: number;
    screen_switch_exceeded?: boolean;
    screen_switch_remaining?: number;
    screen_switch_duration_ms: number;
    integrity_event_count?: number;
    integrity_event_type_counts?: Record<string, number>;
    integrity_risk_score?: number;
    publication_id?: string | null;
    publication_title?: string | null;
    class_names?: string[];
  }>;
};

export type StudentPaperRecord = {
  publication_id: string;
  attempt_id: string;
  paper_id?: string;
  exam_id: string;
  title: string;
  subject?: string | null;
  recipient_scope?: "class" | "student";
  status: "not_started" | "in_progress" | "submitted" | "completed" | string;
  started_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  max_score?: number | null;
  paper_max_score?: number | null;
  score_percent?: number | null;
  time_spent_seconds: number;
  show_results: boolean;
  question_count: number;
  submission_mode?: PaperSubmissionMode;
  publication_status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  time_limit_minutes?: number | null;
  can_answer?: boolean;
  remaining_seconds?: number | null;
  practice_metadata?: {
    kind?: "wrong_questions" | "reinforcement" | string;
    source_count?: number;
    source_publication_ids?: string[];
  };
};

export type StudentQuestionRecord = {
  question_id: string;
  header: string;
  section_id: string;
  score_per_item: number;
  type: string;
  content: string;
  options?: Record<string, string> | null;
};

export type StudentAttemptRecord = Omit<StudentPaperRecord, "attempt_id" | "question_count"> & {
  id: string;
  snapshot_version?: string;
  project_scope?: string;
  submitted_answers_accepted?: boolean;
};

export type StudentResultRecord = StudentAttemptRecord & {
  attempt_id: string;
  answers: Array<{
    question_id: string;
    answer?: unknown;
    images?: StudentAnswerImage[];
    score?: number | null;
    is_correct?: boolean | null;
    feedback?: string | null;
    header?: string | null;
    content?: string | null;
    type?: string | null;
    options?: Record<string, string> | null;
    section_id?: string | null;
    score_per_item?: number | null;
    tags?: string[];
    responded_at?: string | null;
    correct_answer?: unknown;
    analysis?: string | null;
  }>;
  analysis?: {
    correct_count?: number | null;
    wrong_count?: number | null;
    answered_count?: number;
    average_time_per_question_seconds?: number | null;
  };
};
