import { describe, expect, it } from "vitest";
import type { BankDetailState } from "../../../../components/BankQuestionEditorPanel";
import {
  buildQuestionFromForm,
  buildSavePayload,
  checkStaleRequestFencing,
  computeDetailMetaRows,
  createBaselineRecord,
  isSessionDirty,
  reconcileSavedDetail,
  validateAndParseYamlPayload,
} from "../../sessionCore/bankEditSessionCore";

describe("bankEditSessionCore", () => {
  const dummyDetail: BankDetailState = {
    qualified_id: "数学/default/q1",
    question: {
      id: "q1",
      type: "single_choice",
      content: "1 + 1 = ?",
      options: { A: "1", B: "2", C: "3", D: "4" },
      answer: "B",
      analysis: "Basic addition",
      metadata: { difficulty: "easy" },
    },
    file_yaml: "id: q1\ntype: single_choice\ncontent: 1 + 1 = ?\noptions:\n  A: '1'\n  B: '2'\n  C: '3'\n  D: '4'\nanswer: B\nanalysis: Basic addition\nmetadata:\n  difficulty: easy\n",
    storage_path: "resource/数学/default/q1.yaml",
    storage_kind: "single",
    version: "v1",
  };

  it("computes meta rows from detail metadata correctly", () => {
    const rows = computeDetailMetaRows(dummyDetail);
    expect(rows).toEqual([{ key: "difficulty", value: "easy" }]);

    const emptyDetail = { ...dummyDetail, question: { ...dummyDetail.question, metadata: {} } };
    expect(computeDetailMetaRows(emptyDetail)).toEqual([{ key: "", value: "" }]);
  });

  it("creates a consistent baseline record", () => {
    const rows = computeDetailMetaRows(dummyDetail);
    const baseline = createBaselineRecord(dummyDetail, rows);
    expect(baseline.yaml).toBe(dummyDetail.file_yaml);
    expect(JSON.parse(baseline.detailJson)).toEqual(dummyDetail);
    expect(JSON.parse(baseline.metaRowsJson)).toEqual(rows);
  });

  it("calculates session dirty status with exact baseline comparison", () => {
    const rows = computeDetailMetaRows(dummyDetail);
    const baselines = { [dummyDetail.qualified_id]: createBaselineRecord(dummyDetail, rows) };

    // Initially clean
    expect(isSessionDirty(dummyDetail.qualified_id, dummyDetail, dummyDetail.file_yaml, rows, baselines)).toBe(false);

    // Form content edit -> dirty
    const editedDetail: BankDetailState = {
      ...dummyDetail,
      question: { ...dummyDetail.question, content: "2 + 2 = ?" },
    };
    expect(isSessionDirty(dummyDetail.qualified_id, editedDetail, dummyDetail.file_yaml, rows, baselines)).toBe(true);

    // Meta rows edit -> dirty
    expect(isSessionDirty(dummyDetail.qualified_id, dummyDetail, dummyDetail.file_yaml, [{ key: "tag", value: "val" }], baselines)).toBe(true);

    // YAML edit -> dirty
    expect(isSessionDirty(dummyDetail.qualified_id, dummyDetail, "id: q1\ncontent: modified", rows, baselines)).toBe(true);

    // Unselected question is never dirty
    expect(isSessionDirty(null, dummyDetail, dummyDetail.file_yaml, rows, baselines)).toBe(false);
  });

  it("builds correct payload for single question and choice options", () => {
    const rows = [{ key: "author", value: "teacher" }, { key: "   ", value: "ignored" }];
    const payload = buildQuestionFromForm(dummyDetail, rows);
    expect(payload.id).toBe("q1");
    expect(payload.metadata).toEqual({ author: "teacher" });
    expect(payload.options).toEqual({ A: "1", B: "2", C: "3", D: "4" });

    // Fill in question clears options
    const fillDetail: BankDetailState = {
      ...dummyDetail,
      question: { ...dummyDetail.question, type: "fill", options: { A: "1", B: "2" } },
    };
    const fillPayload = buildQuestionFromForm(fillDetail, []);
    expect(fillPayload.options).toBeNull();
  });

  it("builds correct payload for question groups", () => {
    const groupDetail: BankDetailState = {
      ...dummyDetail,
      question_group: {
        id: "group_1",
        type: "group",
        material: "Read passage",
        unified: "single_choice",
        items: [
          {
            content: "Sub 1",
            answer: "A",
            analysis: "expl",
            options: { A: "x", B: "y" },
            metadata: {},
          },
        ],
      },
    };
    const payload = buildSavePayload(groupDetail, []);
    expect(payload.type).toBe("group");
    expect((payload as any).material).toBe("Read passage");
    expect((payload as any).items[0].content).toBe("Sub 1");
  });

  it("validates and parses YAML payload, guarding question ID from alteration", () => {
    const validYaml = "id: q1\ntype: fill\ncontent: valid stem";
    const parsed = validateAndParseYamlPayload(validYaml, dummyDetail.qualified_id);
    expect(parsed.id).toBe("q1");

    // Invalid YAML (non-object or array)
    expect(() => validateAndParseYamlPayload("- not\n- an\n- object", dummyDetail.qualified_id)).toThrow(
      "原文须为结构化内容（顶层应为对象）"
    );
    expect(() => validateAndParseYamlPayload("just a scalar string", dummyDetail.qualified_id)).toThrow(
      "原文须为结构化内容（顶层应为对象）"
    );

    // Changing ID in YAML is prohibited
    const changedIdYaml = "id: q2_renamed\ntype: fill\ncontent: stem";
    expect(() => validateAndParseYamlPayload(changedIdYaml, dummyDetail.qualified_id)).toThrow(
      "题目 ID 不可在 YAML 中修改"
    );
  });

  describe("reconcileSavedDetail", () => {
    it("updates detail and rawYaml when no new edits were made during save", () => {
      const serverUpdatedDetail: BankDetailState = {
        ...dummyDetail,
        version: "v2",
        question: { ...dummyDetail.question, content: "server canonical content" },
        file_yaml: "id: q1\ncontent: server canonical content\n",
      };

      const result = reconcileSavedDetail({
        qid: dummyDetail.qualified_id,
        serverDetail: serverUpdatedDetail,
        currentDetail: dummyDetail,
        currentMetaRows: [{ key: "difficulty", value: "easy" }],
        currentRawYaml: dummyDetail.file_yaml,
        submittedDetailJson: JSON.stringify(dummyDetail),
        submittedMetaRowsJson: JSON.stringify([{ key: "difficulty", value: "easy" }]),
        submittedYaml: dummyDetail.file_yaml,
        savedVersion: "v2",
      });

      expect(result.nextDetail).toEqual(serverUpdatedDetail);
      expect(result.nextRawYaml).toBe(serverUpdatedDetail.file_yaml);
      expect(result.nextEditorTab).toBe("form");
      expect(result.nextBaseline.yaml).toBe(serverUpdatedDetail.file_yaml);
    });

    it("preserves user edits made during in-flight save while updating version", () => {
      const serverUpdatedDetail: BankDetailState = {
        ...dummyDetail,
        version: "v2",
        question: { ...dummyDetail.question, content: "submitted content" },
        file_yaml: "id: q1\ncontent: submitted content\n",
      };

      const userNewerDetail: BankDetailState = {
        ...dummyDetail,
        question: { ...dummyDetail.question, content: "user typed while saving" },
      };

      const result = reconcileSavedDetail({
        qid: dummyDetail.qualified_id,
        serverDetail: serverUpdatedDetail,
        currentDetail: userNewerDetail,
        currentMetaRows: [{ key: "difficulty", value: "easy" }],
        currentRawYaml: "newer yaml text",
        submittedDetailJson: JSON.stringify(dummyDetail),
        submittedMetaRowsJson: JSON.stringify([{ key: "difficulty", value: "easy" }]),
        submittedYaml: dummyDetail.file_yaml,
        savedVersion: "v2",
      });

      // User's newer content must NOT be overwritten by server detail!
      expect(result.nextDetail?.question.content).toBe("user typed while saving");
      // Version should be updated to server's savedVersion
      expect(result.nextDetail?.version).toBe("v2");
      // User's newer YAML must NOT be overwritten!
      expect(result.nextRawYaml).toBe("newer yaml text");
    });
  });

  describe("checkStaleRequestFencing", () => {
    it("accepts matching sequence, qid, and session token", () => {
      expect(
        checkStaleRequestFencing({
          requestSeq: 5,
          currentSeq: 5,
          requestQid: "math/q1",
          currentQid: "math/q1",
          requestSessionToken: "tokenA",
          currentSessionToken: "tokenA",
        })
      ).toBe(true);
    });

    it("rejects mismatched sequence, question, or session", () => {
      // Sequence mismatch
      expect(
        checkStaleRequestFencing({
          requestSeq: 4,
          currentSeq: 5,
          requestQid: "math/q1",
          currentQid: "math/q1",
          requestSessionToken: "tokenA",
          currentSessionToken: "tokenA",
        })
      ).toBe(false);

      // Question ID mismatch
      expect(
        checkStaleRequestFencing({
          requestSeq: 5,
          currentSeq: 5,
          requestQid: "math/q1",
          currentQid: "math/q2",
          requestSessionToken: "tokenA",
          currentSessionToken: "tokenA",
        })
      ).toBe(false);

      // Session token mismatch
      expect(
        checkStaleRequestFencing({
          requestSeq: 5,
          currentSeq: 5,
          requestQid: "math/q1",
          currentQid: "math/q1",
          requestSessionToken: "tokenA",
          currentSessionToken: "tokenB",
        })
      ).toBe(false);
    });
  });
});
