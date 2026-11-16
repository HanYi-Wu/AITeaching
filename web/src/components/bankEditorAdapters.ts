import { isChoiceQuestionType } from "../lib/questionTypes";
import type {
  BankDetailState,
  GiLatexMemberField,
  GroupMemberJson,
  MetaRow,
  QuestionGroupJson,
  QuestionJson,
} from "./bankEditorTypes";

export function giFieldId(i: number, f: GiLatexMemberField): string {
  return `bank-gi-${i}-${f}`;
}

export function parseGroupMemberIndex(questionId: string): number {
  const m = questionId.match(/__(\d{2})$/);
  return m ? parseInt(m[1], 10) - 1 : 0;
}

export function getUnifiedUiInfo(qg?: QuestionGroupJson | null): {
  unifiedUi: string;
  innerTypeForItems: string;
} {
  const unifiedUi = qg ? (qg.unified === false ? "mixed" : String(qg.unified)) : "single_choice";
  const innerTypeForItems = unifiedUi === "mixed" ? "single_choice" : unifiedUi;
  return { unifiedUi, innerTypeForItems };
}

export function updateSingleQuestionType(question: QuestionJson, newType: string): QuestionJson {
  if (isChoiceQuestionType(newType)) {
    return {
      ...question,
      type: newType,
      options: question.options ?? { A: "", B: "", C: "", D: "" },
    };
  }
  const { options: _omit, ...rest } = question;
  return {
    ...rest,
    type: newType,
    options: null,
  };
}

export function updateGroupUnifiedType(
  detail: BankDetailState,
  newUnifiedStr: string,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;

  const u = newUnifiedStr;
  const unifiedVal = u === "mixed" ? false : u;
  let items = qg.items.map((it) => ({ ...it }));

  if (u === "mixed") {
    /* 混编：不批量改各小题 options */
  } else if (isChoiceQuestionType(u)) {
    items = items.map((it) => ({
      ...it,
      options:
        it.options && Object.keys(it.options).length
          ? it.options
          : { A: "", B: "", C: "", D: "" },
    }));
  } else {
    items = items.map((it) => {
      const { options: _omit, ...rest } = it as GroupMemberJson & {
        options?: Record<string, string>;
      };
      return rest as GroupMemberJson;
    });
  }

  return {
    ...detail,
    question_group: { ...qg, unified: unifiedVal, items },
    question: {
      ...detail.question,
      type: u === "mixed" ? "single_choice" : u,
      options:
        u === "mixed"
          ? detail.question.options
          : isChoiceQuestionType(u)
            ? detail.question.options ?? { A: "", B: "", C: "", D: "" }
            : null,
    },
  };
}

export function createGroupSubItem(
  unifiedUi: string,
  innerTypeForItems: string,
): GroupMemberJson {
  const emptyChoiceOpts = { A: "", B: "", C: "", D: "" };
  if (unifiedUi === "mixed") {
    return {
      type: "single_choice",
      content: "",
      answer: "",
      analysis: "",
      metadata: {},
      options: emptyChoiceOpts,
    };
  }
  if (isChoiceQuestionType(innerTypeForItems)) {
    return {
      content: "",
      answer: "",
      analysis: "",
      metadata: {},
      options: emptyChoiceOpts,
    };
  }
  return {
    content: "",
    answer: "",
    analysis: "",
    metadata: {},
  };
}

export function addGroupSubItem(
  detail: BankDetailState,
  unifiedUi: string,
  innerTypeForItems: string,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;
  const newItem = createGroupSubItem(unifiedUi, innerTypeForItems);
  return {
    ...detail,
    question_group: {
      ...qg,
      items: [...qg.items, newItem],
    },
  };
}

export function removeLastGroupSubItem(detail: BankDetailState): BankDetailState {
  const qg = detail.question_group;
  if (!qg || qg.items.length <= 1) return detail;
  return {
    ...detail,
    question_group: {
      ...qg,
      items: qg.items.slice(0, -1),
    },
  };
}

export function updateGroupMemberField(
  detail: BankDetailState,
  memberIdx: number,
  targetIdx: number,
  field: GiLatexMemberField,
  value: string,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;
  const items = [...qg.items];
  items[targetIdx] = { ...items[targetIdx], [field]: value };

  let question = detail.question;
  if (memberIdx === targetIdx) {
    if (field === "content") {
      question = { ...question, content: value, group_material: qg.material };
    } else {
      question = { ...question, [field]: value };
    }
  }

  return {
    ...detail,
    question_group: { ...qg, items },
    question,
  };
}

export function updateGroupMemberOptions(
  detail: BankDetailState,
  memberIdx: number,
  targetIdx: number,
  options: Record<string, string>,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;
  const items = [...qg.items];
  items[targetIdx] = { ...items[targetIdx], options };

  let question = detail.question;
  if (memberIdx === targetIdx) {
    question = { ...question, options };
  }

  return {
    ...detail,
    question_group: { ...qg, items },
    question,
  };
}

export function updateGroupMemberType(
  detail: BankDetailState,
  targetIdx: number,
  newType: string,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;
  const items = [...qg.items];
  const cur = items[targetIdx];
  if (isChoiceQuestionType(newType)) {
    items[targetIdx] = {
      ...cur,
      type: newType,
      options: cur.options ?? { A: "", B: "", C: "", D: "" },
    };
  } else {
    const { options: _o, ...rest } = cur as GroupMemberJson & {
      options?: Record<string, string>;
    };
    items[targetIdx] = { ...rest, type: newType };
  }
  return {
    ...detail,
    question_group: { ...qg, items },
  };
}

export function updateGroupMaterial(
  detail: BankDetailState,
  material: string,
): BankDetailState {
  const qg = detail.question_group;
  if (!qg) return detail;
  return {
    ...detail,
    question_group: { ...qg, material },
    question: { ...detail.question, group_material: material },
  };
}

export function resolveEditorSaveAction(
  panelMode: "full" | "form" | "yaml",
  editorTab: "form" | "yaml",
): "yaml" | "form" {
  if (panelMode === "yaml") return "yaml";
  if (panelMode === "form") return "form";
  return editorTab === "yaml" ? "yaml" : "form";
}

const DIFFICULTY_ALIASES: Record<string, "easy" | "medium" | "hard"> = {
  easy: "easy",
  low: "easy",
  低: "easy",
  简单: "easy",
  容易: "easy",
  medium: "medium",
  中: "medium",
  中等: "medium",
  适中: "medium",
  hard: "hard",
  high: "hard",
  高: "hard",
  难: "hard",
  困难: "hard",
  较难: "hard",
};

export function updateCategoryMetaRow(metaRows: MetaRow[], categoryValue: string): MetaRow[] {
  return [
    ...metaRows.filter((row) => row.key !== "category"),
    { key: "category", value: categoryValue },
  ];
}

/** Normalizes existing `difficulty` metadata to `"easy" | "medium" | "hard"` or `"__unset__"`. */
export function readDifficultyMetaSelectValue(metaRows: MetaRow[]): string {
  const raw = metaRows.find((row) => row.key.trim() === "difficulty")?.value?.trim() ?? "";
  if (!raw) return "__unset__";
  const normalized = raw.normalize("NFKC").toLowerCase();
  if (normalized in DIFFICULTY_ALIASES) {
    return DIFFICULTY_ALIASES[normalized];
  }
  const num = Number(normalized);
  if (Number.isFinite(num) && num >= 0 && num <= 1) {
    if (num <= 1 / 3) return "easy";
    if (num <= 2 / 3) return "medium";
    return "hard";
  }
  return "__unset__";
}

/** Sets or clears the `difficulty` metadata row while leaving unrelated rows untouched. */
export function updateDifficultyMetaRow(metaRows: MetaRow[], difficultyValue: string): MetaRow[] {
  const rest = metaRows.filter((row) => row.key.trim() !== "difficulty");
  return difficultyValue && difficultyValue !== "__unset__"
    ? [...rest, { key: "difficulty", value: difficultyValue }]
    : rest;
}
