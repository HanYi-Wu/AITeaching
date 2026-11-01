import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { ApiError } from "../../../../api/errors";
import { ToolBarProvider, useToolBar } from "../../../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../../../test/i18nTestUtils";
import i18n from "../../../../i18n/i18n";
import type { BankQuestionEditorPanelProps, QuestionGroupJson, QuestionJson } from "../../../../components/BankQuestionEditorPanel";
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
vi.mock("../../../../lib/ime", () => ({
  isImeCompositionActive: () => mocks.imeActive(),
  isImeComposingKeyboardEvent: () => false,
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
  BankQuestionEditorPanel: ({ panelMode, detail, setDetail, rawYaml, setRawYaml, metaRows, setMetaRows, onSave, onSaveYaml }: BankQuestionEditorPanelProps) => (
    <div data-testid={`editor-panel-${panelMode}`}>
      <span data-testid="editor-question-id">{detail.qualified_id}</span>
      {panelMode === "yaml" ? (
        <div>
          <textarea
            aria-label="题目 YAML"
            value={rawYaml}
            onChange={(event) => setRawYaml(event.target.value)}
          />
          <button type="button" onClick={() => void onSaveYaml?.()}>面板保存YAML</button>
        </div>
      ) : (
        <div>
          <input
            aria-label="题目内容"
            value={detail.question?.content ?? ""}
            onChange={(e) => {
              if (detail.question) {
                setDetail({ ...detail, question: { ...detail.question, content: e.target.value } });
              }
            }}
          />
          <input
            aria-label="附加信息名称"
            value={metaRows[0]?.key ?? ""}
            onChange={(event) =>
              setMetaRows([{ key: event.target.value, value: metaRows[0]?.value ?? "" }])
            }
          />
          <input
            aria-label="附加信息内容"
            value={metaRows[0]?.value ?? ""}
            onChange={(event) =>
              setMetaRows([{ key: metaRows[0]?.key ?? "", value: event.target.value }])
            }
          />
          <button type="button" onClick={() => void onSave?.()}>面板保存表单</button>
        </div>
      )}
    </div>
  ),
}));

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

let savedQuestion1: QuestionJson;
let savedQuestionGroup: QuestionGroupJson;

const qid1 = "数学/default/q1";
const qid2 = "数学/default/q2";
const qidGroup = "物理/default/grp1";

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

describe("User Perspective End-to-End Validation", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionToken.mockReturnValue("token-1");
    mocks.imeActive.mockReturnValue(false);

    savedQuestion1 = {
      id: "q1",
      type: "single_choice",
      content: "初始问题1",
      answer: "A",
      analysis: "解析1",
      options: { A: "选项A", B: "选项B" },
      metadata: { difficulty: "0.5" },
    };

    savedQuestionGroup = {
      id: "grp1",
      type: "group",
      material: "阅读背景材料...",
      unified: "mixed",
      items: [
        {
          type: "single_choice",
          content: "小题1内容",
          answer: "B",
          analysis: "小题1解析",
          options: { A: "1", B: "2" },
          metadata: {},
        },
      ],
    };

    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") {
        return { collections: [{ id: "数学/default", label: "数学/default" }, { id: "物理/default", label: "物理/default" }] };
      }
      if (path === "/api/bank/subjects") return { subjects: ["数学", "物理"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        return {
          items: [
            {
              id: "q1",
              qualified_id: qid1,
              collection: "数学/default",
              subject: "数学",
              type: "single_choice",
              content_preview: "初始问题1",
              metadata: { difficulty: "0.5" },
              storage_path: "resource/数学/default/q1.yaml",
              storage_kind: "single",
            },
            {
              id: "q2",
              qualified_id: qid2,
              collection: "数学/default",
              subject: "数学",
              type: "fill",
              content_preview: "问题2内容",
              metadata: {},
              storage_path: "resource/数学/default/q2.yaml",
              storage_kind: "single",
            },
            {
              id: "grp1",
              qualified_id: qidGroup,
              collection: "物理/default",
              subject: "物理",
              type: "group",
              content_preview: "题组材料预览",
              metadata: {},
              storage_path: "resource/物理/default/grp1.yaml",
              storage_kind: "group",
            },
          ],
        };
      }
      if (path === `/api/bank/items/${encodeURIComponent(qid1)}`) {
        return {
          qualified_id: qid1,
          question: savedQuestion1,
          file_yaml: yaml.dump(savedQuestion1),
          version: "v1.0",
          storage_path: "resource/数学/default/q1.yaml",
          storage_kind: "single",
        };
      }
      if (path === `/api/bank/items/${encodeURIComponent(qid2)}`) {
        const q2Data = { id: "q2", type: "fill", content: "问题2内容", answer: "100", analysis: "", metadata: {} };
        return {
          qualified_id: qid2,
          question: q2Data,
          file_yaml: yaml.dump(q2Data),
          version: "v1.0",
          storage_path: "resource/数学/default/q2.yaml",
          storage_kind: "single",
        };
      }
      if (path === `/api/bank/items/${encodeURIComponent(qidGroup)}`) {
        return {
          qualified_id: qidGroup,
          question: null,
          question_group: savedQuestionGroup,
          file_yaml: yaml.dump(savedQuestionGroup),
          version: "v1.0",
          storage_path: "resource/物理/default/grp1.yaml",
          storage_kind: "group",
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    mocks.put.mockImplementation(async (_path: string, payload: unknown) => {
      const q = payload as QuestionJson;
      if (q.id === "q1") {
        savedQuestion1 = structuredClone(q);
      }
      return { ok: true, version: "v2.0" };
    });

    mocks.post.mockImplementation(async (path: string) => {
      if (path === "/api/bank/import") {
        return { ok: true, written: 5, namespace: "数学/default", subject: "数学", collection: "default" };
      }
      return { ok: true };
    });

    mocks.postFormData.mockResolvedValue({
      ok: true,
      written: 10,
      namespace: "数学/default",
      subject: "数学",
      collection: "default",
      warnings: ["image resource skipped: icon.svg"],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // User Scenario 1: Initial state and Save button gating
  it("keeps Save button disabled until user actually makes dirty changes", async () => {
    mountWorkspace();
    const q1Button = await screen.findByRole("button", { name: /数学\/default\/q1/ });
    await userEvent.click(q1Button);

    const contentInput = await screen.findByRole("textbox", { name: "题目内容" });
    expect(contentInput).toHaveValue("初始问题1");

    // Save button must be disabled initially (not dirty)
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).toBeDisabled();

    // User edits content
    fireEvent.change(contentInput, { target: { value: "用户修改后的题目内容" } });

    // Save button becomes enabled
    await waitFor(() => {
      expect(saveBtn).toBeEnabled();
    });

    // User clicks Save
    await userEvent.click(saveBtn);

    // Save finishes, dirty clears, Save button becomes disabled again
    await waitFor(() => {
      expect(saveBtn).toBeDisabled();
    });
    expect(savedQuestion1.content).toBe("用户修改后的题目内容");
  });

  // User Scenario 2: Preserves user edits made during in-flight save
  it("preserves keystrokes typed by user while save network request is in flight", async () => {
    let resolvePut: ((val: { ok: true; version: string }) => void) | undefined;
    mocks.put.mockImplementationOnce(() => new Promise((resolve) => { resolvePut = resolve; }));

    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    const contentInput = await screen.findByRole("textbox", { name: "题目内容" });

    // Initial edit
    fireEvent.change(contentInput, { target: { value: "修改一" } });
    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);

    // PUT is now in flight
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));

    // While save is in flight, user continues typing!
    fireEvent.change(contentInput, { target: { value: "修改一 + 在途追加键入的内容" } });

    // Server returns response
    await act(async () => {
      resolvePut!({ ok: true, version: "v2.0" });
      await Promise.resolve();
    });

    // Verify user's in-flight edits were NOT wiped by server response!
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "题目内容" })).toHaveValue("修改一 + 在途追加键入的内容");
    });
    // And Save button remains enabled so user can save the extra edits!
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  // User Scenario 3: Guard against invalid YAML syntax and ID tampering
  it("rejects invalid YAML syntax and ID tampering without crashing editor", async () => {
    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));

    // Switch to YAML source tab
    const sourceTab = screen.getByRole("tab", { name: i18n.t("bank:workViewSource") });
    await userEvent.click(sourceTab);

    const yamlTextarea = await screen.findByRole("textbox", { name: "题目 YAML" });

    // Try corrupt YAML syntax: top-level array instead of object
    fireEvent.change(yamlTextarea, { target: { value: "- item1\n- item2" } });
    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);

    // Error is reported to onError
    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("原文须为结构化内容"));
    });

    // Try ID tampering: user tries to rename question ID in YAML
    fireEvent.change(yamlTextarea, { target: { value: "id: tampered_id_007\ntype: single_choice" } });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("题目 ID 不可在 YAML 中修改"));
    });
  });

  // User Scenario 4: Switching questions with unsaved changes prompt
  it("prompts user before switching questions when unsaved changes exist", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    const contentInput = await screen.findByRole("textbox", { name: "题目内容" });

    // User makes edits
    fireEvent.change(contentInput, { target: { value: "未保存的内容" } });

    // User clicks question 2 in sidebar
    confirmSpy.mockReturnValueOnce(false); // User clicks Cancel in confirm dialog
    const q2Button = await screen.findByRole("button", { name: /数学\/default\/q2/ });
    await userEvent.click(q2Button);

    expect(confirmSpy).toHaveBeenCalled();
    // User remains on q1, edits preserved
    expect(screen.getByRole("textbox", { name: "题目内容" })).toHaveValue("未保存的内容");

    // Now user clicks q2 and selects OK in confirm dialog
    confirmSpy.mockReturnValueOnce(true);
    await userEvent.click(q2Button);

    // Switches to q2
    await waitFor(() => {
      expect(screen.getByTestId("editor-question-id")).toHaveTextContent("数学/default/q2");
    });
  });

  // User Scenario 5: 409 Conflict Notification and resolution
  it("displays conflict alert when 409 error occurs and allows viewing latest version", async () => {
    mocks.put.mockRejectedValueOnce(new ApiError("Version conflict: already edited by another teacher", 409));

    mountWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    const contentInput = await screen.findByRole("textbox", { name: "题目内容" });
    fireEvent.change(contentInput, { target: { value: "冲突编辑" } });

    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);

    // Conflict banner appears
    const conflictAlert = await screen.findByRole("alert");
    expect(conflictAlert).toHaveTextContent(i18n.t("bank:saveConflict"));

    // User can click "查看最新版本"
    const viewLatestBtn = screen.getByRole("button", { name: i18n.t("bank:viewLatest") });
    await userEvent.click(viewLatestBtn);

    // GET /api/bank/items/数学/default/q1 is re-fetched
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent(qid1)));
    });
  });

  // User Scenario 6: YAML text import lifecycle and input clearing
  it("clears YAML import textarea upon commit and shows success feedback", async () => {
    mountWorkspace();
    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    await userEvent.click(screen.getByText(i18n.t("bank:pasteYaml")));
    const yamlArea = screen.getByPlaceholderText(i18n.t("bank:pasteYamlTextareaPh"));
    fireEvent.change(yamlArea, { target: { value: "id: new_q_999\ntype: single_choice" } });

    const submitBtn = screen.getByRole("button", { name: i18n.t("bank:importToCollection") });
    await userEvent.click(submitBtn);

    // POST committed
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/api/bank/import", expect.objectContaining({
        yaml: "id: new_q_999\ntype: single_choice",
      }));
    });

    // Reopen import menu to verify textarea was cleared
    await userEvent.click(importBtn);
    await userEvent.click(screen.getByText(i18n.t("bank:pasteYaml")));
    expect(screen.getByPlaceholderText(i18n.t("bank:pasteYamlTextareaPh"))).toHaveValue("");
  });

  // User Scenario 7: Question Group (材料大题) edit and save
  it("allows opening and editing a question group and saves full group payload", async () => {
    let capturedGroupPutPayload: unknown;
    mocks.put.mockImplementationOnce(async (_path: string, payload: unknown) => {
      capturedGroupPutPayload = payload;
      return { ok: true, version: "v2.0" };
    });

    mountWorkspace();
    const grpButton = await screen.findByRole("button", { name: /物理\/default\/grp1/ });
    await userEvent.click(grpButton);

    await waitFor(() => {
      expect(screen.getByTestId("editor-question-id")).toHaveTextContent("物理/default/grp1");
    });

    // Switch to YAML source tab
    const sourceTab = screen.getByRole("tab", { name: i18n.t("bank:workViewSource") });
    await userEvent.click(sourceTab);

    const yamlTextarea = (await screen.findByRole("textbox", { name: "题目 YAML" })) as HTMLTextAreaElement;
    expect(yamlTextarea.value).toContain("阅读背景材料...");

    // User edits YAML of the group
    const updatedGroupYaml = yaml.dump({
      ...savedQuestionGroup,
      material: "阅读背景材料（已更新）...",
    });
    fireEvent.change(yamlTextarea, { target: { value: updatedGroupYaml } });

    const saveBtn = screen.getByRole("button", { name: "保存" });
    await waitFor(() => expect(saveBtn).toBeEnabled());

    await userEvent.click(saveBtn);

    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(qidGroup)),
      expect.anything(),
      expect.anything()
    ));

    const putData = capturedGroupPutPayload as QuestionGroupJson;
    expect(putData.type).toBe("group");
    expect(putData.material).toBe("阅读背景材料（已更新）...");
    expect(putData.items).toHaveLength(1);
    expect(saveBtn).toBeDisabled();
  });

  // User Scenario 8: Closing dirty tab prompts confirmation; non-dirty tab closes cleanly
  it("prompts confirmation when closing active dirty tab and switches to remaining tab", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mountWorkspace();

    // Open q1
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q1/ }));
    // Open q2 to have two tabs open
    await userEvent.click(await screen.findByRole("button", { name: /数学\/default\/q2/ }));

    // q2 is active, make it dirty
    const contentInput = await screen.findByRole("textbox", { name: "题目内容" });
    fireEvent.change(contentInput, { target: { value: "q2 dirty edit" } });

    // Try closing q2 tab - user clicks Cancel
    confirmSpy.mockReturnValueOnce(false);
    const closeButtons = screen.getAllByRole("button", { name: "关闭" });
    // The second close button belongs to q2 tab
    const closeQ2Btn = closeButtons[closeButtons.length - 1];
    await userEvent.click(closeQ2Btn);

    expect(confirmSpy).toHaveBeenCalledWith(i18n.t("bank:closeTabConfirm"));
    // q2 remains open
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent("数学/default/q2");

    // Try closing q2 tab again - user clicks OK
    confirmSpy.mockReturnValueOnce(true);
    await userEvent.click(closeQ2Btn);

    // After closing q2, it switches to the remaining tab q1!
    await waitFor(() => {
      expect(screen.getByTestId("editor-question-id")).toHaveTextContent("数学/default/q1");
    });
  });

  // User Scenario 9: ZIP bundle import with warnings rendering in the dropdown
  it("renders written count and warning notes in the import toolbar dropdown", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    mountWorkspace();
    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const zipFile = new File([new Uint8Array([80, 75, 3, 4])], "test_bundle.zip", { type: "application/zip" });
    fireEvent.change(fileInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(mocks.postFormData).toHaveBeenCalledTimes(1);
    });

    // Reopen import menu to inspect status display
    await userEvent.click(importBtn);

    // Verify written count & warnings are displayed inside the dropdown
    expect(await screen.findByText(/已写入 10 题至 数学\/default/)).toBeInTheDocument();
    expect(screen.getByText(/image resource skipped: icon.svg/)).toBeInTheDocument();
  });
});
