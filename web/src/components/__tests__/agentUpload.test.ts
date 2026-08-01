import { describe, expect, it } from "vitest";

import { AGENT_UPLOAD_ACCEPT, formatUploadFailure } from "../agentUpload";

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
});
