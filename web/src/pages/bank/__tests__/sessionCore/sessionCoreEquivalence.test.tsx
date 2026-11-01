import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
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
  graphIndex: vi.fn(),
  sessionToken: vi.fn(() => "valid-token"),
  imeActive: vi.fn(() => false),
}));

vi.mock("../../../../api/client", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiPut: mocks.put,
  apiDelete: mocks.del,
  apiPostFormData: mocks.postFormData,
  apiGraphQuestionBindingsIndex: mocks.graphIndex,
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
let serverVersion: string;
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

describe("G33-03: Session Core Equivalence and Resilience Verification", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionToken.mockReturnValue("token-1");
    mocks.imeActive.mockReturnValue(false);
    mocks.graphIndex.mockResolvedValue({ index: {} });
    savedQuestion = { id: "q1", type: "fill", content: "Question one", answer: "7", analysis: "original", metadata: {} };
    serverVersion = "v1";

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
          version: serverVersion,
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
      serverVersion = "v2";
      return { ok: true, version: "v2" };
    });

    mocks.post.mockImplementation(async (path: string) => {
      if (path === "/api/bank/import") {
        return { ok: true, written: 4, namespace: "数学/default", subject: "数学", collection: "default" };
      }
      return { ok: true };
    });

    mocks.postFormData.mockResolvedValue({
      ok: true,
      written: 6,
      namespace: "数学/default",
      subject: "数学",
      collection: "default",
      warnings: ["image warning: a.png not found"],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Single activation: duplicate save clicks while busy do not trigger duplicate PUTs
  it("enforces single activation during save: in-flight clicks are ignored", async () => {
    let resolvePut: ((val: { ok: true; version: string }) => void) | undefined;
    mocks.put.mockImplementationOnce(() => new Promise((resolve) => { resolvePut = resolve; }));

    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());

    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);

    // Save is now in flight
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));

    // Duplicate clicks during in-flight save must be rejected
    await userEvent.click(saveBtn);
    await userEvent.click(saveBtn);
    expect(mocks.put).toHaveBeenCalledTimes(1);

    // Resolve network request
    await act(async () => {
      resolvePut!({ ok: true, version: "v2" });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
  });

  it("saves with one canonical detail read, one list refresh, and one compatible notification", async () => {
    await openFirstQuestion();
    mocks.get.mockClear();
    mocks.graphIndex.mockClear();
    const eventListener = vi.fn();
    window.addEventListener("education-helper-content-library-changed", eventListener);

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.graphIndex).toHaveBeenCalledTimes(1));

    const paths = mocks.get.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === `/api/bank/items/${encodeURIComponent(qid)}`)).toHaveLength(1);
    for (const path of [
      "/api/bank/collections",
      "/api/bank/items",
      "/api/bank/subjects",
      "/api/bank/folders",
    ]) {
      expect(paths.filter((candidate) => candidate === path)).toHaveLength(1);
    }
    expect(eventListener).toHaveBeenCalledTimes(1);
    expect(eventListener.mock.calls[0][0]).toMatchObject({
      detail: { kind: "question", source: expect.any(Object) },
    });
    window.removeEventListener("education-helper-content-library-changed", eventListener);
  });

  it("keeps the committed version after list refresh fails and uses it for the next If-Match", async () => {
    let itemListGets = 0;
    const getHandler = mocks.get.getMockImplementation();
    expect(getHandler).toBeDefined();
    mocks.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === "/api/bank/items" && ++itemListGets === 2) {
        throw new Error("网络超时，题目列表加载失败");
      }
      return getHandler!(path, ...args);
    });
    mocks.put.mockImplementation(async (_path: string, question: QuestionJson) => {
      savedQuestion = structuredClone(question);
      serverVersion = mocks.put.mock.calls.length === 1 ? "v2" : "v3";
      return { ok: true, version: serverVersion };
    });

    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("题目已保存，但题库列表刷新失败"));
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "new value" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2));
    expect(mocks.put.mock.calls[1][2]).toEqual({ "If-Match": "v2" });
  });

  it("preserves a newer form draft and committed version when canonical readback fails", async () => {
    let q1DetailGets = 0;
    const getHandler = mocks.get.getMockImplementation();
    expect(getHandler).toBeDefined();
    mocks.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === `/api/bank/items/${encodeURIComponent(qid)}` && ++q1DetailGets === 2) {
        throw new Error("规范内容读取超时");
      }
      return getHandler!(path, ...args);
    });

    let resolvePut!: (value: { ok: true; version: string }) => void;
    mocks.put.mockImplementationOnce(
      async (_path: string, question: QuestionJson) => {
        const result = await new Promise<{ ok: true; version: string }>((resolve) => {
          resolvePut = resolve;
        });
        savedQuestion = structuredClone(question);
        serverVersion = result.version;
        return result;
      }
    );

    await openFirstQuestion();
    fireEvent.change(screen.getByRole("textbox", { name: "附加信息名称" }), { target: { value: "tag" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "附加信息内容" }), { target: { value: "newer draft" } });
    await act(async () => {
      resolvePut({ ok: true, version: "v2" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("题目已保存，但无法读取保存后的规范化内容"));
    });
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("newer draft");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2));
    expect(mocks.put.mock.calls[1][2]).toEqual({ "If-Match": "v2" });
    expect(screen.getByRole("textbox", { name: "附加信息内容" })).toHaveValue("newer draft");
  });

  // 2. Post-commit loadList failure recovery without duplicate import POST
  it("allows safe recovery when list refresh fails after POST commit without re-submitting POST", async () => {
    let listCallCount = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") return { collections: [{ id: "数学/default", label: "数学/default" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/bank/folders") return { folders: [], assignments: {} };
      if (path === "/api/bank/items") {
        listCallCount++;
        if (listCallCount === 2) {
          // List refresh after import fails
          throw new Error("网络超时，题目列表加载失败");
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
    fireEvent.change(yamlArea, { target: { value: "id: imported_new\ntype: fill" } });

    const submitBtn = screen.getByRole("button", { name: i18n.t("bank:importToCollection") });
    await userEvent.click(submitBtn);

    // POST committed!
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/bank/import", expect.anything()));

    // Refresh failure recovery banner is displayed
    const recoveryAlert = await screen.findByRole("alert");
    expect(recoveryAlert).toHaveTextContent("导入已写入服务端，但刷新题目列表失败");
    expect(recoveryAlert).toHaveTextContent("已写入 4 题至 数学/default");

    // Click retry refresh button
    const retryBtn = screen.getByRole("button", { name: "仅重试刷新列表" });
    await userEvent.click(retryBtn);

    // Verify POST was NOT invoked again!
    expect(mocks.post).toHaveBeenCalledTimes(1);

    // Recovery completes and banner disappears
    await waitFor(() => {
      expect(screen.queryByText("导入已写入服务端，但刷新题目列表失败")).not.toBeInTheDocument();
    });
  });

  // 3. ZIP bundle warnings and written count preservation
  it("preserves written count and warnings from ZIP bundle import", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    mountWorkspace();

    const importBtn = await screen.findByRole("button", { name: /导入题库/ });
    await userEvent.click(importBtn);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const zipFile = new File([new Uint8Array([80, 75, 3, 4])], "bundle.zip", { type: "application/zip" });
    fireEvent.change(fileInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(mocks.postFormData).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("已写入 6 题至 数学/default")
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("image warning: a.png not found")
    );
  });
});
