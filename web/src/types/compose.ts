export type QuestionRow = {
  id: string;
  qualified_id: string;
  namespace: string;
  collection?: string;
  /** resource/<科目>/ 下的科目名；namespace `main` 时可为 main */
  subject?: string;
  collection_name?: string;
  type: string;
  content: string;
  content_preview: string;
  answer: string;
  analysis: string;
  metadata?: Record<string, unknown>;
  group_id?: string | null;
  group_member_qualified_ids?: string[];
  group_material?: string | null;
};

export type TemplateSection = {
  section_id: string;
  type: string;
  required_count: number;
  score_per_item: number;
  describe?: string | null;
};

export type TemplateRow = {
  id: string;
  path: string;
  layout: string;
  sections: TemplateSection[];
};

export type ExamWorkspaceStatus = "draft" | "exported";

/** 考试工作区列表项（``GET /api/exams``） */
export type ExamWorkspaceSummary = {
  exam_id: string;
  name?: string | null;
  subject?: string | null;
  export_label?: string | null;
  template_ref?: string | null;
  template_path?: string | null;
  updated_at?: string | null;
  has_pdf?: boolean;
  has_docx?: boolean;
  status?: ExamWorkspaceStatus | null;
};

export type ComposeSelectedItem = {
  section_id: string;
  question_ids: string[];
  score_per_item?: number | null;
  score_overrides?: Record<string, number> | null;
  required_count?: number | null;
};

/** 组卷文档（``exams/<exam_id>/exam.yaml``） */
export type ExamDoc = {
  exam_id: string;
  /** 复制来源考试目录标识（``标签段/学科段``） */
  source_exam_id?: string;
  name?: string;
  subject?: string;
  export_label?: string;
  template_ref?: string;
  template_path?: string;
  selected_items?: ComposeSelectedItem[];
};

/** @deprecated 使用 ExamDoc */
export type DraftDoc = ExamDoc;

/** 试卷栏选中项：仅同一 `section_id` 内可多选，用于批量移出或同节重排 */
export type RightSelection = { sectionId: string; qids: string[] };

export type GraphBindingNode = {
  id: string;
  canonical_name: string;
  node_kind?: string;
};

/** 组卷可编辑业务状态（纳入撤销/重做与本地草稿快照） */
export type ComposePaperState = {
  exportLabel: string;
  subject: string;
  templatePath: string;
  templateRef: string;
  draftName: string;
  bySection: Record<string, string[]>;
  scoreBySection: Record<string, number | undefined>;
  countBySection: Record<string, number>;
  scoreOverrides: Record<string, Record<string, number>>;
  perQuestionMode: Record<string, boolean>;
};

/** 组卷编辑历史栈（支持撤销/重做与已保存基线比对） */
export type ComposeHistoryState = {
  past: ComposePaperState[];
  present: ComposePaperState;
  future: ComposePaperState[];
  baseline: ComposePaperState;
};

export type ComposeAddQuestionsResult =
  | {
      ok: true;
      changed: boolean;
      nextState: ComposePaperState;
      addedIds: string[];
      skippedTypeCount: number;
    }
  | {
      ok: false;
      errorCode: "selectQuestionFirst" | "sectionNotFound" | "textSectionNoPick" | "sectionFull";
    }
  | {
      ok: false;
      errorCode: "typeMismatch";
      need: string;
      got: string;
    };

export type ComposeRemoveQuestionsResult =
  | {
      ok: true;
      changed: boolean;
      nextState: ComposePaperState;
      removedIds: string[];
    }
  | {
      ok: false;
      errorCode: "selectPaperItemFirst";
    };

export type ComposeMoveQuestionsResult = {
  ok: boolean;
  changed: boolean;
  nextState: ComposePaperState;
  errorCode?: "selectQuestionFirst" | "sectionNotFound" | "textSectionNoPick" | "sectionFull" | "typeMismatch";
  need?: string;
  got?: string;
};

/** 严格按「账号 + 项目 + 试卷」隔离的本地草稿作用域 */
export type ComposeDraftScope = {
  accountId: string;
  projectRoot: string;
  paperKey: string;
};

/** 本地草稿持久化结构（绝不包含任何认证令牌或敏感凭据） */
export type ComposeLocalDraftRecord = {
  version: 1;
  scope: ComposeDraftScope;
  updatedAt: string;
  paper: ComposePaperState;
};

export type ComposeDraftStorageStatus =
  | "idle"
  | "scope_unavailable"
  | "saved"
  | "corrupted_cleared"
  | "quota_exceeded"
  | "storage_error";

export type ComposeExportTaskFormat = "pdf" | "docx";

export type ComposeExportTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type ComposeExportTaskResult = {
  ok?: boolean;
  exam_dir: string;
  student_pdf?: string;
  teacher_pdf?: string;
  student_docx?: string;
  teacher_docx?: string;
};

export type ComposeExportTaskError = {
  status: number;
  detail: unknown;
};

export type ComposeExportTaskView = {
  id: string;
  format: ComposeExportTaskFormat;
  status: ComposeExportTaskStatus;
  created_at: string;
  updated_at: string;
  attempt: number;
  result: ComposeExportTaskResult | null;
  error: ComposeExportTaskError | null;
};

export type ComposeExportTaskCreateRequest = {
  export_label: string;
  subject: string;
  metadata_title?: string;
  template_ref: string;
  template_path: string;
  selected_items: ComposeSelectedItem[];
  overwrite_existing?: string;
  exam_workspace_id?: string;
  exam_ids_to_delete_on_success?: string[];
  format: ComposeExportTaskFormat;
  request_key?: string;
};

