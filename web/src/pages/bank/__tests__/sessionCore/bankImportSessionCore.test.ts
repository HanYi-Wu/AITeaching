import { describe, expect, it, vi } from "vitest";
import {
  executeFileImport,
  executeRetryRefreshOnly,
  executeYamlTextImport,
} from "../../sessionCore/bankImportSessionCore";
import type { BankImportTransactionState } from "../../sessionCore/types";

describe("bankImportSessionCore", () => {
  it("completes full yaml text import lifecycle cleanly", async () => {
    const states: BankImportTransactionState[] = [];
    const postMock = vi.fn().mockResolvedValue({
      written: 10,
      namespace: "数学/期末",
      subject: "数学",
      collection: "期末",
    });
    const loadListMock = vi.fn().mockResolvedValue(undefined);

    const outcome = await executeYamlTextImport({
      yaml: "id: q1\ntype: fill",
      targetSubject: " 数学 ",
      targetCollection: " 期末 ",
      postImportApi: postMock,
      loadListApi: loadListMock,
      onStateChange: (s) => states.push(s),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.committed).toBe(true);
    expect(outcome.result?.written).toBe(10);
    expect(outcome.result?.namespace).toBe("数学/期末");

    // Check payload passed to post API used trimmed target snapshots
    expect(postMock).toHaveBeenCalledWith({
      yaml: "id: q1\ntype: fill",
      target_subject: "数学",
      target_collection: "期末",
    });

    // Check stage transitions: submitting -> committed -> refreshing_list -> idle
    const stageSequence = states.map((s) => s.stage);
    expect(stageSequence).toEqual(["submitting", "committed", "refreshing_list", "idle"]);
  });

  it("handles POST rejection without committing or calling loadList", async () => {
    const states: BankImportTransactionState[] = [];
    const postMock = vi.fn().mockRejectedValue(new Error("YAML syntax error"));
    const loadListMock = vi.fn();

    const outcome = await executeYamlTextImport({
      yaml: "bad yaml",
      targetSubject: "数学",
      targetCollection: "期末",
      postImportApi: postMock,
      loadListApi: loadListMock,
      onStateChange: (s) => states.push(s),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.committed).toBe(false);
    expect(outcome.error).toBe("YAML syntax error");
    expect(loadListMock).not.toHaveBeenCalled();
    expect(states[states.length - 1].stage).toBe("failed");
  });

  it("separates successful commit from subsequent loadList failure and provides retry without duplicate POST", async () => {
    const states: BankImportTransactionState[] = [];
    const postMock = vi.fn().mockResolvedValue({
      written: 8,
      namespace: "物理/力学",
      subject: "物理",
      collection: "力学",
    });
    let loadListCallCount = 0;
    const loadListMock = vi.fn().mockImplementation(async () => {
      loadListCallCount++;
      if (loadListCallCount === 1) {
        throw new Error("网络波动，列表加载失败");
      }
      return undefined;
    });

    // First attempt: POST succeeds, loadList fails
    const outcome = await executeYamlTextImport({
      yaml: "id: p1\ntype: fill",
      targetSubject: "物理",
      targetCollection: "力学",
      postImportApi: postMock,
      loadListApi: loadListMock,
      onStateChange: (s) => states.push(s),
    });

    // Crucial: committed is true, written count is preserved, stage is refresh_failed
    expect(outcome.ok).toBe(false);
    expect(outcome.committed).toBe(true);
    expect(outcome.result?.written).toBe(8);
    expect(outcome.result?.namespace).toBe("物理/力学");
    expect(outcome.stage).toBe("refresh_failed");
    expect(outcome.error).toContain("导入已成功写入服务端（共 8 题至 物理/力学）");

    const currentState = states[states.length - 1];
    expect(currentState.stage).toBe("refresh_failed");

    // Now test executeRetryRefreshOnly: it must ONLY re-invoke loadList, never POST again!
    const retryStates: BankImportTransactionState[] = [];
    const retryOutcome = await executeRetryRefreshOnly({
      currentState,
      loadListApi: loadListMock,
      onStateChange: (s) => retryStates.push(s),
    });

    expect(retryOutcome.ok).toBe(true);
    expect(retryOutcome.committed).toBe(true);
    expect(retryOutcome.stage).toBe("idle");
    // Verify POST was called exactly once in total!
    expect(postMock).toHaveBeenCalledTimes(1);
    // Verify loadList was called a second time
    expect(loadListCallCount).toBe(2);
  });

  it("handles file import for YAML and ZIP bundles with warnings", async () => {
    const postYamlMock = vi.fn().mockResolvedValue({ written: 2, namespace: "math/default" });
    const postBundleMock = vi.fn().mockResolvedValue({
      written: 5,
      namespace: "math/bundle",
      warnings: ["missing image a.png"],
    });
    const loadListMock = vi.fn().mockResolvedValue(undefined);

    // Unsupported file extension
    const textFile = new File(["dummy"], "data.txt", { type: "text/plain" });
    const failOutcome = await executeFileImport({
      file: textFile,
      targetSubject: "math",
      targetCollection: "default",
      postImportApi: postYamlMock,
      postBundleApi: postBundleMock,
      loadListApi: loadListMock,
    });
    expect(failOutcome.ok).toBe(false);
    expect(failOutcome.error).toContain("仅支持导入 .yaml / .yml 文本文件或 .zip 题目包");

    // ZIP bundle import
    const zipFile = new File([new Uint8Array([80, 75, 3, 4])], "export.zip", { type: "application/zip" });
    const zipOutcome = await executeFileImport({
      file: zipFile,
      targetSubject: "math",
      targetCollection: "bundle",
      postImportApi: postYamlMock,
      postBundleApi: postBundleMock,
      loadListApi: loadListMock,
    });
    expect(zipOutcome.ok).toBe(true);
    expect(zipOutcome.committed).toBe(true);
    expect(zipOutcome.result?.written).toBe(5);
    expect(zipOutcome.result?.warnings).toEqual(["missing image a.png"]);
    expect(postBundleMock).toHaveBeenCalledTimes(1);
    expect(postYamlMock).not.toHaveBeenCalled();
  });
});
