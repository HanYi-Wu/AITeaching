import { describe, expect, it, vi } from "vitest";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./layoutWorker";
import { LayoutTaskClient, type LayoutWorkerLike } from "./layoutTaskClient";
import type { CanvasLayoutInput } from "./layoutComputation";

class FakeWorker implements LayoutWorkerLike {
  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: LayoutWorkerRequest[] = [];
  terminated = false;

  postMessage(message: LayoutWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: LayoutWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<LayoutWorkerResponse>);
  }

  fail(): void {
    this.onerror?.({ message: "worker failed" } as ErrorEvent);
  }
}

const input: CanvasLayoutInput = {
  nodes: [],
  edges: [],
  nodeSizes: [],
  savedPositions: [],
  focusForceLayout: false,
  runNonFocusForce: false,
};

describe("LayoutTaskClient", () => {
  it("terminates superseded work and ignores a stale response", () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const client = new LayoutTaskClient({ createWorker });
    const firstResult = vi.fn();
    const secondResult = vi.fn();
    const first = client.request(input, firstResult, vi.fn());
    const second = client.request(input, secondResult, vi.fn());

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);

    workers[0].emit({ type: "result", requestId: first!, result: { nodes: [], edges: [] } });
    expect(firstResult).not.toHaveBeenCalled();
    workers[1].emit({ type: "result", requestId: second!, result: { nodes: [], edges: [] } });
    expect(secondResult).toHaveBeenCalledOnce();

    client.dispose();
    expect(workers[1].terminated).toBe(true);
  });

  it("reports worker errors and terminates the failed worker", () => {
    const worker = new FakeWorker();
    const onError = vi.fn();
    const client = new LayoutTaskClient({ createWorker: () => worker });
    const requestId = client.request(input, vi.fn(), onError);

    expect(requestId).not.toBeNull();
    worker.fail();
    expect(onError).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
  });

  it("falls back when Worker creation is unavailable", () => {
    const client = new LayoutTaskClient({ createWorker: () => { throw new Error("unsupported"); } });
    expect(client.request(input, vi.fn(), vi.fn())).toBeNull();
    client.dispose();
  });
});
