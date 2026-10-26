import type { Dispatch, RefObject, SetStateAction, ChangeEvent } from "react";
import type { EmbedKind } from "../lib/bankEditorEmbedKinds";

export type QuestionJson = {
  id: string;
  type: string;
  content: string;
  options?: Record<string, string> | null;
  answer: string;
  analysis: string;
  metadata?: Record<string, unknown>;
  /** 题组展开时由后端填充，编辑材料时同步 */
  group_material?: string | null;
};

export type GroupMemberJson = {
  /** 混编（unified: false）时必填 */
  type?: string;
  content: string;
  options?: Record<string, string> | null;
  answer: string;
  analysis: string;
  metadata?: Record<string, unknown>;
};

export type QuestionGroupJson = {
  id: string;
  type: "group";
  material: string;
  /** false = 混编；否则为同型小题题型 */
  unified: boolean | string;
  items: GroupMemberJson[];
};

export type BankDetailState = {
  qualified_id: string;
  question: QuestionJson;
  question_display?: QuestionJson;
  file_yaml: string;
  storage_path: string;
  storage_kind: string;
  question_group?: QuestionGroupJson | null;
  question_group_preview?: { material: string; items: GroupMemberJson[]; unified?: boolean | string } | null;
};

export type { EmbedKind, MathFieldKey } from "../lib/bankEditorEmbedKinds";

export type MetaRow = { key: string; value: string };

export type GiLatexMemberField = "content" | "answer" | "analysis";

export type BankQuestionEditorPanelProps = {
  /** full：表单+源码双 Tab；form / yaml：仅显示对应区块（用于外层「字段 / 源文件」分栏） */
  panelMode?: "full" | "form" | "yaml";
  detail: BankDetailState;
  setDetail: Dispatch<SetStateAction<BankDetailState | null>>;
  busy: boolean;
  editorTab: "form" | "yaml";
  setEditorTab: Dispatch<SetStateAction<"form" | "yaml">>;
  rawYaml: string;
  setRawYaml: Dispatch<SetStateAction<string>>;
  metaRows: MetaRow[];
  setMetaRows: Dispatch<SetStateAction<MetaRow[]>>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  answerRef: RefObject<HTMLTextAreaElement | null>;
  analysisRef: RefObject<HTMLTextAreaElement | null>;
  materialGroupRef: RefObject<HTMLTextAreaElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  beginMathEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginMermaidEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginPrimeBrushEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginImageEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  onImageFileSelected: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onSave: () => void;
  onSaveYaml: () => void;
  onClose?: () => void;
  removeLabel?: string;
  /** 为 true 时不渲染外层白卡片与顶栏（由父级提供标题栏时） */
  embedded?: boolean;
};
