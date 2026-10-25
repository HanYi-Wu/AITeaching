import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadExportedBundle } from "./composeHelpers";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("../../api/client", () => ({ apiGetBlob: mocks.get }));
vi.mock("../../lib/saveBlobToDisk", () => ({ saveBlobToDisk: mocks.save }));

beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue(true); });

describe("export bundle download", () => {
  it.each(["pdf", "docx"] as const)("uses the native-aware save path for a %s bundle", async (format) => {
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])]);
    mocks.get.mockResolvedValue(blob);
    expect(await downloadExportedBundle("期中/数学", format)).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(blob, expect.objectContaining({
      defaultFileName: `期中-数学-${format}-学生版与教师版.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    }));
  });

  it.each(["", "<html>error</html>", '{"error":"failed"}'])("rejects an invalid success response before saving: %s", async (body) => {
    mocks.get.mockResolvedValue(new Blob([body]));
    await expect(downloadExportedBundle("Quiz/Math", "pdf")).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("preserves native save cancellation without starting another download", async () => {
    mocks.get.mockResolvedValue(new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]));
    mocks.save.mockResolvedValue(false);
    expect(await downloadExportedBundle("Quiz/Math", "pdf")).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
