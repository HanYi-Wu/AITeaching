import type { BankDetailState } from "../../../components/BankQuestionEditorPanel";

export type MetaRow = { key: string; value: string };

export interface BankBaselineRecord {
  yaml: string;
  detailJson: string;
  metaRowsJson: string;
}

export type BankBaselines = Record<string, BankBaselineRecord>;

export interface BankSaveConflict {
  qid: string;
  latest: BankDetailState | null;
  message: string;
}

export type BankWorkView = "fields" | "preview" | "source";
export type BankEditorTab = "form" | "yaml";

export interface BankEditSessionSnapshot {
  selectedId: string | null;
  detail: BankDetailState | null;
  rawYaml: string;
  metaRows: MetaRow[];
  editorTab: BankEditorTab;
  workView: BankWorkView;
  dirty: boolean;
  saving: boolean;
  saveConflict: BankSaveConflict | null;
}

export type BankImportStage =
  | "idle"
  | "reading"
  | "submitting"
  | "committed"
  | "refreshing_list"
  | "refresh_failed"
  | "failed";

export interface BankImportResult {
  written: number;
  namespace: string;
  subject: string;
  collection: string;
  warnings?: string[];
}

export interface BankImportTransactionState {
  stage: BankImportStage;
  targetSubject: string;
  targetCollection: string;
  result: BankImportResult | null;
  error: string | null;
  sourceKind: "yaml_text" | "yaml_file" | "zip_bundle" | null;
}
