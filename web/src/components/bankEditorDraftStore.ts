import type { Dispatch, SetStateAction } from "react";
import type {
  BankDetailState,
  BankEditorDraftSnapshot,
  BankEditorDraftStore as BankEditorDraftStoreApi,
  MetaRow,
} from "./bankEditorTypes";

function resolveUpdate<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (previous: T) => T)(current)
    : action;
}

export class BankEditorDraftStore implements BankEditorDraftStoreApi {
  private snapshot: BankEditorDraftSnapshot = {
    detail: null,
    rawYaml: "",
    metaRows: [],
  };

  private readonly listeners = new Set<() => void>();

  getSnapshot = (): BankEditorDraftSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setDetail: Dispatch<SetStateAction<BankDetailState | null>> = (action) => {
    this.update("detail", action);
  };

  setRawYaml: Dispatch<SetStateAction<string>> = (action) => {
    this.update("rawYaml", action);
  };

  setMetaRows: Dispatch<SetStateAction<MetaRow[]>> = (action) => {
    this.update("metaRows", action);
  };

  private update<K extends keyof BankEditorDraftSnapshot>(
    key: K,
    action: SetStateAction<BankEditorDraftSnapshot[K]>,
  ): void {
    const current = this.snapshot[key];
    const next = resolveUpdate(action, current);
    if (Object.is(current, next)) return;
    this.snapshot = { ...this.snapshot, [key]: next };
    for (const listener of this.listeners) listener();
  }
}
