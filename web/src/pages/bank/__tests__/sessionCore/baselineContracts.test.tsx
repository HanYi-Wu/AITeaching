import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { ApiError } from "../../../../api/errors";
import { ToolBarProvider, useToolBar } from "../../../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../../../test/i18nTestUtils";
import i18n from "../../../../i18n/i18n";
import type { BankQuestionEditorPanelProps, QuestionJson } from "../../../../components/BankQuestionEditorPanel";
import { BankWorkspace } from "../../BankWorkspace";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  postFormData: vi.fn(),
  blob: vi.fn(),
  error: vi.fn(),
  context: vi.fn(),
  sessionToken: vi.fn(() => "valid-token"),
  imeActive: vi.fn(() => false),
}));

vi.mock("../../../../lib/ime", () => ({
  isImeCompositionActive: () => mocks.imeActive(),
  isImeComposingKeyboardEvent: () => false,
}));

vi.mock("../../../../api/client", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiPut: mocks.put,
  apiDelete: mocks.del,
  apiPostFormData: mocks.postFormData,
  apiGraphQuestionBindingsIndex: async () => ({ index: {} }),
}));
vi.mock("../../../../platform/auth", () => ({
  listTaggedItems: async () => ({ items: {} }),
  downloadPlatformBlob: mocks.blob,
}));
vi.mock("../../../../platform/session", () => ({
  loadSessionToken: () => mocks.sessionToken(),
}));
vi.mock("../../../../contexts/AgentContext", () => ({
  useAgentContext: () => ({ setPageContext: mocks.context }),
}));
vi.mock("../../../../components/ContentTags", () => ({ ContentTags: () => null, TagChips: () => null }));
vi.mock("../../../../components/QuestionHoverDetails", () => ({ QuestionHoverDetails: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../../../components/MathInsertOverlay", () => ({ MathInsertOverlay: () => null }));
vi.mock("../../../../components/MermaidEditorModal", () => ({ MermaidEditorModal: () => null }));
vi.mock("../../../../components/PrimeBrushEditorModal", () => ({ PrimeBrushEditorModal: () => null }));

vi.mock("../../../../components/BankQuestionEditorPanel", () => ({
  BankQuestionEditorPanel: ({ panelMode, detail, rawYaml, setRawYaml, metaRows, setMetaRows }: BankQuestionEditorPanelProps) => (
    <div>
      <span data-testid="editor-question-id">{detail.qualified_id}</span>
      {panelMode === "yaml" ? (
        <textarea aria-label="题目 YAML" value={rawYaml} onChange={(event) => setRawYaml(event.target.value)} />
      ) : (
        <>
          <input aria-label="附加信息名称" value={metaRows[0]?.key ?? ""} onChange={(event) => setMetaRows([{ key: event.target.value, value: metaRows[0]?.value ?? "" }])} />
          <input aria-label="附加信息内容" value={metaRows[0]?.value ?? ""} onChange={(event) => setMetaRows([{ key: metaRows[0]?.key ?? "", value: event.target.value }])} />
        </>
      )}
    </div>
  ),
}));

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

let savedQuestion: QuestionJson;
const qid = "数学/default/q1";
const q2 = "数学/default/q2";

function mountWorkspace() {
  return render(
    <TestI18nProvider>
      <ToolBarProvider>
        <Toolbar />
        <BankWorkspace onError={mocks.error} />
      </ToolBarProvider>
    </TestI18nProvider>
  );
}

async function openFirstQuestion() {
  mountWorkspace();
  await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
  await screen.findByRole("textbox", { name: "附加信息名称" });
}

describe("G33-01: Baseline Contracts - Edit and Import Session Behavior", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionToken.mockReturnValue("token-1");
    savedQuestion = { id: "q1", type: "fill", content: "Question one", answer: "7", analysis: "original", metadata: {} };

    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        return {
          items: ["q1", "q2"].map((id) => ({
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
        return {
          qualified_id: qid,
          question: savedQuestion,
          file_yaml: yaml.dump(savedQuestion),
          version: "v1",
          storage_path: "resource/数学/default/q1.yaml",
          storage_kind: "single",
        };
      }
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        const q2Data = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
        return {
          qualified_id: q2,
          question: q2Data,
          file_yaml: yaml.dump(q2Data),
          version: "v1",
          storage_path: "resource/数学/default/q2.yaml",
          storage_kind: "single",
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    mocks.put.mockImplementation(async (_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      return { ok: true, version: "v2" };
    });

    mocks.post.mockImplementation(async (path: string) => {
      if (path === "/api/bank/import") {
        return { ok: true, written: 5, namespace: "数学/default", subject: "数学", collection: "default" };
      }
      if (path === "/api/bank/export-selection") {
        return { download_url: "/api/bank/exports/selection.zip", filename: "selection.zip" };
      }
      return { ok: true };
    });

    mocks.postFormData.mockResolvedValue({
      ok: true,
      written: 3,
      namespace: "数学/default",
      subject: "数学",
      collection: "default",
      warnings: ["image missing: img1.png"],
    });

    mocks.blob.mockResolvedValue(new Blob(["zip"]));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:selection"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Contract 1: Dual form / YAML editing & dirty baseline tracking
  it("tracks form and YAML dirty baseline independently and prompts confirmation before discarding", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openFirstQuestion();

    // Baseline is clean initially
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    // Edit form field -> dirty
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());

    // Switch to q2 should be blocked if confirm is rejected
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(confirmSpy).toHaveBeenCalledWith("当前题目有未保存的修改，切换将放弃修改，是否继续？");
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent(qid);

    // Switch to source YAML tab
    await userEvent.click(screen.getByRole("tab", { name: "源文件" }));
    const yamlEditor = screen.getByRole("textbox", { name: "题目 YAML" });
    expect((yamlEditor as HTMLTextAreaElement).value).toContain("id: q1");

    // Allow switch when confirm is accepted
    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /数学\/default\/q2/ }));
    expect(await screen.findByTestId("editor-question-id")).toHaveTextContent(q2);
  });

  // Contract 2: If-Match versioning & 409 conflict preserves local dirty edits
  it("sends If-Match on save, sets conflict on 409, and preserves local dirty edits without silent overwrite", async () => {
    mocks.put.mockRejectedValueOnce(new ApiError("Conflict - modified by another user", 409));
    await openFirstQuestion();

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "my-key" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "my-value" } });

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledWith(
        `/api/bank/items/${encodeURIComponent(qid)}`,
        expect.objectContaining({ metadata: { "my-key": "my-value" } }),
        { "If-Match": "v1" }
      );
    });

    // Conflict banner appears
    expect(await screen.findByRole("alert")).toHaveTextContent("当前编辑已保留");
    // Form still retains user's edits
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("my-value");
  });

  // Contract 3: Reconciliation after save keeps edits made while save was in-flight
  it("keeps edits made while a save request is in-flight and preserves dirty state", async () => {
    let finishPut: ((val: { ok: true; version: string }) => void) | undefined;
    mocks.put.mockImplementationOnce(() => new Promise((resolve) => { finishPut = resolve; }));

    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "field" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "initial edit" } });

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(finishPut).toBeTypeOf("function"));

    // User types new text while server is still writing
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "typing during save" } });

    await act(async () => {
      finishPut!({ ok: true, version: "v2" });
      await Promise.resolve();
    });

    // Content should NOT be reverted to server state, new edit remains
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("typing during save");
    });
    // Document should still be dirty and save button enabled
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  // Contract 4: Stale response fencing (session token expiry and question switch)
  it("discards late detail or save response if session expired or question switched", async () => {
    let finishGet: ((val: any) => void) | undefined;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === `/api/bank/items/${encodeURIComponent(qid)}`) {
        return new Promise((resolve) => { finishGet = resolve; });
      }
      if (path === `/api/bank/items/${encodeURIComponent(q2)}`) {
        const q2Data = { id: "q2", type: "fill", content: "Question two", answer: "8", analysis: "", metadata: {} };
        return {
          qualified_id: q2,
          question: q2Data,
          file_yaml: yaml.dump(q2Data),
          version: "v1",
          storage_path: "resource/数学/default/q2.yaml",
          storage_kind: "single",
        };
      }
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        return {
          items: ["q1", "q2"].map((id) => ({
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
      throw new Error(`Unexpected ${path}`);
    });

    mountWorkspace();
    // Select q1 (detail request starts)
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    await waitFor(() => expect(finishGet).toBeTypeOf("function"));

    // User changes session token (e.g. re-login or switch account)
    mocks.sessionToken.mockReturnValue("expired-token-2");

    // Old response resolves
    await act(async () => {
      finishGet!({
        qualified_id: qid,
        question: savedQuestion,
        file_yaml: yaml.dump(savedQuestion),
        version: "v1",
        storage_path: "resource/数学/default/q1.yaml",
        storage_kind: "single",
      });
      await Promise.resolve();
    });

    // Stale response must be rejected: editor does not render q1 detail
    expect(screen.queryByTestId("editor-question-id")).not.toBeInTheDocument();
  });

  // Contract 5: Import request contracts and behavior when loadList fails after commit
  it("documents import execution and reproduces post-commit loadList failure behavior", async () => {
    mountWorkspace();

    // Open import dropdown
    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    // Open YAML paste details section
    await userEvent.click(screen.getByText(i18n.t("bank:pasteYaml")));

    // Enter YAML text
    const yamlArea = screen.getByPlaceholderText(i18n.t("bank:pasteYamlTextareaPh"));
    fireEvent.change(yamlArea, { target: { value: "id: imported_1\ntype: single_choice\ncontent: test" } });

    // Submit import
    const submitBtn = screen.getByRole("button", { name: i18n.t("bank:importToCollection") });
    await userEvent.click(submitBtn);

    // Verify POST payload contract and dialog close on success
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/api/bank/import", {
        yaml: "id: imported_1\ntype: single_choice\ncontent: test",
        target_subject: "数学",
        target_collection: "默认",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: i18n.t("bank:importToolbar") })).not.toBeInTheDocument();
    });
  });

  it("reveals that baseline treats loadList failure after successful POST as overall failure", async () => {
    let getItemsCalled = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        getItemsCalled++;
        if (getItemsCalled > 1) {
          // Second loadList call (after import POST) fails with network error
          throw new Error("刷新列表网络超时");
        }
        return {
          items: ["q1", "q2"].map((id) => ({
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
    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    await userEvent.click(screen.getByText(i18n.t("bank:pasteYaml")));

    const yamlArea = screen.getByPlaceholderText(i18n.t("bank:pasteYamlTextareaPh"));
    fireEvent.change(yamlArea, { target: { value: "id: imported_2\ntype: fill\ncontent: delayed" } });

    const submitBtn = screen.getByRole("button", { name: i18n.t("bank:importToCollection") });
    await userEvent.click(submitBtn);

    // Server POST succeeded!
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/bank/import", expect.anything()));

    // But because loadList threw, baseline passes the error to onError
    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith("刷新列表网络超时");
    });
    // In baseline, the user sees an error, and the UI provides NO separation between committed import and refresh failure.
  });

  // Contract 6: IME composition save gating
  it("gates save execution when IME composition is active", async () => {
    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());

    // When IME composition is active, clicking save is a no-op
    mocks.imeActive.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mocks.put).not.toHaveBeenCalled();

    // When IME composition ends, save proceeds
    mocks.imeActive.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalled());
  });

  // Contract 7: File YAML and ZIP bundle imports
  it("handles file YAML and ZIP bundle imports including warnings presentation", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    mountWorkspace();

    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    // Simulate choosing a YAML file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const yamlFile = new File(["id: yaml_file_q\ntype: fill\ncontent: stem"], "questions.yaml", { type: "text/yaml" });
    fireEvent.change(fileInput, { target: { files: [yamlFile] } });

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/api/bank/import", {
        yaml: "id: yaml_file_q\ntype: fill\ncontent: stem",
        target_subject: "数学",
        target_collection: "默认",
      });
    });

    // Simulate choosing a ZIP bundle with warnings
    await userEvent.click(importBtn);
    await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
    const zipFileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const zipFile = new File([new Uint8Array([80, 75, 3, 4])], "bundle.zip", { type: "application/zip" });
    fireEvent.change(zipFileInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(mocks.postFormData).toHaveBeenCalledWith("/api/bank/import-bundle", expect.any(FormData));
    });
    // In baseline, ZIP warnings trigger window.alert
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("image missing: img1.png"));
  });

  // Contract 8: Save performs one detail read and one list refresh, without a duplicate event-triggered reload.
  it("records request counts and sequences during single question save", async () => {
    const callLog: string[] = [];
    mocks.put.mockImplementation(async (path: string) => {
      callLog.push(`PUT ${path}`);
      return { ok: true, version: "v2" };
    });
    const originalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string) => {
      callLog.push(`GET ${path}`);
      return originalGet(path);
    });

    await openFirstQuestion();
    callLog.length = 0; // reset log before save

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(callLog).toContain(`PUT /api/bank/items/${encodeURIComponent(qid)}`));
    await waitFor(() => expect(callLog).toContain(`GET /api/bank/items/${encodeURIComponent(qid)}`));

    // Save sequence: PUT, canonical detail GET, then one list refresh (4 GETs).
    // The compatibility notification is still dispatched, but this workspace ignores its own source.
    const putCalls = callLog.filter((c) => c.startsWith("PUT"));
    const getCalls = callLog.filter((c) => c.startsWith("GET"));
    expect(putCalls.length).toBe(1);
    expect(getCalls.length).toBe(5);
    expect(callLog[0]).toBe(`PUT /api/bank/items/${encodeURIComponent(qid)}`);
    expect(getCalls).toContain(`GET /api/bank/items/${encodeURIComponent(qid)}`);
    for (const path of [
      "/api/bank/collections",
      "/api/bank/items",
      "/api/bank/subjects",
      "/api/bank/folders",
    ]) {
      expect(getCalls.filter((call) => call === `GET ${path}`)).toHaveLength(1);
    }
  });
});
