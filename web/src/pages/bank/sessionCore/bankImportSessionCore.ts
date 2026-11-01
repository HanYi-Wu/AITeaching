import type {
  BankImportResult,
  BankImportStage,
  BankImportTransactionState,
} from "./types";

export const INITIAL_IMPORT_TRANSACTION_STATE: BankImportTransactionState = {
  stage: "idle",
  targetSubject: "",
  targetCollection: "",
  result: null,
  error: null,
  sourceKind: null,
};

export interface ImportExecutionOutcome {
  ok: boolean;
  committed: boolean;
  result: BankImportResult | null;
  error: string | null;
  stage: BankImportStage;
}

export async function executeYamlTextImport(params: {
  yaml: string;
  targetSubject: string;
  targetCollection: string;
  postImportApi: (body: {
    yaml: string;
    target_subject: string;
    target_collection: string;
  }) => Promise<{
    written?: number;
    namespace?: string;
    subject?: string;
    collection?: string;
    warnings?: string[];
  }>;
  loadListApi: () => Promise<void>;
  onStateChange?: (state: BankImportTransactionState) => void;
}): Promise<ImportExecutionOutcome> {
  const { yaml, targetSubject, targetCollection, postImportApi, loadListApi, onStateChange } = params;

  // Snapshot target at start of submission
  const subjSnapshot = targetSubject.trim();
  const collSnapshot = targetCollection.trim() || "imported";

  let state: BankImportTransactionState = {
    stage: "submitting",
    targetSubject: subjSnapshot,
    targetCollection: collSnapshot,
    result: null,
    error: null,
    sourceKind: "yaml_text",
  };
  onStateChange?.(state);

  let postResult: {
    written?: number;
    namespace?: string;
    subject?: string;
    collection?: string;
    warnings?: string[];
  };

  try {
    postResult = await postImportApi({
      yaml,
      target_subject: subjSnapshot,
      target_collection: collSnapshot,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    state = {
      ...state,
      stage: "failed",
      error: errorMsg,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: false,
      result: null,
      error: errorMsg,
      stage: "failed",
    };
  }

  // Server commit succeeded!
  const importResult: BankImportResult = {
    written: postResult?.written ?? 0,
    namespace: postResult?.namespace ?? `${subjSnapshot}/${collSnapshot}`,
    subject: postResult?.subject ?? subjSnapshot,
    collection: postResult?.collection ?? collSnapshot,
    warnings: postResult?.warnings,
  };

  state = {
    ...state,
    stage: "committed",
    result: importResult,
    error: null,
  };
  onStateChange?.(state);

  // Transition to refreshing list
  state = {
    ...state,
    stage: "refreshing_list",
  };
  onStateChange?.(state);

  try {
    await loadListApi();
    state = {
      ...state,
      stage: "idle",
      error: null,
    };
    onStateChange?.(state);
    return {
      ok: true,
      committed: true,
      result: importResult,
      error: null,
      stage: "idle",
    };
  } catch (refreshErr) {
    const refreshErrorMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
    const combinedMsg = `导入已成功写入服务端（共 ${importResult.written} 题至 ${importResult.namespace}），但刷新题目列表失败：${refreshErrorMsg}。请点击重试刷新列表，无需重新导入。`;
    state = {
      ...state,
      stage: "refresh_failed",
      error: combinedMsg,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: true,
      result: importResult,
      error: combinedMsg,
      stage: "refresh_failed",
    };
  }
}

export async function executeFileImport(params: {
  file: File;
  targetSubject: string;
  targetCollection: string;
  postImportApi: (body: {
    yaml: string;
    target_subject: string;
    target_collection: string;
  }) => Promise<{
    written?: number;
    namespace?: string;
    subject?: string;
    collection?: string;
    warnings?: string[];
  }>;
  postBundleApi: (formData: FormData) => Promise<{
    written: number;
    namespace?: string;
    subject?: string;
    collection?: string;
    warnings?: string[];
  }>;
  loadListApi: () => Promise<void>;
  onStateChange?: (state: BankImportTransactionState) => void;
}): Promise<ImportExecutionOutcome> {
  const { file, targetSubject, targetCollection, postImportApi, postBundleApi, loadListApi, onStateChange } = params;

  const fileName = file.name.toLowerCase();
  const subjSnapshot = targetSubject.trim();
  const collSnapshot = targetCollection.trim() || "imported";
  const isZip = fileName.endsWith(".zip");
  const isYaml = fileName.endsWith(".yaml") || fileName.endsWith(".yml");

  if (!isZip && !isYaml) {
    const errorMsg = "仅支持导入 .yaml / .yml 文本文件或 .zip 题目包";
    const state: BankImportTransactionState = {
      stage: "failed",
      targetSubject: subjSnapshot,
      targetCollection: collSnapshot,
      result: null,
      error: errorMsg,
      sourceKind: null,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: false,
      result: null,
      error: errorMsg,
      stage: "failed",
    };
  }

  let state: BankImportTransactionState = {
    stage: "reading",
    targetSubject: subjSnapshot,
    targetCollection: collSnapshot,
    result: null,
    error: null,
    sourceKind: isZip ? "zip_bundle" : "yaml_file",
  };
  onStateChange?.(state);

  let postResult: {
    written?: number;
    namespace?: string;
    subject?: string;
    collection?: string;
    warnings?: string[];
  };

  try {
    state = { ...state, stage: "submitting" };
    onStateChange?.(state);

    if (isZip) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target_subject", subjSnapshot);
      fd.append("target_collection", collSnapshot);
      postResult = await postBundleApi(fd);
    } else {
      const text = await file.text();
      postResult = await postImportApi({
        yaml: text,
        target_subject: subjSnapshot,
        target_collection: collSnapshot,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    state = {
      ...state,
      stage: "failed",
      error: errorMsg,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: false,
      result: null,
      error: errorMsg,
      stage: "failed",
    };
  }

  // Server commit succeeded!
  const importResult: BankImportResult = {
    written: postResult?.written ?? 0,
    namespace: postResult?.namespace ?? `${subjSnapshot}/${collSnapshot}`,
    subject: postResult?.subject ?? subjSnapshot,
    collection: postResult?.collection ?? collSnapshot,
    warnings: postResult?.warnings,
  };

  state = {
    ...state,
    stage: "committed",
    result: importResult,
    error: null,
  };
  onStateChange?.(state);

  // Transition to refreshing list
  state = {
    ...state,
    stage: "refreshing_list",
  };
  onStateChange?.(state);

  try {
    await loadListApi();
    state = {
      ...state,
      stage: "idle",
      error: null,
    };
    onStateChange?.(state);
    return {
      ok: true,
      committed: true,
      result: importResult,
      error: null,
      stage: "idle",
    };
  } catch (refreshErr) {
    const refreshErrorMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
    const combinedMsg = `导入已成功写入服务端（共 ${importResult.written} 题至 ${importResult.namespace}），但刷新题目列表失败：${refreshErrorMsg}。请点击重试刷新列表，无需重新导入。`;
    state = {
      ...state,
      stage: "refresh_failed",
      error: combinedMsg,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: true,
      result: importResult,
      error: combinedMsg,
      stage: "refresh_failed",
    };
  }
}

export async function executeRetryRefreshOnly(params: {
  currentState: BankImportTransactionState;
  loadListApi: () => Promise<void>;
  onStateChange?: (state: BankImportTransactionState) => void;
}): Promise<ImportExecutionOutcome> {
  const { currentState, loadListApi, onStateChange } = params;

  if (currentState.stage !== "refresh_failed" && currentState.stage !== "committed") {
    return {
      ok: currentState.stage === "idle",
      committed: Boolean(currentState.result),
      result: currentState.result,
      error: currentState.error,
      stage: currentState.stage,
    };
  }

  let state: BankImportTransactionState = {
    ...currentState,
    stage: "refreshing_list",
    error: null,
  };
  onStateChange?.(state);

  try {
    await loadListApi();
    state = {
      ...state,
      stage: "idle",
      error: null,
    };
    onStateChange?.(state);
    return {
      ok: true,
      committed: true,
      result: state.result,
      error: null,
      stage: "idle",
    };
  } catch (err) {
    const refreshErrorMsg = err instanceof Error ? err.message : String(err);
    const combinedMsg = `刷新列表仍失败：${refreshErrorMsg}。题目已保留在服务端，请稍后再次重试刷新。`;
    state = {
      ...state,
      stage: "refresh_failed",
      error: combinedMsg,
    };
    onStateChange?.(state);
    return {
      ok: false,
      committed: true,
      result: state.result,
      error: combinedMsg,
      stage: "refresh_failed",
    };
  }
}
