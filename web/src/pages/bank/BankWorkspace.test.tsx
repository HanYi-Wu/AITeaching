import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { ApiError } from "../../api/errors";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import i18n from "../../i18n/i18n";
import type { BankQuestionEditorPanelProps, QuestionJson } from "../../components/BankQuestionEditorPanel";
import { invalidateBankPrefetch, prefetchBankListData } from "./bankPrefetch";
import { BankWorkspace } from "./BankWorkspace";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), blob: vi.fn(), error: vi.fn(), context: vi.fn() }));
vi.mock("../../api/client", () => ({
  apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, apiDelete: mocks.del, apiPostFormData: vi.fn(),
  apiGraphQuestionBindingsIndex: async () => ({ index: {} }),
}));
vi.mock("../../platform/auth", () => ({ listTaggedItems: async () => ({ items: {} }), downloadPlatformBlob: mocks.blob }));
vi.mock("../../contexts/AgentContext", () => ({ useAgentActions: () => ({ setPageContext: mocks.context }) }));
vi.mock("../../components/ContentTags", () => ({ ContentTags: () => null, TagChips: () => null }));
vi.mock("../../components/QuestionHoverDetails", () => ({ QuestionHoverDetails: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../components/MathInsertOverlay", () => ({ MathInsertOverlay: () => null }));
vi.mock("../../components/MermaidEditorModal", () => ({ MermaidEditorModal: () => null }));
vi.mock("../../components/PrimeBrushEditorModal", () => ({ PrimeBrushEditorModal: () => null }));
// The real workspace, toolbar, file list and save workflows are under test.
// Replace only the rich editor's rendering with the same controlled input contract.
vi.mock("../../components/BankQuestionEditorPanel", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    BankQuestionEditorPanel: (props: BankQuestionEditorPanelProps) => {
    const { panelMode, draftStore, setDetail, setRawYaml, setMetaRows } = props;
    const draft = useSyncExternalStore(
      draftStore!.subscribe,
      draftStore!.getSnapshot,
      draftStore!.getSnapshot,
    );
    const detail = draft.detail ?? props.detail;
    return (
      <div>
        <span data-testid="editor-question-id">{detail.qualified_id}</span>
        {panelMode === "yaml" ? (
          <textarea aria-label="题目 YAML" value={draft.rawYaml} onChange={(event) => setRawYaml(event.target.value)} />
        ) : (
          <>
            <textarea
              aria-label="题目正文"
              value={detail.question.content}
              onChange={(event) => setDetail((current) => current ? {
                ...current,
                question: { ...current.question, content: event.target.value },
              } : current)}
            />
            <input aria-label="编辑题号" value={detail.question.id} onChange={(event) => setDetail((current) => current ? { ...current, question: { ...current.question, id: event.target.value } } : current)} />
            <input aria-label="附加信息名称" value={draft.metaRows[0]?.key ?? ""} onChange={(event) => setMetaRows([{ key: event.target.value, value: draft.metaRows[0]?.value ?? "" }])} />
            <input aria-label="附加信息内容" value={draft.metaRows[0]?.value ?? ""} onChange={(event) => setMetaRows([{ key: draft.metaRows[0]?.key ?? "", value: event.target.value }])} />
          </>
        )}
      </div>
    );
    },
  };
});

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

let savedQuestion: QuestionJson;
const qid = "数学/default/q1";
function mountWorkspace() {
  return render(<TestI18nProvider><ToolBarProvider><Toolbar /><BankWorkspace onError={mocks.error} /></ToolBarProvider></TestI18nProvider>);
}
async function openFirstQuestion() {
  mountWorkspace();
  await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
  await screen.findByRole("textbox", { name: "附加信息名称" });
}

describe("bank toolbar uses the current selection and edits", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBankPrefetch();
    savedQuestion = { id: "q1", type: "fill", content: "Question one", answer: "7", analysis: "original", metadata: {} };
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") return { items: ["q1", "q2"].map((id) => ({ id, qualified_id: `数学/default/${id}`, collection: "数学/default", subject: "数学", type: "fill", content_preview: `Question ${id}`, metadata: {}, storage_path: `resource/数学/default/${id}.yaml`, storage_kind: "single" })) };
      if (path === `/api/bank/items/${encodeURIComponent(qid)}`) return { qualified_id: qid, question: savedQuestion, file_yaml: yaml.dump(savedQuestion), storage_path: "resource/数学/default/q1.yaml", storage_kind: "single" };
      throw new Error(`Unexpected GET ${path}`);
    });
    mocks.put.mockImplementation(async (_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      return { ok: true };
    });
    mocks.post.mockResolvedValue({ download_url: "/api/bank/exports/selection.zip", filename: "selection.zip" });
    mocks.blob.mockResolvedValue(new Blob(["zip"]));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:selection"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("shows file diagnostics while healthy questions remain editable and clears repaired issues", async () => {
    const original = mocks.get.getMockImplementation()!;
    let damaged = true;
    mocks.get.mockImplementation(async (path: string) => {
      const response = await original(path);
      return path === "/api/bank/items" && damaged ? {
        ...response, diagnostics: [{ storage_path: "resource/数学/default/broken.yaml", code: "invalid_yaml", message: "题目文件无法解析" }],
      } : response;
    });
    const { container } = mountWorkspace();
    await userEvent.click(await screen.findByText("有 1 个题目文件需要处理"));
    expect(screen.getByText("broken.yaml")).toBeVisible();
    expect(container.innerHTML).not.toContain("resource/数学/default/broken.yaml");
    expect(document.body.innerHTML).not.toContain("resource/数学/default/broken.yaml");
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q1/ }));
    await screen.findByRole("textbox", { name: "附加信息名称" });
    damaged = false;
    act(() => notifyContentLibraryChanged("question"));
    await waitFor(() => expect(screen.queryByText("有 1 个题目文件需要处理")).not.toBeInTheDocument());
  });

  it("updates the export count on every selection change and exports exactly the current IDs", async () => {
    mountWorkspace();
    const first = await screen.findByRole("checkbox", { name: `选择导出 ${qid}` });
    const second = screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" });
    await userEvent.click(first);
    expect(screen.getByRole("button", { name: "导出已选（1）" })).toBeEnabled();
    await userEvent.click(second);
    expect(screen.getByRole("button", { name: "导出已选（2）" })).toBeEnabled();
    await userEvent.click(first);
    await userEvent.click(screen.getByRole("button", { name: "导出已选（1）" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/bank/export-selection", { qualified_ids: ["数学/default/q2"], title: "我的题目导出" }));
    await waitFor(() => expect(mocks.blob).toHaveBeenCalledWith("/api/bank/exports/selection.zip"));
    await userEvent.click(second);
    expect(screen.getByRole("button", { name: "导出已选（0）" })).toBeDisabled();
  });

  it("captures export target snapshot and ignores duplicate clicks during in-flight export", async () => {
    let resolvePost: (value: { download_url: string; filename: string; question_count: number }) => void;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
    mountWorkspace();

    const first = await screen.findByRole("checkbox", { name: `选择导出 ${qid}` });
    await userEvent.click(first);

    const exportBtn = screen.getByRole("button", { name: "导出已选（1）" });
    await userEvent.click(exportBtn);

    // Duplicate click while busy
    await userEvent.click(exportBtn);

    // Selection changes while export request is in flight
    const second = screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" });
    await userEvent.click(second);

    // Resolve network request
    resolvePost!({ download_url: "/api/bank/exports/selection.zip", filename: "selection.zip", question_count: 1 });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/api/bank/export-selection", { qualified_ids: ["数学/default/q1"], title: "我的题目导出" });
  });

  it("retains selection when export fails", async () => {
    mocks.post.mockRejectedValueOnce(new Error("网络异常"));
    mountWorkspace();

    const first = await screen.findByRole("checkbox", { name: `选择导出 ${qid}` });
    await userEvent.click(first);

    const exportBtn = screen.getByRole("button", { name: "导出已选（1）" });
    await userEvent.click(exportBtn);

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("网络异常"));
    // Selection should remain intact
    expect(first).toBeChecked();
    expect(screen.getByRole("button", { name: "导出已选（1）" })).toBeEnabled();
  });

  it("keeps each bank dropdown free of dialog centering styles", async () => {
    mountWorkspace();

    const menus = [
      { trigger: /筛选条件/, label: "筛选条件" },
      { trigger: "新建题目", label: "新建题目" },
      { trigger: /导入题库/, label: "导入题库" },
    ];
    for (const menu of menus) {
      const trigger = screen.getByRole("button", { name: menu.trigger });
      await userEvent.click(trigger);
      expect(screen.getByRole("dialog", { name: menu.label })).not.toHaveClass("or-dialog");
      await userEvent.click(trigger);
    }
  });

  it("keeps the create form open and reports a duplicate question conflict", async () => {
    const message = "题目已存在，请更换题号后重试";
    mocks.post.mockRejectedValueOnce(new ApiError(message, 409));
    mountWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建空白草稿" }));

    await waitFor(() => expect(mocks.error).toHaveBeenLastCalledWith(message));
    expect(screen.getByRole("dialog", { name: "新建题目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建空白草稿" })).toBeInTheDocument();
    expect(screen.queryByTestId("editor-question-id")).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalledWith(
      `/api/bank/items/${encodeURIComponent("数学/默认/第一题")}`,
    );
  });

  it("creates a question with a Chinese ID and loads it through the encoded qualified ID", async () => {
    const questionId = "第一题（选择题）";
    const createdId = `数学/默认/${questionId}`;
    const createdQuestion: QuestionJson = {
      id: questionId,
      type: "single_choice",
      content: "",
      options: { A: "", B: "", C: "", D: "" },
      answer: "",
      analysis: "",
      metadata: {},
    };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(createdId)}`) {
        return {
          qualified_id: createdId,
          question: createdQuestion,
          file_yaml: yaml.dump(createdQuestion),
          storage_path: `resource/数学/默认/${questionId}.yaml`,
          storage_kind: "single",
        };
      }
      return baseGet(path);
    });
    mocks.post.mockResolvedValueOnce({ ok: true, qualified_id: createdId });
    mountWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    await userEvent.clear(screen.getByRole("textbox", { name: "题号" }));
    await userEvent.type(screen.getByRole("textbox", { name: "题号" }), questionId);
    await userEvent.click(screen.getByRole("button", { name: "创建空白草稿" }));

    expect(mocks.post).toHaveBeenCalledWith("/api/bank/items", expect.objectContaining({
      subject: "数学",
      collection: "默认",
      question: expect.objectContaining({ id: questionId, content: "" }),
    }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(createdId);
    expect(mocks.get).toHaveBeenCalledWith(`/api/bank/items/${encodeURIComponent(createdId)}`);
  });

  it("keeps the input node and buffers Chinese IME composition in new question ID", async () => {
    const questionId = "第一题";
    const createdId = `数学/默认/${questionId}`;
    const createdQuestion: QuestionJson = {
      id: questionId,
      type: "single_choice",
      content: "",
      options: { A: "", B: "", C: "", D: "" },
      answer: "",
      analysis: "",
      metadata: {},
    };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(createdId)}`) {
        return {
          qualified_id: createdId,
          question: createdQuestion,
          file_yaml: yaml.dump(createdQuestion),
          storage_path: `resource/数学/默认/${questionId}.yaml`,
          storage_kind: "single",
        };
      }
      return baseGet(path);
    });
    mocks.post.mockResolvedValueOnce({ ok: true, qualified_id: createdId });
    mountWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    const idInput = screen.getByRole("textbox", { name: "题号" }) as HTMLInputElement;
    await userEvent.clear(idInput);

    const createBtn = screen.getByRole("button", { name: "创建空白草稿" });
    expect(createBtn).toBeDisabled();

    fireEvent.compositionStart(idInput);
    fireEvent.input(idInput, { target: { value: "d" } });
    fireEvent.input(idInput, { target: { value: "di" } });
    expect(screen.getByRole("textbox", { name: "题号" })).toBe(idInput);
    expect(idInput.value).toBe("di");
    expect(createBtn).toBeDisabled();

    fireEvent.compositionEnd(idInput, { target: { value: questionId } });
    expect(screen.getByRole("textbox", { name: "题号" })).toBe(idInput);
    expect(idInput.value).toBe(questionId);
    expect(createBtn).toBeEnabled();

    await userEvent.click(createBtn);
    expect(mocks.post).toHaveBeenCalledWith("/api/bank/items", expect.objectContaining({
      subject: "数学",
      collection: "默认",
      question: expect.objectContaining({ id: questionId }),
    }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(createdId);
  });

  it("keeps edits and the editor open after save failure, then returns to the list after success", async () => {
    const createdId = "数学/默认/第一题";
    const createdQuestion: QuestionJson = {
      id: "第一题",
      type: "single_choice",
      content: "",
      options: { A: "", B: "", C: "", D: "" },
      answer: "",
      analysis: "",
      metadata: {},
    };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(createdId)}`) {
        return {
          qualified_id: createdId,
          question: createdQuestion,
          file_yaml: yaml.dump(createdQuestion),
          storage_path: "resource/数学/默认/第一题.yaml",
          storage_kind: "single",
        };
      }
      return baseGet(path);
    });
    mocks.post.mockResolvedValueOnce({ ok: true, qualified_id: createdId });
    mocks.put.mockRejectedValueOnce(new ApiError("题目已在其他位置更新，请查看最新内容。", 409));
    mountWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建空白草稿" }));

    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(createdId);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true"));
    expect(mocks.post).toHaveBeenCalledWith("/api/bank/items", expect.objectContaining({
      subject: "数学",
      collection: "默认",
      question: expect.objectContaining({ id: "第一题", content: "" }),
    }));

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "备注" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "still editing" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("题目已在其他位置更新，请查看最新内容。");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(createdId);
    expect(screen.getByRole("textbox", { name: "附加信息名称" })).toHaveValue("备注");
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("still editing");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2));
    expect(mocks.put).toHaveBeenLastCalledWith(
      `/api/bank/items/${encodeURIComponent(createdId)}`,
      expect.objectContaining({ content: "", metadata: { 备注: "still editing" } }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector(".or-g48-bank-workspace")).toHaveAttribute("data-active-panel", "list");
  });

  it("removes deleted question from selectedExportIds and updates export count", async () => {
    let currentItems = ["q1", "q2"];
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        return {
          items: currentItems.map((id) => ({
            id,
            qualified_id: `数学/default/${id}`,
            collection: "数学/default",
            subject: "数学",
            type: "fill",
            content_preview: `Question ${id}`,
            metadata: {},
            storage_path: `resource/数学/default/${id}.yaml`,
            storage_kind: "single",
          })),
        };
      }
      if (path === `/api/bank/items/${encodeURIComponent(qid)}`) {
        return { qualified_id: qid, question: savedQuestion, file_yaml: yaml.dump(savedQuestion), storage_path: "resource/数学/default/q1.yaml", storage_kind: "single" };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    mocks.del.mockImplementation(async () => {
      currentItems = currentItems.filter((x) => x !== "q1");
      return { ok: true };
    });

    mountWorkspace();
    const first = await screen.findByRole("checkbox", { name: `选择导出 ${qid}` });
    await userEvent.click(first);
    expect(screen.getByRole("button", { name: "导出已选（1）" })).toBeEnabled();

    // Trigger remove dialog from question row
    const deleteBtns = screen.getAllByRole("button", { name: "删除" });
    await userEvent.click(deleteBtns[0]);

    // Confirm deletion inside dialog
    const dialog = await screen.findByRole("dialog", { name: "删除题目" });
    const confirmBtn = within(dialog).getByRole("button", { name: "删除" });
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(mocks.del).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "导出已选（0）" })).toBeDisabled());
  });

  it("prunes stale questions before export and retains valid ones", async () => {
    let currentItems = ["q1", "q2"];
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        return {
          items: currentItems.map((id) => ({
            id,
            qualified_id: `数学/default/${id}`,
            collection: "数学/default",
            subject: "数学",
            type: "fill",
            content_preview: `Question ${id}`,
            metadata: {},
            storage_path: `resource/数学/default/${id}.yaml`,
            storage_kind: "single",
          })),
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    mountWorkspace();
    const first = await screen.findByRole("checkbox", { name: `选择导出 ${qid}` });
    const second = screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" });
    await userEvent.click(first);
    await userEvent.click(second);
    expect(screen.getByRole("button", { name: "导出已选（2）" })).toBeEnabled();

    // q2 expires on server before export is clicked, library updates
    currentItems = ["q1"];
    notifyContentLibraryChanged("question");
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "选择导出 数学/default/q2" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "导出已选（2）" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("已失效")));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/bank/export-selection", { qualified_ids: ["数学/default/q1"], title: "我的题目导出" }));
  });

  it("saves the final YAML after successive edits while the document stays dirty", async () => {
    await openFirstQuestion();
    await userEvent.click(screen.getByRole("tab", { name: "源文件" }));
    const editor = screen.getByRole("textbox", { name: "题目 YAML" });
    fireEvent.change(editor, { target: { value: yaml.dump({ ...savedQuestion, analysis: "first edit" }) } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    fireEvent.change(editor, { target: { value: yaml.dump({ ...savedQuestion, analysis: "final edit" }) } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(`/api/bank/items/${encodeURIComponent(qid)}`, expect.objectContaining({ analysis: "final edit" })));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "题目 YAML" }) as HTMLTextAreaElement).value).toContain("final edit"));
  });

  it("saves the latest rich-text snapshot without rerendering the workspace on every keystroke", async () => {
    await openFirstQuestion();
    const editor = screen.getByRole("textbox", { name: "题目正文" });
    fireEvent.change(editor, { target: { value: "第一版题干" } });
    fireEvent.change(editor, { target: { value: "中文题干 $x^2$ 最终版" } });

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(
      `/api/bank/items/${encodeURIComponent(qid)}`,
      expect.objectContaining({ content: "中文题干 $x^2$ 最终版" }),
    ));
  });

  it("does not ask to discard after a draft has synchronously returned to its baseline", async () => {
    const q2 = "数学/default/q2";
    const q2Question = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => path === `/api/bank/items/${encodeURIComponent(q2)}`
      ? { qualified_id: q2, question: q2Question, file_yaml: yaml.dump(q2Question), storage_path: "resource/数学/default/q2.yaml", storage_kind: "single" }
      : baseGet(path));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openFirstQuestion();
    const editor = screen.getByRole("textbox", { name: "题目正文" });
    fireEvent.change(editor, { target: { value: "temporary edit" } });
    fireEvent.change(editor, { target: { value: "Question one" } });

    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));

    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent("数学/default/q2");
  });

  it("uses the latest YAML draft for sidebar switch confirmation and keeps the current question when canceled", async () => {
    const q2 = "数学/default/q2";
    const q2Question = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        return { qualified_id: q2, question: q2Question, file_yaml: yaml.dump(q2Question), storage_path: "resource/数学/default/q2.yaml", storage_kind: "single" };
      }
      return baseGet(path);
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await openFirstQuestion();
    await userEvent.click(screen.getByRole("tab", { name: "源文件" }));
    const editor = screen.getByRole("textbox", { name: "题目 YAML" });
    const latestYaml = yaml.dump({ ...savedQuestion, analysis: "latest unsaved YAML" });
    fireEvent.change(editor, { target: { value: latestYaml } });

    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(confirm).toHaveBeenCalledWith("当前题目有未保存的修改，切换将放弃修改，是否继续？");
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(qid);
    expect((screen.getByRole("textbox", { name: "题目 YAML" }) as HTMLTextAreaElement).value).toBe(latestYaml);
    expect(mocks.get).not.toHaveBeenCalledWith(`/api/bank/items/${encodeURIComponent(q2)}`);

    await act(async () => { await i18n.changeLanguage("en"); });
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(confirm).toHaveBeenLastCalledWith("You have unsaved changes. Switch anyway and discard them?");
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(qid);

    await act(async () => { await i18n.changeLanguage("zh"); });
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(q2);
  });

  it("saves the final metadata values after editing their name and content separately", async () => {
    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "topic" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "first edit" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "final edit" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(`/api/bank/items/${encodeURIComponent(qid)}`, expect.objectContaining({ metadata: { topic: "final edit" } })));
  });

  it("ignores a detail response after another question has been selected", async () => {
    const q2 = "数学/default/q2";
    const q1Detail = {
      qualified_id: qid,
      question: savedQuestion,
      file_yaml: yaml.dump(savedQuestion),
      storage_path: "resource/数学/default/q1.yaml",
      storage_kind: "single",
    };
    const q2Question = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
    let resolveQ1: ((value: typeof q1Detail) => void) | undefined;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(qid)}`) {
        return await new Promise<typeof q1Detail>((resolve) => { resolveQ1 = resolve; });
      }
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        return { qualified_id: q2, question: q2Question, file_yaml: yaml.dump(q2Question), storage_path: "resource/数学/default/q2.yaml", storage_kind: "single" };
      }
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") return { items: ["q1", "q2"].map((id) => ({ id, qualified_id: `数学/default/${id}`, collection: "数学/default", subject: "数学", type: "fill", content_preview: `Question ${id}`, metadata: {}, storage_path: `resource/数学/default/${id}.yaml`, storage_kind: "single" })) };
      throw new Error(`Unexpected GET ${path}`);
    });

    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    await waitFor(() => expect(resolveQ1).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(q2);

    await act(async () => {
      resolveQ1!(q1Detail);
      await Promise.resolve();
    });
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(q2);
  });

  it("keeps edits made after a save started and leaves them dirty", async () => {
    let resolvePut: ((value: { ok: true }) => void) | undefined;
    mocks.put.mockImplementationOnce((_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      return new Promise((resolve) => { resolvePut = resolve; });
    });
    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "submitted version" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(resolvePut).toBeTypeOf("function"));

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "newer unsaved edit" } });
    await act(async () => {
      resolvePut!({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => expect((screen.getByRole("textbox", { name: "附加信息内容" }) as HTMLInputElement).value).toBe("newer unsaved edit"));
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("sends the loaded version and preserves edits while viewing a conflict", async () => {
    const baseGet = mocks.get.getMockImplementation()!;
    let version = "v1";
    mocks.get.mockImplementation(async (path: string) => ({ ...await baseGet(path), version }));
    mocks.put.mockRejectedValueOnce(new ApiError("updated elsewhere", 409));
    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "local edit" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { "If-Match": "v1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前编辑已保留");
    expect(screen.getByRole("alert")).toHaveTextContent("updated elsewhere");
    expect(mocks.error).toHaveBeenLastCalledWith("updated elsewhere");
    version = "v2";
    savedQuestion = { ...savedQuestion, metadata: { topic: "remote edit" } };
    await userEvent.click(screen.getByRole("button", { name: "查看最新内容" }));
    expect(await screen.findByText(/topic: remote edit/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("local edit");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "载入最新版本" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("remote edit"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses only the selected record as editable YAML for a legacy multi-record file", async () => {
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      const data = await baseGet(path);
      if (path === `/api/bank/items/${encodeURIComponent(qid)}`) {
        return { ...data, file_yaml: yaml.dump([savedQuestion, { ...savedQuestion, id: "q2" }]), record_yaml: yaml.dump(savedQuestion) };
      }
      return data;
    });
    await openFirstQuestion();
    await userEvent.click(screen.getByRole("tab", { name: "源文件" }));
    const source = screen.getByRole("textbox", { name: "题目 YAML" }) as HTMLTextAreaElement;
    expect(yaml.load(source.value)).toMatchObject({ id: "q1" });
    expect(source.value).not.toContain("id: q2");
  });

  it("keeps the saved version for newer edits when another window writes before refresh", async () => {
    const baseGet = mocks.get.getMockImplementation()!;
    let version = "v1";
    mocks.get.mockImplementation(async (path: string) => ({ ...await baseGet(path), version }));
    let finishSave: ((value: { version: string }) => void) | undefined;
    mocks.put.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "submitted" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(finishSave).toBeTypeOf("function"));
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "new local edit" } });
    version = "remote-v3";
    await act(async () => { finishSave!({ version: "saved-v2" }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("new local edit");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object), { "If-Match": "saved-v2" }));
  });

  it("keeps newer YAML text when the submitted version finishes saving", async () => {
    let resolvePut: ((value: { ok: true }) => void) | undefined;
    mocks.put.mockImplementationOnce((_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      return new Promise((resolve) => { resolvePut = resolve; });
    });
    await openFirstQuestion();
    await userEvent.click(screen.getByRole("tab", { name: "源文件" }));
    const editor = screen.getByRole("textbox", { name: "题目 YAML" });
    fireEvent.change(editor, { target: { value: yaml.dump({ ...savedQuestion, analysis: "submitted version" }) } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(resolvePut).toBeTypeOf("function"));

    const latestYaml = yaml.dump({ ...savedQuestion, analysis: "newer unsaved edit" });
    fireEvent.change(screen.getByRole("textbox", { name: "题目 YAML" }), { target: { value: latestYaml } });
    await act(async () => {
      resolvePut!({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => expect((screen.getByRole("textbox", { name: "题目 YAML" }) as HTMLTextAreaElement).value).toContain("newer unsaved edit"));
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("does not let an older save response switch the editor back to its question", async () => {
    const q2 = "数学/default/q2";
    const q2Question = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        return { qualified_id: q2, question: q2Question, file_yaml: yaml.dump(q2Question), storage_path: "resource/数学/default/q2.yaml", storage_kind: "single" };
      }
      return baseGet(path);
    });
    let resolvePut: ((value: { ok: true }) => void) | undefined;
    mocks.put.mockImplementationOnce((_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      return new Promise((resolve) => { resolvePut = resolve; });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "saved version" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(resolvePut).toBeTypeOf("function"));

    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(q2);
    await act(async () => {
      resolvePut!({ ok: true });
      await Promise.resolve();
    });
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(q2);
  });

  it("keeps the current question open when a deletion of another question finishes", async () => {
    const q2 = "数学/default/q2";
    const q2Question = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        return { qualified_id: q2, question: q2Question, file_yaml: yaml.dump(q2Question), storage_path: "resource/数学/default/q2.yaml", storage_kind: "single" };
      }
      return baseGet(path);
    });
    let resolveDelete: (() => void) | undefined;
    mocks.del.mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = () => resolve({ ok: true }); }));

    await openFirstQuestion();
    await userEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "删除题目" });
    expect(dialog.className).toContain("bg-black/45");
    expect(dialog.className).not.toContain("var(--or-primary)");
    expect(dialog).not.toHaveTextContent("deleteQuestionConfirm");
    expect(dialog).toHaveTextContent(`确定要删除题目 ${qid} 吗？`);
    expect(dialog.querySelector(".or-dialog")).toHaveClass("or-g48-dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(resolveDelete).toBeTypeOf("function"));

    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(q2);
    await act(async () => {
      resolveDelete!();
      await Promise.resolve();
    });
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(q2);
  });

  it("opens blank draft modal centered without mt-4 or transform-overriding keyframes", async () => {
    const createdId = "数学/默认/第一题";
    const createdQuestion: QuestionJson = {
      id: "第一题",
      type: "single_choice",
      content: "",
      options: { A: "", B: "", C: "", D: "" },
      answer: "",
      analysis: "",
      metadata: {},
    };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(createdId)}`) {
        return {
          qualified_id: createdId,
          question: createdQuestion,
          file_yaml: yaml.dump(createdQuestion),
          storage_path: "resource/数学/默认/第一题.yaml",
          storage_kind: "single",
        };
      }
      return baseGet(path);
    });
    mocks.post.mockResolvedValueOnce({ ok: true, qualified_id: createdId });
    mountWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建空白草稿" }));

    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(createdId);
    const editorDialog = screen.getByRole("dialog");
    expect(editorDialog).toHaveClass("or-dialog", "or-g48-dialog");
    expect(editorDialog).not.toHaveClass("mt-4");
    expect(editorDialog.parentElement?.className).toContain("bg-black/40");
    expect(editorDialog.parentElement?.className).not.toContain("var(--or-primary)");
  });

  it("auto-increments Chinese default question IDs from existing items and updates ID on save", async () => {
    const currentItems = [
      { id: "第一题", qualified_id: "数学/默认/第一题", collection: "数学/默认", subject: "数学", type: "single_choice", content_preview: "", metadata: {}, storage_path: "resource/数学/默认/第一题.yaml", storage_kind: "single" },
      { id: "2", qualified_id: "数学/默认/2", collection: "数学/默认", subject: "数学", type: "single_choice", content_preview: "", metadata: {}, storage_path: "resource/数学/默认/2.yaml", storage_kind: "single" },
    ];
    let secondQ: QuestionJson = { id: "第三题", type: "single_choice", content: "", options: { A: "", B: "", C: "", D: "" }, answer: "", analysis: "", metadata: {} };
    let renamedQ: QuestionJson = { ...secondQ, id: "重命名题" };
    const baseGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/items") return { items: currentItems.map((item) => ({ ...item })) };
      if (path === `/api/bank/items/${encodeURIComponent("数学/默认/第三题")}`) {
        return { qualified_id: "数学/默认/第三题", question: secondQ, file_yaml: yaml.dump(secondQ), storage_path: "resource/数学/默认/第三题.yaml", storage_kind: "single" };
      }
      if (path === `/api/bank/items/${encodeURIComponent("数学/默认/重命名题")}`) {
        return { qualified_id: "数学/默认/重命名题", question: renamedQ, file_yaml: yaml.dump(renamedQ), storage_path: "resource/数学/默认/重命名题.yaml", storage_kind: "single" };
      }
      return baseGet(path);
    });
    mocks.post.mockImplementationOnce(async () => {
      currentItems.push({ id: "第三题", qualified_id: "数学/默认/第三题", collection: "数学/默认", subject: "数学", type: "single_choice", content_preview: "", metadata: {}, storage_path: "resource/数学/默认/第三题.yaml", storage_kind: "single" });
      return { ok: true, qualified_id: "数学/默认/第三题" };
    });
    mocks.put.mockImplementationOnce(async (_path: string, body: QuestionJson) => {
      renamedQ = structuredClone(body);
      currentItems[2] = { ...currentItems[2]!, id: "重命名题", qualified_id: "数学/默认/重命名题", storage_path: "resource/数学/默认/重命名题.yaml" };
      return { ok: true, qualified_id: "数学/默认/重命名题", version: "v2" };
    });

    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /新建题目/ }));
    expect(screen.getByRole("textbox", { name: "题号" })).toHaveValue("第三题");

    await userEvent.click(screen.getByRole("button", { name: "创建空白草稿" }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent("数学/默认/第三题");

    // Closing editor / reopening New menu advances default to 第四题 automatically
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));
    expect(screen.getByRole("textbox", { name: "题号" })).toHaveValue("第四题");
    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));

    // Reopen 第三题 from list and rename its 题号 inside editor
    await userEvent.click(screen.getByRole("button", { name: /数学\/默认\/第三题/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "编辑题号" }), { target: { value: "重命名题" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        `/api/bank/items/${encodeURIComponent("数学/默认/第三题")}`,
        expect.objectContaining({ id: "重命名题" }),
      ),
    );
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent("数学/默认/重命名题");
    expect(screen.getByRole("tab", { name: "重命名题" })).toBeInTheDocument();

    // Renaming to an existing question ID fails validation before sending PUT and avoids false version conflict UI
    fireEvent.change(screen.getByRole("textbox", { name: "编辑题号" }), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenLastCalledWith("题号“2”已存在，请使用其他题号");
    expect(screen.queryByRole("button", { name: "查看最新内容" })).not.toBeInTheDocument();

    // Pressing Escape dismisses delete confirmation modal cleanly when idle
    await userEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    expect(await screen.findByRole("dialog", { name: "删除题目" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "删除题目" })).not.toBeInTheDocument());
  });

  it("shows loading prompt instead of empty state while initial bank requests are pending", async () => {
    let resolveItems: (value: unknown) => void;
    const itemsDeferred = new Promise((resolve) => { resolveItems = resolve; });
    const baseImpl = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/items") return itemsDeferred;
      return baseImpl(path);
    });

    mountWorkspace();

    expect(screen.getByText("正在加载题目…")).toBeInTheDocument();
    expect(screen.getByText("全部目录 · 加载中…")).toBeInTheDocument();
    expect(screen.queryByText(/暂无匹配题目/)).not.toBeInTheDocument();
    expect(screen.queryByText("0 题")).not.toBeInTheDocument();

    await act(async () => {
      resolveItems!(await baseImpl("/api/bank/items"));
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: /数学\/default\/q1/ })).toBeInTheDocument();
    expect(screen.queryByText("正在加载题目…")).not.toBeInTheDocument();
  });

  it("hydrates from prefetched bank data without flashing empty state and refreshes on reactivation", async () => {
    await prefetchBankListData("/proj-bank");
    mocks.get.mockClear();

    const { rerender } = render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <BankWorkspace active={true} projectScope="/proj-bank" onError={mocks.error} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    expect(screen.getByRole("button", { name: /数学\/default\/q1/ })).toBeInTheDocument();
    expect(screen.queryByText(/暂无匹配题目/)).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();

    rerender(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <BankWorkspace active={false} projectScope="/proj-bank" onError={mocks.error} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(null));

    rerender(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <BankWorkspace active={true} projectScope="/proj-bank" onError={mocks.error} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/api/bank/items"));
    expect(screen.queryByText(/暂无匹配题目/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /数学\/default\/q1/ })).toBeInTheDocument();
  });
});
