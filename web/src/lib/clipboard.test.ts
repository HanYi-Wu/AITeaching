import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

const originalCommand = Object.getOwnPropertyDescriptor(document, "execCommand");

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCommand) Object.defineProperty(document, "execCommand", originalCommand);
  else Reflect.deleteProperty(document, "execCommand");
  document.body.replaceChildren();
});

describe("copyTextToClipboard", () => {
  it("copies on a LAN page without navigator.clipboard and restores focus", async () => {
    vi.stubGlobal("navigator", {});
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const command = vi.fn(() => {
      expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe("中文运行日志");
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: command });
    await copyTextToClipboard("中文运行日志");
    expect(command).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(input);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back if clipboard permission is denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    const command = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: command });
    await copyTextToClipboard("log");
    expect(writeText).toHaveBeenCalledWith("log");
    expect(command).toHaveBeenCalledWith("copy");
  });

  it("reports failure and cleans up when neither copying method works", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyTextToClipboard("log")).rejects.toThrow("Clipboard unavailable");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
