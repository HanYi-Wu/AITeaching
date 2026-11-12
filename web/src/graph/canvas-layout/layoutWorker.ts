import {
  computeCanvasLayout,
  type CanvasLayoutInput,
  type CanvasLayoutResult,
} from "./layoutComputation";

export type LayoutWorkerRequest =
  | { type: "layout"; requestId: number; input: CanvasLayoutInput }
  | { type: "cancel"; requestId: number };

export type LayoutWorkerResponse =
  | { type: "result"; requestId: number; result: CanvasLayoutResult }
  | { type: "error"; requestId: number; message: string };

type LayoutWorkerScope = {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse) => void;
};

const workerScope = self as unknown as LayoutWorkerScope;
const cancelled = new Set<number>();

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.requestId);
    return;
  }
  if (cancelled.has(request.requestId)) {
    cancelled.delete(request.requestId);
    return;
  }
  try {
    const result = computeCanvasLayout(request.input);
    if (cancelled.delete(request.requestId)) return;
    workerScope.postMessage({ type: "result", requestId: request.requestId, result });
  } catch (error) {
    if (cancelled.delete(request.requestId)) return;
    workerScope.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
