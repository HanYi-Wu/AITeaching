import { invalidateAnalysisPrefetch, prefetchAnalysisWorkspaceData } from "../pages/analysis/analysisPrefetch";
import { invalidateBankPrefetch, prefetchBankListData } from "../pages/bank/bankPrefetch";

export function preloadTeacherWorkspaceChunks(): Promise<unknown>[] {
  return [
    import("../pages/platform/TeacherWorkspace"),
    import("../pages/platform/teacher/TeacherWorkbench"),
  ];
}

export function invalidateTeacherWarmCaches(): void {
  invalidateBankPrefetch();
  invalidateAnalysisPrefetch();
}

export function scheduleTeacherWorkspaceWarmup(options: {
  ownerId?: string | null;
  projectId?: string | null;
  warmBank?: boolean;
  delayMs?: number;
}): () => void {
  let cancelled = false;
  const { ownerId = null, projectId = null, warmBank = true, delayMs = 80 } = options;

  const runWarmup = () => {
    if (cancelled) return;
    if (warmBank) {
      void prefetchBankListData(projectId);
    }
    void prefetchAnalysisWorkspaceData(ownerId, projectId);
  };

  if (typeof window === "undefined") {
    return () => {
      cancelled = true;
    };
  }

  const connection = (window.navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) return () => {};

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const idleId = idleWindow.requestIdleCallback(runWarmup, { timeout: 600 });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(idleId);
    };
  }

  const timerId = window.setTimeout(runWarmup, delayMs);
  return () => {
    cancelled = true;
    window.clearTimeout(timerId);
  };
}
