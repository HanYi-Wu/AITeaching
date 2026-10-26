import { beforeEach, describe, expect, it } from "vitest";
import type { StudentAnswerImage } from "../../../platform/auth";
import {
  acknowledgeStudentImageDraft, persistStudentImageDraft, restoreStudentImageDraft,
  retainUnconfirmedStudentImageDraft,
} from "./studentImageDraft";
import type { StudentDraftScope } from "./studentTextDraft";

const scope: StudentDraftScope = {
  accountId: "student-1", projectScope: "project-1", publicationId: "publication-1",
  attemptId: "attempt-1", snapshotVersion: "snapshot-1",
};
const image = (name: string): StudentAnswerImage => ({ name, mime_type: "image/png", data_url: `data:image/png;base64,${name}` });

function memoryIndexedDb(options: { failRead?: boolean; failWrite?: boolean } = {}): IDBFactory {
  const rows = new Map<string, unknown>();
  let created = false;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close: () => undefined,
    transaction: () => {
      const tx: {
        error: DOMException | null; oncomplete: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null; onabort: ((event: Event) => void) | null;
        objectStore: () => unknown;
      } = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: () => store };
      const store = {
        get: (key: string) => {
          const request: { result?: unknown; error?: DOMException; onsuccess?: (event: Event) => void; onerror?: (event: Event) => void } = {};
          queueMicrotask(() => {
            if (options.failRead) { request.error = new DOMException("read failed"); request.onerror?.(new Event("error")); }
            else { request.result = rows.get(key); request.onsuccess?.(new Event("success")); }
          });
          return request;
        },
        put: (value: { key: string }) => {
          queueMicrotask(() => {
            if (options.failWrite) {
              tx.error = new DOMException("write failed");
              tx.onerror?.(new Event("error"));
              tx.onabort?.(new Event("abort"));
            } else {
              rows.set(value.key, structuredClone(value));
              tx.oncomplete?.(new Event("complete"));
            }
          });
        },
        delete: (key: string) => {
          queueMicrotask(() => { rows.delete(key); tx.oncomplete?.(new Event("complete")); });
        },
      };
      return tx as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  return {
    open: () => {
      const request = {} as IDBOpenDBRequest;
      Object.defineProperty(request, "result", { configurable: true, get: () => database });
      queueMicrotask(() => {
        if (!created) request.onupgradeneeded?.(new Event("upgrade") as IDBVersionChangeEvent);
        request.onsuccess?.(new Event("success"));
      });
      return request;
    },
  } as unknown as IDBFactory;
}

describe("student image draft recovery", () => {
  beforeEach(() => { localStorage.clear(); });

  it("restores only within the full P21 scope and can be acknowledged", async () => {
    const db = memoryIndexedDb();
    const baseline = { q1: [image("server")] };
    const current = { q1: [image("local")] };
    expect(await persistStudentImageDraft(scope, current, baseline, {}, [], db)).toBeNull();
    const restored = await restoreStudentImageDraft(scope, baseline, ["q1"], db);
    expect(restored.images.q1).toEqual(current.q1);
    expect(restored.restored).toBe(true);
    expect(await restoreStudentImageDraft({ ...scope, projectScope: "other-project" }, {}, ["q1"], db)).toMatchObject({ images: {}, restored: false });
    expect(await persistStudentImageDraft(scope, current, baseline, current, [], db)).toBeNull();
    expect(await acknowledgeStudentImageDraft(scope, current, db)).toBeNull();
    expect(await restoreStudentImageDraft(scope, current, ["q1"], db)).toMatchObject({ images: current, restored: false });
  });

  it("retains a new edit made while the submitted image snapshot is in flight", async () => {
    const db = memoryIndexedDb();
    const submitted = { q1: [image("sent")] };
    const latest = { q1: [image("newer")] };
    expect(await retainUnconfirmedStudentImageDraft(scope, submitted, latest, db)).toBeNull();
    const restored = await restoreStudentImageDraft(scope, submitted, ["q1"], db);
    expect(restored.images.q1).toEqual(latest.q1);
    expect(restored.restored).toBe(true);
  });

  it("enforces the server's per-answer image limit and reports storage failures", async () => {
    const db = memoryIndexedDb({ failWrite: true });
    const excessive = { q1: Array.from({ length: 11 }, (_, index) => image(String(index))) };
    expect(await persistStudentImageDraft(scope, excessive, {}, {}, [], memoryIndexedDb())).toBe("too_large");
    expect(await persistStudentImageDraft(scope, { q1: [image("x")] }, {}, {}, [], db)).toBe("unavailable");
    expect((await restoreStudentImageDraft(scope, {}, ["q1"], memoryIndexedDb({ failRead: true }))).issue).toBe("unavailable");
    expect(localStorage.length).toBe(0);
  });
});
