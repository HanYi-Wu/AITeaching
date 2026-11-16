import { describe, expect, it } from "vitest";
import {
  addGroupSubItem,
  createGroupSubItem,
  getUnifiedUiInfo,
  giFieldId,
  parseGroupMemberIndex,
  readDifficultyMetaSelectValue,
  removeLastGroupSubItem,
  resolveEditorSaveAction,
  updateCategoryMetaRow,
  updateDifficultyMetaRow,
  updateGroupMaterial,
  updateGroupMemberField,
  updateGroupMemberOptions,
  updateGroupMemberType,
  updateGroupUnifiedType,
  updateSingleQuestionType,
} from "./bankEditorAdapters";
import type { BankDetailState, QuestionGroupJson, QuestionJson } from "./bankEditorTypes";

describe("bankEditorAdapters", () => {
  it("formats giFieldId correctly", () => {
    expect(giFieldId(0, "content")).toBe("bank-gi-0-content");
    expect(giFieldId(2, "answer")).toBe("bank-gi-2-answer");
    expect(giFieldId(1, "analysis")).toBe("bank-gi-1-analysis");
  });

  it("parses member index from synthetic question id", () => {
    expect(parseGroupMemberIndex("q_group_001__01")).toBe(0);
    expect(parseGroupMemberIndex("q_group_001__03")).toBe(2);
    expect(parseGroupMemberIndex("q_single_001")).toBe(0);
  });

  it("resolves unifiedUi info for null, mixed, and unified groups", () => {
    expect(getUnifiedUiInfo(null)).toEqual({
      unifiedUi: "single_choice",
      innerTypeForItems: "single_choice",
    });

    const mixedGroup: QuestionGroupJson = {
      id: "grp1",
      type: "group",
      material: "Mat",
      unified: false,
      items: [],
    };
    expect(getUnifiedUiInfo(mixedGroup)).toEqual({
      unifiedUi: "mixed",
      innerTypeForItems: "single_choice",
    });

    const singleChoiceGroup: QuestionGroupJson = {
      id: "grp2",
      type: "group",
      material: "Mat",
      unified: "single_choice",
      items: [],
    };
    expect(getUnifiedUiInfo(singleChoiceGroup)).toEqual({
      unifiedUi: "single_choice",
      innerTypeForItems: "single_choice",
    });

    const essayGroup: QuestionGroupJson = {
      id: "grp3",
      type: "group",
      material: "Mat",
      unified: "essay",
      items: [],
    };
    expect(getUnifiedUiInfo(essayGroup)).toEqual({
      unifiedUi: "essay",
      innerTypeForItems: "essay",
    });
  });

  it("switches single question type between choice and non-choice", () => {
    const q: QuestionJson = {
      id: "q1",
      type: "essay",
      content: "Explain X",
      answer: "Ans",
      analysis: "Ana",
    };

    const choiceQ = updateSingleQuestionType(q, "single_choice");
    expect(choiceQ.type).toBe("single_choice");
    expect(choiceQ.options).toEqual({ A: "", B: "", C: "", D: "" });

    const essayQ = updateSingleQuestionType(choiceQ, "essay");
    expect(essayQ.type).toBe("essay");
    expect(essayQ.options).toBeNull();
  });

  const baseDetail: BankDetailState = {
    qualified_id: "test:q_group__01",
    question: {
      id: "q_group__01",
      type: "single_choice",
      content: "Sub 1 content",
      answer: "A",
      analysis: "Ana",
      options: { A: "1", B: "2", C: "3", D: "4" },
    },
    file_yaml: "",
    storage_path: "questions/q_group.yaml",
    storage_kind: "file",
    question_group: {
      id: "q_group",
      type: "group",
      material: "Shared material",
      unified: "single_choice",
      items: [
        {
          type: "single_choice",
          content: "Sub 1 content",
          answer: "A",
          analysis: "Ana",
          options: { A: "1", B: "2", C: "3", D: "4" },
        },
      ],
    },
  };

  it("updates group unified type to mixed and non-choice", () => {
    const toMixed = updateGroupUnifiedType(baseDetail, "mixed");
    expect(toMixed.question_group?.unified).toBe(false);

    const toEssay = updateGroupUnifiedType(baseDetail, "essay");
    expect(toEssay.question_group?.unified).toBe("essay");
    expect(toEssay.question_group?.items[0].options).toBeUndefined();
    expect(toEssay.question.options).toBeNull();
  });

  it("adds and removes sub items correctly", () => {
    const subChoice = createGroupSubItem("single_choice", "single_choice");
    expect(subChoice.options).toEqual({ A: "", B: "", C: "", D: "" });

    const added = addGroupSubItem(baseDetail, "single_choice", "single_choice");
    expect(added.question_group?.items.length).toBe(2);

    const removed = removeLastGroupSubItem(added);
    expect(removed.question_group?.items.length).toBe(1);

    // Cannot remove when only 1 item remaining
    const cannotRemove = removeLastGroupSubItem(removed);
    expect(cannotRemove.question_group?.items.length).toBe(1);
  });

  it("updates sub item field and synchronizes synthetic question when active", () => {
    const updated = updateGroupMemberField(baseDetail, 0, 0, "content", "Updated sub 1");
    expect(updated.question_group?.items[0].content).toBe("Updated sub 1");
    expect(updated.question.content).toBe("Updated sub 1");
    expect(updated.question.group_material).toBe("Shared material");

    const updateOther = updateGroupMemberField(baseDetail, 1, 0, "content", "Updated inactive");
    expect(updateOther.question_group?.items[0].content).toBe("Updated inactive");
    expect(updateOther.question.content).toBe("Sub 1 content"); // untouched
  });

  it("updates sub item options and group material", () => {
    const nextOpts = { A: "x", B: "y", C: "z", D: "w" };
    const withOpts = updateGroupMemberOptions(baseDetail, 0, 0, nextOpts);
    expect(withOpts.question_group?.items[0].options).toEqual(nextOpts);
    expect(withOpts.question.options).toEqual(nextOpts);

    const withMat = updateGroupMaterial(baseDetail, "New material text");
    expect(withMat.question_group?.material).toBe("New material text");
    expect(withMat.question.group_material).toBe("New material text");
  });

  it("updates group member type in mixed mode", () => {
    const updated = updateGroupMemberType(baseDetail, 0, "essay");
    expect(updated.question_group?.items[0].type).toBe("essay");
    expect(updated.question_group?.items[0].options).toBeUndefined();
  });

  it("resolves editor save action and updates category meta row", () => {
    expect(resolveEditorSaveAction("yaml", "form")).toBe("yaml");
    expect(resolveEditorSaveAction("form", "yaml")).toBe("form");
    expect(resolveEditorSaveAction("full", "yaml")).toBe("yaml");
    expect(resolveEditorSaveAction("full", "form")).toBe("form");

    const rows = [{ key: "diff", value: "easy" }];
    const nextRows = updateCategoryMetaRow(rows, "homework");
    expect(nextRows).toEqual([
      { key: "diff", value: "easy" },
      { key: "category", value: "homework" },
    ]);
  });

  it("normalizes and updates difficulty metadata rows", () => {
    expect(readDifficultyMetaSelectValue([])).toBe("__unset__");
    expect(readDifficultyMetaSelectValue([{ key: "difficulty", value: "较难" }])).toBe("hard");
    expect(readDifficultyMetaSelectValue([{ key: "difficulty", value: "0.2" }])).toBe("easy");
    expect(readDifficultyMetaSelectValue([{ key: "difficulty", value: "中等" }])).toBe("medium");

    const updated = updateDifficultyMetaRow([{ key: "category", value: "月考" }], "hard");
    expect(updated).toEqual([
      { key: "category", value: "月考" },
      { key: "difficulty", value: "hard" },
    ]);
    expect(updateDifficultyMetaRow(updated, "__unset__")).toEqual([
      { key: "category", value: "月考" },
    ]);
  });
});
