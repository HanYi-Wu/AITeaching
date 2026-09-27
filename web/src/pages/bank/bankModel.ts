import { type QuestionGroupJson } from "../../components/BankQuestionEditorPanel";
import { isChoiceQuestionType } from "../../lib/questionTypes";

/** 新建题组时生成一条占位小题（与后端 QuestionGroupRecord 一致） */
export function defaultItemsForNewGroup(unifiedUi: string, subStem: string): QuestionGroupJson["items"] {
  if (unifiedUi === "mixed") {
    return [
      {
        type: "single_choice",
        content: subStem,
        options: { A: "", B: "", C: "", D: "" },
        answer: "A",
        analysis: "",
        metadata: {},
      },
    ];
  }
  if (isChoiceQuestionType(unifiedUi)) {
    return [{ content: subStem, options: { A: "", B: "", C: "", D: "" }, answer: "A", analysis: "", metadata: {} }];
  }
  if (unifiedUi === "fill") {
    return [{ content: subStem, answer: "", analysis: "", metadata: {} }];
  }
  if (unifiedUi === "judge") {
    return [{ content: subStem, answer: "T", analysis: "", metadata: {} }];
  }
  return [{ content: subStem, answer: "", analysis: "", metadata: {} }];
}

export type BankListItem = {
  id: string;
  qualified_id: string;
  collection: string;
  subject?: string;
  collection_name?: string;
  type: string;
  content_preview: string;
  answer_relation_needs_review?: boolean;
  metadata: Record<string, unknown>;
  storage_path: string;
  storage_kind: string;
  group_id?: string | null;
  group_member_qualified_ids?: string[];
  group_material?: string | null;
};

export type BankCollectionRow = {
  id: string;
  label: string;
  subject: string;
  collection: string;
};
