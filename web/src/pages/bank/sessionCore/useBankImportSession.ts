import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { loadSessionToken } from "../../../platform/session";
import type { BankImportTransactionState } from "./types";
import {
  INITIAL_IMPORT_TRANSACTION_STATE,
  executeFileImport,
  executeRetryRefreshOnly,
  executeYamlTextImport,
} from "./bankImportSessionCore";

export interface UseBankImportSessionOptions {
  onError: (msg: string | null) => void;
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
  refreshListApi: () => Promise<void>;
  defaultSubject?: string;
  defaultTarget?: string;
}

interface ImportOperation {
  id: number;
  scope: { token: string | null; revision: number };
}

export function useBankImportSession(options: UseBankImportSessionOptions) {
  const {
    onError,
    postImportApi,
    postBundleApi,
    refreshListApi,
    defaultSubject = "默认",
    defaultTarget = "默认",
  } = options;

  const [transaction, setTransaction] = useState<BankImportTransactionState>(
    INITIAL_IMPORT_TRANSACTION_STATE
  );
  const transactionRef = useRef(transaction);
  const [importYaml, setImportYamlState] = useState("");
  const importYamlRef = useRef("");
  const [importSubject, setImportSubject] = useState(defaultSubject);
  const [importTarget, setImportTarget] = useState(defaultTarget);

  const mountedRef = useRef(false);
  const operationSeqRef = useRef(0);
  const activeOperationRef = useRef<number | null>(null);
  const sessionScopeRef = useRef<{ token: string | null; revision: number }>({
    token: loadSessionToken(),
    revision: 0,
  });
  const sessionToken = loadSessionToken();
  if (sessionScopeRef.current.token !== sessionToken) {
    sessionScopeRef.current = {
      token: sessionToken,
      revision: sessionScopeRef.current.revision + 1,
    };
  }
  const sessionScopeRevision = sessionScopeRef.current.revision;
  const observedScopeRevisionRef = useRef(sessionScopeRevision);

  const publishTransaction = useCallback((next: BankImportTransactionState) => {
    transactionRef.current = next;
    setTransaction(next);
  }, []);

  const setImportYaml = useCallback((value: string) => {
    importYamlRef.current = value;
    setImportYamlState(value);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeOperationRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (observedScopeRevisionRef.current === sessionScopeRevision) return;
    observedScopeRevisionRef.current = sessionScopeRevision;
    activeOperationRef.current = null;
    publishTransaction(INITIAL_IMPORT_TRANSACTION_STATE);
  }, [publishTransaction, sessionScopeRevision]);

  const beginOperation = useCallback((): ImportOperation | null => {
    if (!mountedRef.current || activeOperationRef.current !== null) {
      return null;
    }
    const currentToken = loadSessionToken();
    if (sessionScopeRef.current.token !== currentToken) {
      sessionScopeRef.current = {
        token: currentToken,
        revision: sessionScopeRef.current.revision + 1,
      };
    }
    const operation = {
      id: ++operationSeqRef.current,
      scope: sessionScopeRef.current,
    };
    activeOperationRef.current = operation.id;
    return operation;
  }, []);

  const isOperationCurrent = useCallback((operation: ImportOperation): boolean => {
    return (
      mountedRef.current &&
      activeOperationRef.current === operation.id &&
      sessionScopeRef.current === operation.scope &&
      loadSessionToken() === operation.scope.token
    );
  }, []);

  const publishForOperation = useCallback(
    (
      operation: ImportOperation,
      next: BankImportTransactionState,
      submittedYaml?: string,
    ) => {
      if (!isOperationCurrent(operation)) return;
      publishTransaction(next);
      if (
        next.stage === "committed" &&
        submittedYaml !== undefined &&
        importYamlRef.current === submittedYaml
      ) {
        setImportYaml("");
      }
    },
    [isOperationCurrent, publishTransaction, setImportYaml]
  );

  const refreshListForOperation = useCallback(
    async (operation: ImportOperation) => {
      if (!isOperationCurrent(operation)) {
        throw new Error("登录状态已更改，已停止当前导入会话。导入结果请按目标目录核对。");
      }
      await refreshListApi();
      if (!isOperationCurrent(operation)) {
        throw new Error("登录状态已更改，列表刷新结果未应用到当前会话。");
      }
    },
    [isOperationCurrent, refreshListApi]
  );

  const finishOperation = useCallback((operation: ImportOperation) => {
    if (activeOperationRef.current === operation.id) {
      activeOperationRef.current = null;
    }
  }, []);

  const busy = useMemo(() => {
    return (
      transaction.stage === "reading" ||
      transaction.stage === "submitting" ||
      transaction.stage === "refreshing_list"
    );
  }, [transaction.stage]);

  const importYamlText = useCallback(async (): Promise<boolean> => {
    const operation = beginOperation();
    if (!operation) return false;

    const yamlSnapshot = importYamlRef.current;
    const subjectSnapshot = importSubject;
    const targetSnapshot = importTarget;
    onError(null);

    try {
      const outcome = await executeYamlTextImport({
        yaml: yamlSnapshot,
        targetSubject: subjectSnapshot,
        targetCollection: targetSnapshot,
        postImportApi: (body) => {
          if (!isOperationCurrent(operation)) {
            throw new Error("登录状态已更改，已停止当前导入请求。");
          }
          return postImportApi(body);
        },
        loadListApi: () => refreshListForOperation(operation),
        onStateChange: (next) => publishForOperation(operation, next, yamlSnapshot),
      });

      if (!isOperationCurrent(operation)) return false;
      if (!outcome.ok && outcome.error) {
        onError(outcome.error);
      }
      return outcome.ok;
    } catch (err) {
      if (isOperationCurrent(operation)) {
        onError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      finishOperation(operation);
    }
  }, [
    beginOperation,
    finishOperation,
    importSubject,
    importTarget,
    isOperationCurrent,
    onError,
    postImportApi,
    publishForOperation,
    refreshListForOperation,
  ]);

  const importFromFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<boolean> => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return false;

      const operation = beginOperation();
      if (!operation) return false;

      const subjectSnapshot = importSubject;
      const targetSnapshot = importTarget;
      onError(null);

      try {
        const outcome = await executeFileImport({
          file,
          targetSubject: subjectSnapshot,
          targetCollection: targetSnapshot,
          postImportApi: (body) => {
            if (!isOperationCurrent(operation)) {
              throw new Error("登录状态已更改，已停止当前导入请求。");
            }
            return postImportApi(body);
          },
          postBundleApi: (formData) => {
            if (!isOperationCurrent(operation)) {
              throw new Error("登录状态已更改，已停止当前导入请求。");
            }
            return postBundleApi(formData);
          },
          loadListApi: () => refreshListForOperation(operation),
          onStateChange: (next) => publishForOperation(operation, next),
        });

        if (!isOperationCurrent(operation)) return false;
        if (outcome.result?.warnings?.length) {
          window.alert(
            `已写入 ${outcome.result.written} 题至 ${outcome.result.namespace}。\n注意：\n${outcome.result.warnings.join(
              "\n"
            )}`
          );
        }
        if (!outcome.ok && outcome.error) {
          onError(outcome.error);
        }
        return outcome.ok;
      } catch (err) {
        if (isOperationCurrent(operation)) {
          onError(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      finishOperation,
      importSubject,
      importTarget,
      isOperationCurrent,
      onError,
      postBundleApi,
      postImportApi,
      publishForOperation,
      refreshListForOperation,
    ]
  );

  const retryRefreshOnly = useCallback(async (): Promise<boolean> => {
    const operation = beginOperation();
    if (!operation) return false;
    onError(null);

    try {
      const outcome = await executeRetryRefreshOnly({
        currentState: transactionRef.current,
        loadListApi: () => refreshListForOperation(operation),
        onStateChange: (next) => publishForOperation(operation, next),
      });
      if (!isOperationCurrent(operation)) return false;
      if (!outcome.ok && outcome.error) {
        onError(outcome.error);
      }
      return outcome.ok;
    } catch (err) {
      if (isOperationCurrent(operation)) {
        onError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      finishOperation(operation);
    }
  }, [
    beginOperation,
    finishOperation,
    isOperationCurrent,
    onError,
    publishForOperation,
    refreshListForOperation,
  ]);

  const clearTransactionResult = useCallback(() => {
    if (activeOperationRef.current === null) {
      publishTransaction(INITIAL_IMPORT_TRANSACTION_STATE);
    }
  }, [publishTransaction]);

  return {
    transaction,
    busy,
    importYaml,
    setImportYaml,
    importSubject,
    setImportSubject,
    importTarget,
    setImportTarget,
    importYamlText,
    importFromFile,
    retryRefreshOnly,
    clearTransactionResult,
  };
}
