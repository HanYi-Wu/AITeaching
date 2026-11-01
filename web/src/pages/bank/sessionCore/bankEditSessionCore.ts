import yaml from "js-yaml";
import { isChoiceQuestionType } from "../../../lib/questionTypes";
import type {
  BankDetailState,
  GroupMemberJson,
  QuestionGroupJson,
  QuestionJson,
} from "../../../components/BankQuestionEditorPanel";
import type {
  BankBaselineRecord,
  BankBaselines,
  BankEditorTab,
  MetaRow,
} from "./types";

export function computeDetailMetaRows(detail: BankDetailState): MetaRow[] {
  const m = detail.question?.metadata ?? {};
  return Object.keys(m).length
    ? Object.entries(m).map(([k, v]) => ({ key: k, value: String(v) }))
    : [{ key: "", value: "" }];
}

export function createBaselineRecord(
  detail: BankDetailState,
  metaRows: MetaRow[]
): BankBaselineRecord {
  return {
    yaml: detail.file_yaml,
    detailJson: JSON.stringify(detail),
    metaRowsJson: JSON.stringify(metaRows),
  };
}

export function isSessionDirty(
  selectedId: string | null,
  detail: BankDetailState | null,
  rawYaml: string,
  metaRows: MetaRow[],
  baselines: BankBaselines
): boolean {
  if (!selectedId || !detail || detail.qualified_id !== selectedId) {
    return false;
  }
  const baseline = baselines[selectedId];
  if (!baseline) {
    return false;
  }
  const yamlDirty = rawYaml !== baseline.yaml;
  const formDirty = JSON.stringify(detail) !== baseline.detailJson;
  const metaRowsDirty = JSON.stringify(metaRows) !== baseline.metaRowsJson;
  return yamlDirty || formDirty || metaRowsDirty;
}

export function buildQuestionFromForm(
  detail: BankDetailState,
  metaRows: MetaRow[]
): QuestionJson {
  const q = { ...detail.question };
  const meta: Record<string, unknown> = {};
  for (const row of metaRows) {
    if (row.key.trim()) {
      meta[row.key.trim()] = row.value;
    }
  }
  q.metadata = meta;
  if (isChoiceQuestionType(q.type)) {
    q.options = { ...(detail.question.options ?? { A: "", B: "", C: "", D: "" }) };
  } else {
    q.options = null;
  }
  return q;
}

export function buildQuestionGroupFromForm(
  detail: BankDetailState
): QuestionGroupJson {
  if (!detail.question_group) {
    throw new Error("Missing question group");
  }
  const g = detail.question_group;
  const unified = g.unified === false ? false : g.unified;
  const items = g.items.map((it: GroupMemberJson) => {
    let options: Record<string, string> | undefined;
    const itemType =
      unified === false ? (it.type ?? "single_choice") : typeof unified === "string" ? unified : "single_choice";
    if (isChoiceQuestionType(itemType)) {
      options = { ...(it.options ?? { A: "", B: "", C: "", D: "" }) };
    }
    if (unified === false) {
      return {
        type: it.type ?? "single_choice",
        content: it.content,
        answer: it.answer,
        analysis: it.analysis ?? "",
        metadata: (it.metadata ?? {}) as Record<string, unknown>,
        ...(options ? { options } : {}),
      };
    }
    return {
      content: it.content,
      answer: it.answer,
      analysis: it.analysis ?? "",
      metadata: (it.metadata ?? {}) as Record<string, unknown>,
      ...(options ? { options } : {}),
    };
  });
  return {
    id: g.id,
    type: "group",
    material: g.material,
    unified,
    items,
  };
}

export function buildSavePayload(
  detail: BankDetailState,
  metaRows: MetaRow[]
): QuestionJson | QuestionGroupJson {
  return detail.question_group
    ? buildQuestionGroupFromForm(detail)
    : buildQuestionFromForm(detail, metaRows);
}

export function validateAndParseYamlPayload(
  rawYaml: string,
  qid: string
): Record<string, unknown> {
  const parsed = yaml.load(rawYaml) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("原文须为结构化内容（顶层应为对象）");
  }
  const obj = parsed as Record<string, unknown>;
  const expectedId = qid.split("/").at(-1);
  if (String(obj.id ?? "") !== expectedId) {
    throw new Error("题目 ID 不可在 YAML 中修改；如需更名，请新建题目后迁移内容。");
  }
  return obj;
}

export interface ReconcileResult {
  nextDetail: BankDetailState | null;
  nextMetaRows: MetaRow[];
  nextRawYaml: string;
  nextEditorTab?: BankEditorTab;
  nextBaseline: BankBaselineRecord;
}

export function reconcileSavedDetail(params: {
  qid: string;
  serverDetail: BankDetailState;
  currentDetail: BankDetailState | null;
  currentMetaRows: MetaRow[];
  currentRawYaml: string;
  submittedDetailJson: string;
  submittedMetaRowsJson: string;
  submittedYaml: string;
  savedVersion?: string;
}): ReconcileResult {
  const {
    qid,
    serverDetail,
    currentDetail,
    currentMetaRows,
    currentRawYaml,
    submittedDetailJson,
    submittedMetaRowsJson,
    submittedYaml,
    savedVersion,
  } = params;

  const nextMetaRowsForServer = computeDetailMetaRows(serverDetail);
  const nextBaseline = createBaselineRecord(serverDetail, nextMetaRowsForServer);

  const belongsToSameQuestion = currentDetail?.qualified_id === qid;
  const formUnchanged =
    !belongsToSameQuestion ||
    (JSON.stringify(currentDetail) === submittedDetailJson &&
      JSON.stringify(currentMetaRows) === submittedMetaRowsJson);
  const yamlUnchanged = !belongsToSameQuestion || currentRawYaml === submittedYaml;

  let nextDetail = currentDetail;
  let nextMetaRows = currentMetaRows;
  let nextRawYaml = currentRawYaml;
  let nextEditorTab: BankEditorTab | undefined;

  if (formUnchanged) {
    nextDetail = serverDetail;
    nextMetaRows = nextMetaRowsForServer;
  } else if (savedVersion && currentDetail?.qualified_id === qid) {
    nextDetail = { ...currentDetail, version: savedVersion };
  }

  if (yamlUnchanged) {
    nextRawYaml = serverDetail.file_yaml;
  }

  if (formUnchanged && yamlUnchanged) {
    nextEditorTab = "form";
  }

  return {
    nextDetail,
    nextMetaRows,
    nextRawYaml,
    nextEditorTab,
    nextBaseline,
  };
}

export function checkStaleRequestFencing(params: {
  requestSeq: number;
  currentSeq: number;
  requestQid: string;
  currentQid: string | null;
  requestSessionToken: string | null;
  currentSessionToken: string | null;
}): boolean {
  return (
    params.requestSeq === params.currentSeq &&
    params.requestQid === params.currentQid &&
    params.requestSessionToken === params.currentSessionToken
  );
}
