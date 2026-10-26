import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { TemplateWorkspace } from "./TemplateWorkspace";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  error: vi.fn(),
  context: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiPut: mocks.put,
  apiDelete: mocks.delete,
  ApiError: class ApiError extends Error {
    status?: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../platform/auth")>();
  return {
    ...actual,
    listContentFolders: async () => ({ folders: [] }),
    listFolderItems: async () => ({ items: {} }),
    listTaggedItems: async () => ({ items: {} }),
    listContentTags: async () => ({ tags: [] }),
    assignFolderItem: async () => {},
  };
});

vi.mock("../../components/ContentTags", () => ({
  ContentTags: () => null,
  TagChips: () => null,
}));

vi.mock("../../contexts/AgentContext", () => ({
  useAgentContext: () => ({ setPageContext: mocks.context }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Toolbar() {
  const { left, right } = useToolBar();
  return (
    <div>
      {left}
      {right}
    </div>
  );
}

function renderWorkspace() {
  return render(
    <TestI18nProvider>
      <ToolBarProvider>
        <Toolbar />
        <TemplateWorkspace onError={mocks.error} />
      </ToolBarProvider>
    </TestI18nProvider>,
  );
}

const templateA = {
  template_id: "tpl_a",
  layout: "single_column",
  latex_base: "exam-zh-base.tex.j2",
  sections: [{ section_id: "A分节", type: "single_choice", required_count: 5, score_per_item: 2 }],
  metadata_defaults: { margin_cm: 2.0 },
  layout_builtin_keys: ["margin_cm", "body_font_size_pt"],
};

const templateB = {
  template_id: "tpl_b",
  layout: "double_column",
  latex_base: "exam-zh-base.tex.j2",
  sections: [{ section_id: "B分节", type: "fill", required_count: 3, score_per_item: 4 }],
  metadata_defaults: { margin_cm: 1.5 },
  layout_builtin_keys: ["margin_cm", "body_font_size_pt"],
};

describe("TemplateWorkspace async coordination", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === "/api/templates") {
        return {
          templates: [
            { id: "tpl_a", path: "templates/tpl_a.yaml", layout: "single_column", sections: [] },
            { id: "tpl_b", path: "templates/tpl_b.yaml", layout: "double_column", sections: [] },
          ],
        };
      }
      if (url === "/api/templates/latex-bases") {
        return { shipped: ["exam-zh-base.tex.j2"], in_project: [], choices: ["exam-zh-base.tex.j2"] };
      }
      if (url === "/api/templates/editor-metadata-defaults") {
        return { metadata_defaults: {} };
      }
      if (url.includes("/api/templates/latex-metadata-ui")) {
        return { fields: [], source: null, warnings: [] };
      }
      if (url.includes("path=templates%2Ftpl_a.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return { yaml: "template_id: tpl_a\nlayout: single_column\n" };
        }
        return templateA;
      }
      if (url.includes("path=templates%2Ftpl_b.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return { yaml: "template_id: tpl_b\nlayout: double_column\n" };
        }
        return templateB;
      }
      throw new Error(`Unexpected GET: ${url}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps metadata fields for the current layout base when an older request finishes", async () => {
    const oldFields = deferred<{ fields: { key: string; label: string; kind: string }[]; source: null }>();
    const defaultGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/templates/latex-bases") {
        return Promise.resolve({ shipped: ["exam-zh-base.tex.j2", "alternate.tex.j2"], in_project: [], choices: ["exam-zh-base.tex.j2", "alternate.tex.j2"] });
      }
      if (url.startsWith("/api/templates/latex-metadata-ui?")) {
        const base = new URLSearchParams(url.split("?")[1]).get("latex_base");
        return base === "exam-zh-base.tex.j2"
          ? oldFields.promise
          : Promise.resolve({ fields: [{ key: "current", label: "当前版式字段", kind: "text" }], source: null });
      }
      return defaultGet(url);
    });
    renderWorkspace();
    await screen.findByDisplayValue("tpl_a");
    await userEvent.click(screen.getByRole("button", { name: "高级版式" }));
    fireEvent.change(screen.getByRole("combobox", { name: /版式模板/ }), { target: { value: "alternate.tex.j2" } });
    expect(await screen.findByLabelText("当前版式字段")).toBeInTheDocument();
    await act(async () => { oldFields.resolve({ fields: [{ key: "old", label: "旧版式字段", kind: "text" }], source: null }); });
    expect(screen.getByLabelText("当前版式字段")).toBeInTheDocument();
    expect(screen.queryByLabelText("旧版式字段")).not.toBeInTheDocument();
  });

  it("prevents late-arriving responses of a previous template from overwriting newly switched template", async () => {
    const deferA = deferred<{ yaml: string }>();

    mocks.get.mockImplementation(async (url: string) => {
      if (url === "/api/templates") {
        return {
          templates: [
            { id: "tpl_a", path: "templates/tpl_a.yaml", layout: "single_column", sections: [] },
            { id: "tpl_b", path: "templates/tpl_b.yaml", layout: "double_column", sections: [] },
          ],
        };
      }
      if (url === "/api/templates/latex-bases") {
        return { shipped: ["exam-zh-base.tex.j2"], in_project: [], choices: ["exam-zh-base.tex.j2"] };
      }
      if (url === "/api/templates/editor-metadata-defaults") {
        return { metadata_defaults: {} };
      }
      if (url.includes("/api/templates/latex-metadata-ui")) {
        return { fields: [], source: null, warnings: [] };
      }
      if (url.includes("path=templates%2Ftpl_a.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return deferA.promise;
        }
        return templateA;
      }
      if (url.includes("path=templates%2Ftpl_b.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return { yaml: "template_id: tpl_b\nlayout: double_column\n" };
        }
        return templateB;
      }
      throw new Error(`Unexpected GET: ${url}`);
    });

    renderWorkspace();

    // Template A starts loading (deferA is unresolved)
    // Now user switches to Template B
    const btnB = await screen.findByRole("button", { name: /tpl_b/ });
    await userEvent.click(btnB);

    // Template B finishes loading and shows B's ID
    await waitFor(() => {
      const input = screen.getByDisplayValue("tpl_b");
      expect(input).toBeInTheDocument();
    });

    // Now Template A's delayed response finally resolves
    await act(async () => {
      deferA.resolve({ yaml: "template_id: tpl_a\nlayout: single_column\n" });
    });

    // Template B's display must NOT be overwritten by Template A's late response
    expect(screen.getByDisplayValue("tpl_b")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("tpl_a")).not.toBeInTheDocument();
  });

  it("does not wipe out user typing when save response arrives", async () => {
    const putDefer = deferred<{ ok: boolean; path?: string }>();
    mocks.put.mockReturnValue(putDefer.promise);

    renderWorkspace();

    // Initial load: template A is loaded
    const idInput = await screen.findByDisplayValue("tpl_a");
    expect(idInput).toBeInTheDocument();

    // User edits template_id to "tpl_a_edited"
    fireEvent.change(idInput, { target: { value: "tpl_a_edited" } });
    expect(screen.getByDisplayValue("tpl_a_edited")).toBeInTheDocument();

    // User clicks save
    const saveBtn = await screen.findByRole("button", { name: "保存" });
    fireEvent.click(saveBtn);

    expect(mocks.put).toHaveBeenCalledTimes(1);

    // While save is inflight, user continues typing
    fireEvent.change(idInput, { target: { value: "tpl_a_edited_further" } });
    expect(screen.getByDisplayValue("tpl_a_edited_further")).toBeInTheDocument();

    // Server responds to save
    await act(async () => {
      putDefer.resolve({ ok: true, path: "templates/tpl_a.yaml" });
    });

    await waitFor(() => {
      expect(screen.getByText("已保存")).toBeInTheDocument();
    });

    // User's further edit must NOT be wiped out by server's old post-save read
    expect(screen.getByDisplayValue("tpl_a_edited_further")).toBeInTheDocument();
  });

  it("does not overwrite new template if user switches templates while save is inflight", async () => {
    const putDefer = deferred<{ ok: boolean; path?: string }>();
    mocks.put.mockReturnValue(putDefer.promise);

    renderWorkspace();

    const idInput = await screen.findByDisplayValue("tpl_a");
    expect(idInput).toBeInTheDocument();

    // Trigger save on template A
    fireEvent.change(idInput, { target: { value: "tpl_a_mod" } });
    const saveBtn = await screen.findByRole("button", { name: "保存" });
    fireEvent.click(saveBtn);

    expect(mocks.put).toHaveBeenCalledTimes(1);

    // While save is in flight, user switches to template B
    // Confirmation dialog mocked if prompted
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const btnB = await screen.findByRole("button", { name: /tpl_b/ });
    await userEvent.click(btnB);

    // Template B is displayed
    await waitFor(() => {
      expect(screen.getByDisplayValue("tpl_b")).toBeInTheDocument();
    });

    // Save for Template A now finishes
    await act(async () => {
      putDefer.resolve({ ok: true, path: "templates/tpl_a.yaml" });
    });

    // Active template must remain B and not be overwritten by A
    expect(screen.getByDisplayValue("tpl_b")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("tpl_a_mod")).not.toBeInTheDocument();
  });

  it("applies a layout preset and marks workspace dirty", async () => {
    renderWorkspace();

    await screen.findByDisplayValue("tpl_a");

    const presetBtn = await screen.findByRole("button", { name: "随堂练习" });
    await userEvent.click(presetBtn);

    // Banner message confirms application
    await waitFor(() => {
      expect(screen.getByText(/已应用「随堂练习」/)).toBeInTheDocument();
    });

    // Unsaved changes hint is visible
    expect(screen.getByText("有未保存的修改")).toBeInTheDocument();
  });

  it("allows user to add, configure, and remove sections", async () => {
    renderWorkspace();

    await screen.findByDisplayValue("tpl_a");

    // Add a single choice section using "+ 添加小节" select
    const addSelect = screen.getByDisplayValue("+ 添加小节");
    fireEvent.change(addSelect, { target: { value: "single_choice" } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("单选题 1")).toBeInTheDocument();
    });

    // Add a second single choice section - ordinal increments
    fireEvent.change(addSelect, { target: { value: "single_choice" } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("单选题 2")).toBeInTheDocument();
    });

    // Add text section - verify count is 0
    fireEvent.change(addSelect, { target: { value: "text" } });

    await waitFor(() => {
      expect(screen.getByText("本小节不出题，无需题数")).toBeInTheDocument();
    });

    // Delete a section
    const deleteBtns = screen.getAllByTitle("删除小节");
    fireEvent.click(deleteBtns[deleteBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("本小节不出题，无需题数")).not.toBeInTheDocument();
    });
  });

  it("handles template rename during save and updates tab and path", async () => {
    let currentList = [{ id: "tpl_a", path: "templates/tpl_a.yaml", layout: "single_column", sections: [] }];
    mocks.put.mockImplementation(async () => {
      currentList = [{ id: "tpl_renamed", path: "templates/tpl_renamed.yaml", layout: "single_column", sections: [] }];
      return { ok: true, path: "templates/tpl_renamed.yaml" };
    });
    mocks.get.mockImplementation(async (url: string) => {
      if (url === "/api/templates") {
        return { templates: currentList };
      }
      if (url === "/api/templates/latex-bases") {
        return { shipped: ["exam-zh-base.tex.j2"], in_project: [], choices: ["exam-zh-base.tex.j2"] };
      }
      if (url === "/api/templates/editor-metadata-defaults") {
        return { metadata_defaults: {} };
      }
      if (url.includes("/api/templates/latex-metadata-ui")) {
        return { fields: [], source: null, warnings: [] };
      }
      if (url.includes("tpl_a.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return { yaml: "template_id: tpl_a\nlayout: single_column\n" };
        }
        return templateA;
      }
      if (url.includes("tpl_renamed.yaml")) {
        if (url.startsWith("/api/templates/raw")) {
          return { yaml: "template_id: tpl_renamed\nlayout: single_column\n" };
        }
        return { ...templateA, template_id: "tpl_renamed" };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    renderWorkspace();

    const idInput = await screen.findByDisplayValue("tpl_a");
    fireEvent.change(idInput, { target: { value: "tpl_renamed" } });

    const saveBtn = await screen.findByRole("button", { name: "保存" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledWith(
        "/api/templates/raw",
        expect.objectContaining({
          path: "templates/tpl_a.yaml",
          rename_to: "templates/tpl_renamed.yaml",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("已保存")).toBeInTheDocument();
    });
  });

  it("guards against unsaved loss when switching templates and respects user cancellation", async () => {
    renderWorkspace();

    const idInput = await screen.findByDisplayValue("tpl_a");
    fireEvent.change(idInput, { target: { value: "tpl_a_modified" } });

    // User tries to switch to template B, but clicks Cancel on confirm
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const btnB = await screen.findByRole("button", { name: /tpl_b/ });
    await userEvent.click(btnB);

    expect(confirmSpy).toHaveBeenCalled();
    // Path should remain template A
    expect(screen.getByDisplayValue("tpl_a_modified")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("tpl_b")).not.toBeInTheDocument();

    // Now user clicks OK on confirm
    confirmSpy.mockReturnValue(true);
    await userEvent.click(btnB);

    await waitFor(() => {
      expect(screen.getByDisplayValue("tpl_b")).toBeInTheDocument();
    });
  });

  it("guards against tab closure when dirty and user cancels", async () => {
    renderWorkspace();

    const idInput = await screen.findByDisplayValue("tpl_a");
    fireEvent.change(idInput, { target: { value: "tpl_a_unsaved" } });

    // User clicks close tab button, but cancels
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const closeTabBtn = await screen.findByRole("button", { name: "关闭" });
    fireEvent.click(closeTabBtn);

    expect(confirmSpy).toHaveBeenCalled();
    // Tab remains open
    expect(screen.getByDisplayValue("tpl_a_unsaved")).toBeInTheDocument();
  });
});
