import type {
  CanvasLayoutInput,
  CanvasLayoutResult,
} from "./layoutComputation";
import type {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "./layoutWorker";

export type LayoutWorkerLike = {
  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: LayoutWorkerRequest) => void;
  terminate: () => void;
};

export type LayoutTaskClientOptions = {
  createWorker?: () => LayoutWorkerLike;
};

type PendingTask = {
  requestId: number;
  onResult: (result: CanvasLayoutResult) => void;
  onError: (error: Error) => void;
};

function defaultWorkerFactory(): LayoutWorkerLike {
  if (typeof Worker === "undefined") throw new Error("Web Worker is unavailable");
  return new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
}

/** Owns one reusable Worker and terminates it when a task is superseded. */
export class LayoutTaskClient {
  private readonly createWorker: () => LayoutWorkerLike;
  private worker: LayoutWorkerLike | null = null;
  private pending: PendingTask | null = null;
  private sequence = 0;
  private disposed = false;

  constructor(options: LayoutTaskClientOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorkerFactory;
  }

  request(
    input: CanvasLayoutInput,
    onResult: (result: CanvasLayoutResult) => void,
    onError: (error: Error) => void,
  ): number | null {
    if (this.disposed) return null;
    this.cancel();
    const requestId = ++this.sequence;
    let worker: LayoutWorkerLike;
    try {
      worker = this.worker ?? this.createWorker();
    } catch {
      this.worker = null;
      return null;
    }
    this.worker = worker;
    this.pending = { requestId, onResult, onError };
    worker.onmessage = (event) => {
      const response = event.data;
      const pending = this.pending;
      if (!pending || pending.requestId !== response.requestId || response.requestId !== requestId) return;
      if (response.type === "result") {
        this.pending = null;
        worker.onmessage = null;
        worker.onerror = null;
        pending.onResult(response.result);
      } else {
        this.failPending(new Error(response.message));
      }
    };
    worker.onerror = () => {
      if (!this.pending || this.pending.requestId !== requestId) return;
      this.failPending(new Error("Canvas layout worker failed"));
    };
    try {
      worker.postMessage({ type: "layout", requestId, input });
    } catch {
      this.pending = null;
      worker.onmessage = null;
      worker.onerror = null;
      this.worker = null;
      worker.terminate();
      return null;
    }
    return requestId;
  }

  cancel(): void {
    this.sequence += 1;
    const worker = this.worker;
    const pending = this.pending;
    this.pending = null;
    if (!worker) return;
    if (pending) {
      try {
        worker.postMessage({ type: "cancel", requestId: pending.requestId });
      } catch {
        // The worker may already be closing; termination below is sufficient.
      }
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      this.worker = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    const worker = this.worker;
    this.pending = null;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
    }
    worker?.terminate();
    pending?.onError(error);
  }
}
