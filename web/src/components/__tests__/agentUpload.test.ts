import { describe, expect, it } from "vitest";

import {
  AGENT_UPLOAD_ACCEPT,
  agentSendMessage,
  createAgentSubmissionGate,
  formatUploadFailure,
  isFileDrag,
  shouldDispatchAgentMessage,
} from "../agentUpload";

describe("agent upload helpers", () => {
  it("accepts common teaching formats", () => {
    for (const extension of [".xlsx", ".xls", ".docx", ".pdf", ".pptx", ".png", ".csv"]) {
      expect(AGENT_UPLOAD_ACCEPT).toContain(extension);
    }
  });

  it("preserves structured backend guidance", () => {
    const message = formatUploadFailure("outline.exe", {
      detail: {
        message: "不支持的文件类型: .exe",
        suggestion: "请转换为 PDF 或 XLSX。",
      },
    });

    expect(message).toContain("outline.exe");
    expect(message).toContain("不支持的文件类型: .exe");
    expect(message).toContain("请转换为 PDF 或 XLSX。");
  });

  it("handles ordinary Error objects", () => {
    expect(formatUploadFailure("outline.xlsx", new Error("network offline"))).toContain("network offline");
  });

  it("recognizes operating-system file drags", () => {
    expect(isFileDrag(["text/plain", "Files"])).toBe(true);
    expect(isFileDrag(["text/plain"])).toBe(false);
  });

  it("allows a file-only request by supplying the default instruction", () => {
    expect(agentSendMessage("", 2, "Read these files")).toBe("Read these files");
    expect(agentSendMessage("  summarize this  ", 1, "Read these files")).toBe("summarize this");
    expect(agentSendMessage("  ", 0, "Read these files")).toBeNull();
  });

  it("locks the complete session-create, upload, and streaming submission window", () => {
    const gate = createAgentSubmissionGate();

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it("does not dispatch a file-only prompt when every upload failed", () => {
    expect(shouldDispatchAgentMessage("", 2, 0)).toBe(false);
    expect(shouldDispatchAgentMessage("", 2, 1)).toBe(true);
    expect(shouldDispatchAgentMessage("summarize generally", 2, 0)).toBe(true);
  });
});
