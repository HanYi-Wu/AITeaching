import { useLayoutEffect, useRef } from "react";

export type GradingFieldName = "score" | "feedback";

type FieldVersions = Record<GradingFieldName, number>;

export type GradingSaveRequest = {
  scopeVersion: number;
  key: string;
  requestId: number;
  fieldVersions: FieldVersions;
  editVersions: FieldVersions;
};

export type GradingAiRequest = {
  scopeVersion: number;
  operationId: number;
  requests: Map<string, { requestId: number; fieldVersions: FieldVersions }>;
};

export type GradingRefreshRequest = {
  scopeVersion: number;
  requestId: number;
  fieldVersions: Map<string, FieldVersions>;
  keysWithSaveInFlight: Set<string>;
};

export type GradingSaveAcceptance = {
  current: boolean;
  fields: Record<GradingFieldName, boolean>;
};

export type GradingQueuedSave<T> = { started: false } | { started: true; value: T };

const emptyVersions = (): FieldVersions => ({ score: 0, feedback: 0 });

export function usePaperGrading(scopeKey: string) {
  const scopeRef = useRef({ key: scopeKey, version: 0 });
  const fieldVersionsRef = useRef(new Map<string, FieldVersions>());
  const editVersionsRef = useRef(new Map<string, FieldVersions>());
  const savedEditVersionsRef = useRef(new Map<string, FieldVersions>());
  const saveRequestIdsRef = useRef(new Map<string, number>());
  const activeSavesRef = useRef(new Map<string, number>());
  const saveQueuesRef = useRef(new Map<string, Promise<void>>());
  const aiRequestIdsRef = useRef(new Map<string, number>());
  const aiOperationIdRef = useRef(0);
  const refreshRequestIdRef = useRef(0);

  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey, version: scopeRef.current.version + 1 };
    fieldVersionsRef.current.clear();
    editVersionsRef.current.clear();
    savedEditVersionsRef.current.clear();
    saveRequestIdsRef.current.clear();
    activeSavesRef.current.clear();
    saveQueuesRef.current.clear();
    aiRequestIdsRef.current.clear();
    aiOperationIdRef.current += 1;
    refreshRequestIdRef.current += 1;
  }

  useLayoutEffect(() => () => {
    scopeRef.current.version += 1;
    fieldVersionsRef.current.clear();
    editVersionsRef.current.clear();
    savedEditVersionsRef.current.clear();
    saveRequestIdsRef.current.clear();
    activeSavesRef.current.clear();
    saveQueuesRef.current.clear();
    aiRequestIdsRef.current.clear();
    aiOperationIdRef.current += 1;
    refreshRequestIdRef.current += 1;
  }, []);

  function fieldVersions(key: string): FieldVersions {
    let versions = fieldVersionsRef.current.get(key);
    if (!versions) {
      versions = emptyVersions();
      fieldVersionsRef.current.set(key, versions);
    }
    return versions;
  }

  function editVersions(key: string): FieldVersions {
    let versions = editVersionsRef.current.get(key);
    if (!versions) {
      versions = emptyVersions();
      editVersionsRef.current.set(key, versions);
    }
    return versions;
  }

  function savedEditVersions(key: string): FieldVersions {
    let versions = savedEditVersionsRef.current.get(key);
    if (!versions) {
      versions = emptyVersions();
      savedEditVersionsRef.current.set(key, versions);
    }
    return versions;
  }

  function bumpFieldVersion(key: string, field: GradingFieldName) {
    const current = fieldVersions(key);
    fieldVersionsRef.current.set(key, { ...current, [field]: current[field] + 1 });
  }

  function isScopeCurrent(version: number) {
    return scopeRef.current.version === version;
  }

  function beginEdit(key: string, field: GradingFieldName) {
    bumpFieldVersion(key, field);
    const current = editVersions(key);
    editVersionsRef.current.set(key, { ...current, [field]: current[field] + 1 });
  }

  function beginSave(key: string): GradingSaveRequest {
    refreshRequestIdRef.current += 1;
    bumpFieldVersion(key, "score");
    bumpFieldVersion(key, "feedback");
    const requestId = (saveRequestIdsRef.current.get(key) ?? 0) + 1;
    saveRequestIdsRef.current.set(key, requestId);
    activeSavesRef.current.set(key, requestId);
    return {
      scopeVersion: scopeRef.current.version,
      key,
      requestId,
      fieldVersions: { ...fieldVersions(key) },
      editVersions: { ...editVersions(key) },
    };
  }

  function isCurrentSave(request: GradingSaveRequest) {
    return isScopeCurrent(request.scopeVersion) && saveRequestIdsRef.current.get(request.key) === request.requestId;
  }

  function acceptSave(request: GradingSaveRequest): GradingSaveAcceptance {
    const current = isCurrentSave(request);
    const fields: Record<GradingFieldName, boolean> = { score: false, feedback: false };
    if (current) {
      (Object.keys(fields) as GradingFieldName[]).forEach((field) => {
        const accepted =
          fieldVersions(request.key)[field] === request.fieldVersions[field] &&
          editVersions(request.key)[field] === request.editVersions[field];
        fields[field] = accepted;
        if (accepted) {
          bumpFieldVersion(request.key, field);
          const saved = savedEditVersions(request.key);
          savedEditVersionsRef.current.set(request.key, { ...saved, [field]: request.editVersions[field] });
        }
      });
    }
    finishSave(request);
    return { current, fields };
  }

  function finishSave(request: GradingSaveRequest) {
    if (
      isScopeCurrent(request.scopeVersion) &&
      activeSavesRef.current.get(request.key) === request.requestId
    ) {
      activeSavesRef.current.delete(request.key);
    }
  }

  function enqueueSave<T>(request: GradingSaveRequest, action: () => Promise<T>): Promise<GradingQueuedSave<T>> {
    const prior = saveQueuesRef.current.get(request.key) ?? Promise.resolve();
    const execution = prior.then(async () => {
      if (!isCurrentSave(request)) return { started: false } as const;
      return { started: true, value: await action() } as const;
    });
    const tail = execution.then(() => undefined, () => undefined);
    saveQueuesRef.current.set(request.key, tail);
    void tail.then(() => {
      if (saveQueuesRef.current.get(request.key) === tail) saveQueuesRef.current.delete(request.key);
    });
    return execution;
  }

  function beginAiRequest(keys: string[]): GradingAiRequest {
    refreshRequestIdRef.current += 1;
    const operationId = ++aiOperationIdRef.current;
    const requests = new Map<string, { requestId: number; fieldVersions: FieldVersions }>();
    keys.forEach((key) => {
      const requestId = (aiRequestIdsRef.current.get(key) ?? 0) + 1;
      aiRequestIdsRef.current.set(key, requestId);
      requests.set(key, { requestId, fieldVersions: { ...fieldVersions(key) } });
    });
    return { scopeVersion: scopeRef.current.version, operationId, requests };
  }

  function isCurrentAiRequest(request: GradingAiRequest, key: string) {
    const entry = request.requests.get(key);
    return Boolean(
      entry &&
      isScopeCurrent(request.scopeVersion) &&
      aiRequestIdsRef.current.get(key) === entry.requestId
    );
  }

  function isCurrentAiBatch(request: GradingAiRequest) {
    return isScopeCurrent(request.scopeVersion) &&
      Array.from(request.requests.keys()).some((key) => isCurrentAiRequest(request, key));
  }

  function isCurrentAiOperation(request: GradingAiRequest) {
    return isScopeCurrent(request.scopeVersion) && aiOperationIdRef.current === request.operationId;
  }

  function acceptAiFields(
    request: GradingAiRequest,
    key: string,
    fields: GradingFieldName[],
  ): GradingFieldName[] {
    const entry = request.requests.get(key);
    if (!entry || !isCurrentAiRequest(request, key)) return [];
    const accepted = fields.filter((field) => fieldVersions(key)[field] === entry.fieldVersions[field]);
    accepted.forEach((field) => bumpFieldVersion(key, field));
    return accepted;
  }

  function beginRefresh(): GradingRefreshRequest {
    const requestId = ++refreshRequestIdRef.current;
    const versions = new Map<string, FieldVersions>();
    fieldVersionsRef.current.forEach((value, key) => versions.set(key, { ...value }));
    return {
      scopeVersion: scopeRef.current.version,
      requestId,
      fieldVersions: versions,
      keysWithSaveInFlight: new Set(activeSavesRef.current.keys()),
    };
  }

  function isCurrentRefresh(request: GradingRefreshRequest) {
    return isScopeCurrent(request.scopeVersion) && refreshRequestIdRef.current === request.requestId;
  }

  function acceptRefreshField(request: GradingRefreshRequest, key: string, field: GradingFieldName) {
    if (
      !isCurrentRefresh(request) ||
      request.keysWithSaveInFlight.has(key) ||
      activeSavesRef.current.has(key)
    ) {
      return false;
    }
    const capturedVersion = request.fieldVersions.get(key)?.[field] ?? 0;
    if (
      fieldVersions(key)[field] !== capturedVersion ||
      editVersions(key)[field] !== savedEditVersions(key)[field]
    ) return false;
    bumpFieldVersion(key, field);
    return true;
  }

  return {
    beginEdit,
    beginSave,
    isCurrentSave,
    acceptSave,
    finishSave,
    enqueueSave,
    beginAiRequest,
    isCurrentAiRequest,
    isCurrentAiBatch,
    isCurrentAiOperation,
    acceptAiFields,
    beginRefresh,
    isCurrentRefresh,
    acceptRefreshField,
  };
}
