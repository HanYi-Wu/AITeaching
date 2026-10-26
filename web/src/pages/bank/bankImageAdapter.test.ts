import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiPostFormData } from "../../api/client";
import type { BankDetailState } from "../../components/BankQuestionEditorPanel";
import {
  applySafeSnippetInsertion,
  getEmbedKindText,
  insertSnippetIntoDetail,
  useBankImageUpload,
} from "./bankImageAdapter";

vi.mock("../../api/client", () => ({
  apiPostFormData: vi.fn(),
}));

describe("bankImageAdapter", () => {
  const sampleDetailA: BankDetailState = {
    qualified_id: "数学/default/q1",
    file_yaml: "id: q1\n",
    storage_path: "resource/q1.yaml",
    storage_kind: "single",
    question: {
      id: "q1",
      type: "single_choice",
      content: "题目原始内容",
      answer: "A",
      analysis: "解析文本",
      options: { A: "选项A", B: "选项B" },
      metadata: {},
    },
  };

  const sampleDetailB: BankDetailState = {
    qualified_id: "数学/default/q2",
    file_yaml: "id: q2\n",
    storage_path: "resource/q2.yaml",
    storage_kind: "single",
    question: {
      id: "q2",
      type: "single_choice",
      content: "第二道题目内容",
      answer: "B",
      analysis: "",
      options: { A: "1", B: "2" },
      metadata: {},
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("applySafeSnippetInsertion", () => {
    it("extracts text correctly using getEmbedKindText", () => {
      expect(getEmbedKindText(sampleDetailA, { k: "q", f: "content" })).toBe("题目原始内容");
      expect(getEmbedKindText(sampleDetailA, { k: "qo", key: "A" })).toBe("选项A");
    });

    it("inserts at cursor when text is unchanged", () => {
      const original = "Hello World";
      const { nextText, nextCursor } = applySafeSnippetInsertion(
        original,
        "[IMG]",
        { start: 5, end: 5 },
        original,
      );
      expect(nextText).toBe("Hello[IMG] World");
      expect(nextCursor).toBe(10);
    });

    it("replaces selected range when text is unchanged", () => {
      const original = "Hello [placeholder] World";
      const start = original.indexOf("[placeholder]");
      const end = start + "[placeholder]".length;
      const { nextText } = applySafeSnippetInsertion(
        original,
        "[IMG]",
        { start, end },
        original,
      );
      expect(nextText).toBe("Hello [IMG] World");
    });

    it("does not wipe out user's new input typed while async upload was in progress", () => {
      const snapshotText = "Hello ";
      // User typed "more text here" while upload was in flight
      const currentText = "Hello more text here";
      const { nextText } = applySafeSnippetInsertion(
        currentText,
        "[IMG]",
        { start: 6, end: 6 },
        snapshotText,
      );
      // It must preserve "more text here"
      expect(nextText).toContain("more text here");
      expect(nextText).toContain("[IMG]");
      expect(nextText).toBe("Hello [IMG]more text here");
    });

    it("preserves edits if selection was changed during upload", () => {
      const snapshotText = "Initial content [remove me]";
      const currentText = "Initial content completely modified by teacher";
      const { nextText } = applySafeSnippetInsertion(
        currentText,
        "[IMG]",
        { start: 16, end: 27 },
        snapshotText,
      );
      // New text is not deleted or corrupted
      expect(nextText).toContain("completely modified by teacher");
      expect(nextText).toContain("[IMG]");
    });
  });

  describe("insertSnippetIntoDetail", () => {
    it("does not insert into detail if target question does not match current question (switched questions)", () => {
      const result = insertSnippetIntoDetail(
        sampleDetailB, // current question is B
        "![img](url)",
        { k: "q", f: "content" },
        null,
        undefined,
        "数学/default/q1", // upload was for A
      );
      // Question B remains completely untouched
      expect(result.question.content).toBe("第二道题目内容");
    });

    it("inserts into question options correctly", () => {
      const result = insertSnippetIntoDetail(
        sampleDetailA,
        " (图示)",
        { k: "qo", key: "A" },
        { start: 3, end: 3 },
      );
      expect(result.question.options?.A).toBe("选项A (图示)");
    });
  });

  describe("useBankImageUpload hook", () => {
    it("uploads image and inserts marker into matching question", async () => {
      vi.mocked(apiPostFormData).mockResolvedValueOnce({ marker: "![alt](asset://pic.png)" });
      let currentDetail: BankDetailState | null = sampleDetailA;
      const setDetail = vi.fn((updater) => {
        if (typeof updater === "function") {
          currentDetail = updater(currentDetail);
        } else {
          currentDetail = updater;
        }
      });
      const setBusy = vi.fn();
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useBankImageUpload({
          detail: currentDetail,
          setDetail,
          setBusy,
          onError,
        }),
      );

      // Begin embed
      act(() => {
        result.current.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 });
      });

      // Simulate file selection
      const fakeFile = new File(["bytes"], "test.png", { type: "image/png" });
      const fakeEvent = {
        target: {
          files: [fakeFile],
          value: "",
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.onImageFileSelected(fakeEvent);
      });

      expect(apiPostFormData).toHaveBeenCalledWith(
        `/api/bank/items/${encodeURIComponent("数学/default/q1")}/image`,
        expect.any(FormData),
      );
      expect(setDetail).toHaveBeenCalled();
      expect(currentDetail?.question.content).toBe("题目![alt](asset://pic.png)原始内容");
      expect(onError).toHaveBeenCalledWith(null);
    });

    it("does not insert bad reference when upload fails and reports error", async () => {
      vi.mocked(apiPostFormData).mockRejectedValueOnce(new Error("上传图片服务器异常"));
      let currentDetail: BankDetailState | null = sampleDetailA;
      const setDetail = vi.fn();
      const setBusy = vi.fn();
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useBankImageUpload({
          detail: currentDetail,
          setDetail,
          setBusy,
          onError,
        }),
      );

      act(() => {
        result.current.beginImageEmbed({ k: "q", f: "content" }, { start: 0, end: 0 });
      });

      const fakeFile = new File(["bytes"], "err.png", { type: "image/png" });
      const fakeEvent = {
        target: {
          files: [fakeFile],
          value: "",
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.onImageFileSelected(fakeEvent);
      });

      expect(onError).toHaveBeenCalledWith("上传图片服务器异常");
      // Must not call setDetail to insert broken reference
      expect(setDetail).not.toHaveBeenCalled();
    });

    it("prevents late upload from writing into a new question if user switched tabs in flight", async () => {
      let resolveUpload: (val: { marker: string }) => void;
      vi.mocked(apiPostFormData).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve;
          }),
      );

      let currentDetail: BankDetailState | null = sampleDetailA;
      const setDetail = vi.fn((updater) => {
        if (typeof updater === "function") {
          currentDetail = updater(currentDetail);
        } else {
          currentDetail = updater;
        }
      });
      const setBusy = vi.fn();
      const onError = vi.fn();

      const { result, rerender } = renderHook(() =>
        useBankImageUpload({
          detail: currentDetail,
          setDetail,
          setBusy,
          onError,
        }),
      );

      // Start upload for question A
      act(() => {
        result.current.beginImageEmbed({ k: "q", f: "content" }, { start: 0, end: 0 });
      });

      const fakeFile = new File(["bytes"], "pic.png", { type: "image/png" });
      const fakeEvent = {
        target: {
          files: [fakeFile],
          value: "",
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.onImageFileSelected(fakeEvent);
      });

      // While upload is in flight, user switches question tab to question B
      currentDetail = sampleDetailB;
      rerender();

      // Resolve the network upload
      await act(async () => {
        resolveUpload!({ marker: "![img](asset://pic.png)" });
        await uploadPromise;
      });

      // Question B must remain untouched!
      expect(currentDetail?.qualified_id).toBe("数学/default/q2");
      expect(currentDetail?.question.content).toBe("第二道题目内容");
    });
  });
});
