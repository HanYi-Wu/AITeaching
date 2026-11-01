import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRef, useState } from "react";

import { setupTestI18n, TestI18nProvider } from "../test/i18nTestUtils";
import { BankQuestionEditorPanel } from "./BankQuestionEditorPanel";
import { selectOption } from "../test/selectOption";
import type { BankDetailState, BankQuestionEditorPanelProps, MetaRow } from "./bankEditorTypes";

vi.mock("mathlive", () => ({
  MathfieldElement: class MockMathfieldElement extends HTMLElement {
    getValue() {
      return "";
    }
    setValue() {}
  },
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg></svg>" })),
  },
}));

vi.mock("../api/client", () => ({
  resourceApiUrl: (p: string) => p,
}));

function Wrapper(
  props: Partial<BankQuestionEditorPanelProps> & {
    initialDetail: BankDetailState;
    initialEditorTab?: "form" | "yaml";
  }
) {
  const [detail, setDetail] = useState<BankDetailState | null>(props.initialDetail);
  const [editorTab, setEditorTab] = useState<"form" | "yaml">(props.initialEditorTab ?? "form");
  const [rawYaml, setRawYaml] = useState("id: test");
  const [metaRows, setMetaRows] = useState<MetaRow[]>(props.metaRows ?? []);

  const contentRef = createRef<HTMLTextAreaElement>();
  const answerRef = createRef<HTMLTextAreaElement>();
  const analysisRef = createRef<HTMLTextAreaElement>();
  const materialGroupRef = createRef<HTMLTextAreaElement>();
  const imageInputRef = createRef<HTMLInputElement>();

  if (!detail) return null;

  return (
    <TestI18nProvider>
      <BankQuestionEditorPanel
        detail={detail}
        setDetail={setDetail}
        busy={props.busy ?? false}
        editorTab={editorTab}
        setEditorTab={setEditorTab}
        rawYaml={rawYaml}
        setRawYaml={setRawYaml}
        metaRows={metaRows}
        setMetaRows={setMetaRows}
        contentRef={contentRef}
        answerRef={answerRef}
        analysisRef={analysisRef}
        materialGroupRef={materialGroupRef}
        imageInputRef={imageInputRef}
        beginMathEmbed={props.beginMathEmbed ?? vi.fn()}
        beginMermaidEmbed={props.beginMermaidEmbed ?? vi.fn()}
        beginPrimeBrushEmbed={props.beginPrimeBrushEmbed ?? vi.fn()}
        beginImageEmbed={props.beginImageEmbed ?? vi.fn()}
        onImageFileSelected={props.onImageFileSelected ?? vi.fn()}
        onRemove={props.onRemove ?? vi.fn()}
        onSave={props.onSave ?? vi.fn()}
        onSaveYaml={props.onSaveYaml ?? vi.fn()}
        onClose={props.onClose}
        panelMode={props.panelMode}
      />
    </TestI18nProvider>
  );
}

const singleDetail: BankDetailState = {
  qualified_id: "test:q1",
  question: {
    id: "q1",
    type: "single_choice",
    content: "题目题干内容",
    answer: "A",
    analysis: "解析内容",
    options: { A: "选项A", B: "选项B", C: "选项C", D: "选项D" },
  },
  file_yaml: "id: q1",
  storage_path: "questions/q1.yaml",
  storage_kind: "file",
};

const groupDetail: BankDetailState = {
  qualified_id: "test:q_grp__01",
  question: {
    id: "q_grp__01",
    type: "single_choice",
    content: "小题1内容",
    answer: "B",
    analysis: "小题1解析",
    options: { A: "1", B: "2", C: "3", D: "4" },
    group_material: "材料内容",
  },
  file_yaml: "id: q_grp",
  storage_path: "questions/q_grp.yaml",
  storage_kind: "file",
  question_group: {
    id: "q_grp",
    type: "group",
    material: "材料内容",
    unified: "single_choice",
    items: [
      {
        content: "小题1内容",
        answer: "B",
        analysis: "小题1解析",
        options: { A: "1", B: "2", C: "3", D: "4" },
      },
      {
        content: "小题2内容",
        answer: "C",
        analysis: "小题2解析",
        options: { A: "5", B: "6", C: "7", D: "8" },
      },
    ],
  },
};

describe("BankQuestionEditorPanel User Journeys", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  describe("Single Question Mode", () => {
    it("renders question details and mode switch without exposing its storage path", () => {
      render(<Wrapper initialDetail={{ ...singleDetail, storage_path: "resource/__teachers/private-hash/questions/q1.yaml" }} />);

      expect(screen.getByText("test:q1")).toBeInTheDocument();
      expect(screen.queryByText(/存储位置/)).not.toBeInTheDocument();
      expect(screen.queryByText(/private-hash/)).not.toBeInTheDocument();
      expect(screen.getByText("简单编辑模式")).toBeInTheDocument();

      const toggleBtn = screen.getByText("展开公式与绘图工具");
      fireEvent.click(toggleBtn);
      expect(screen.getByText("高级编辑模式")).toBeInTheDocument();
      expect(screen.getByText("返回简单模式")).toBeInTheDocument();
    });

    it("keeps a new question stem empty and shows the stem hint as a placeholder", () => {
      const blankDetail = {
        ...singleDetail,
        question: { ...singleDetail.question, content: "" },
      };
      const { container } = render(<Wrapper initialDetail={blankDetail} />);

      expect(blankDetail.question.content).toBe("");
      expect(container.querySelector("[data-placeholder]")).toHaveAttribute(
        "data-placeholder",
        "（题干，支持公式）",
      );
    });

    it("allows switching question type from choice to essay and back", async () => {
      render(<Wrapper initialDetail={singleDetail} />);

      const typeSelect = screen.getByRole("combobox", { name: "题型" });
      expect(typeSelect).toBeInTheDocument();

      // Options should be visible for single_choice
      expect(screen.getAllByText("选项A").length).toBeGreaterThan(0);

      // Switch to essay (问答题/简答题)
      await selectOption(typeSelect, "essay");
      // Options should no longer be displayed
      expect(screen.queryByText("选项A")).not.toBeInTheDocument();

      // Switch back to single_choice
      await selectOption(typeSelect, "single_choice");
      // Default option keys A, B, C, D should be restored
      expect(screen.getAllByText("A").length).toBeGreaterThan(0);
      expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    });

    it("updates category and metadata rows cleanly", () => {
      render(<Wrapper initialDetail={singleDetail} metaRows={[{ key: "diff", value: "hard" }]} />);

      const categoryInput = screen.getByLabelText("题目分类");
      fireEvent.change(categoryInput, { target: { value: "课前预习" } });
      expect(categoryInput).toHaveValue("课前预习");

      // Add custom metadata row
      const addFieldBtn = screen.getByText("添加一行");
      fireEvent.click(addFieldBtn);

      // 1 initial (diff) + 1 updated (category) + 1 added row = 3 rows
      const keyInputs = screen.getAllByPlaceholderText("名称");
      expect(keyInputs.length).toBe(3);
    });

    it("dispatches onSave on form tab and onSaveYaml on yaml tab", async () => {
      const onSave = vi.fn();
      const onSaveYaml = vi.fn();
      const user = userEvent.setup();

      render(<Wrapper initialDetail={singleDetail} onSave={onSave} onSaveYaml={onSaveYaml} />);

      // On form tab, clicking save calls onSave
      const saveBtn = screen.getByRole("button", { name: "保存" });
      fireEvent.click(saveBtn);
      expect(onSave).toHaveBeenCalled();
      expect(onSaveYaml).not.toHaveBeenCalled();

      // Switch to YAML tab using userEvent click
      const yamlTabTrigger = screen.getByRole("tab", { name: "源文件" });
      await user.click(yamlTabTrigger);

      // Now clicking save calls onSaveYaml
      fireEvent.click(saveBtn);
      expect(onSaveYaml).toHaveBeenCalled();
    });

    it("respects panelMode=yaml directly", () => {
      const onSaveYaml = vi.fn();
      render(<Wrapper initialDetail={singleDetail} panelMode="yaml" onSaveYaml={onSaveYaml} />);

      const saveBtn = screen.getByRole("button", { name: "保存" });
      fireEvent.click(saveBtn);
      expect(onSaveYaml).toHaveBeenCalled();
    });
  });

  describe("Question Group Mode", () => {
    it("renders group hint, read-only root id, material and items", () => {
      render(<Wrapper initialDetail={groupDetail} />);

      expect(screen.getByDisplayValue("q_grp")).toHaveAttribute("readonly");
      expect(screen.getByText("共用材料")).toBeInTheDocument();
      expect(screen.getByText("小题 1")).toBeInTheDocument();
      expect(screen.getByText("小题 2")).toBeInTheDocument();
    });

    it("adds and removes sub questions respecting the minimum count", () => {
      render(<Wrapper initialDetail={groupDetail} />);

      const addBtn = screen.getByText("添加小题");
      fireEvent.click(addBtn);
      expect(screen.getByText("小题 3")).toBeInTheDocument();

      const removeBtn = screen.getByText("删除最后一个小题");
      fireEvent.click(removeBtn);
      expect(screen.queryByText("小题 3")).not.toBeInTheDocument();
      expect(screen.getByText("小题 2")).toBeInTheDocument();

      // Remove down to 1
      fireEvent.click(removeBtn);
      expect(screen.getByText("小题 1")).toBeInTheDocument();
      expect(screen.queryByText("小题 2")).not.toBeInTheDocument();

      // "删除最后一个小题" button should not exist when only 1 item remaining
      expect(screen.queryByText("删除最后一个小题")).not.toBeInTheDocument();
    });

    it("supports switching unified type to mixed mode with per-subitem type selection", async () => {
      render(<Wrapper initialDetail={groupDetail} />);

      const unifiedSelect = screen.getByRole("combobox", { name: "小题模式（混编或同型）" });
      await selectOption(unifiedSelect, "mixed");

      // In mixed mode, each subitem shows its own type selector
      const subTypeSelects = screen.getAllByRole("combobox", { name: "题型" });
      expect(subTypeSelects.length).toBeGreaterThan(1);
      expect(subTypeSelects[0]).toHaveTextContent("单选题");
    });

    it("dispatches onSave for question group correctly when save button is clicked", () => {
      const onSave = vi.fn();
      render(<Wrapper initialDetail={groupDetail} onSave={onSave} />);

      const saveBtn = screen.getByRole("button", { name: "保存" });
      fireEvent.click(saveBtn);

      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("Editor Toolbar Mode Toggle", () => {
    it("toggles between simple and advanced tools mode smoothly", () => {
      render(<Wrapper initialDetail={singleDetail} />);

      expect(screen.getByText("简单编辑模式")).toBeInTheDocument();
      const toggleBtn = screen.getByRole("button", { name: "展开公式与绘图工具" });
      fireEvent.click(toggleBtn);

      expect(screen.getByText("高级编辑模式")).toBeInTheDocument();
      expect(screen.getByText("公式、绘图、图表、表格与图片工具已展开。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "返回简单模式" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "返回简单模式" }));
      expect(screen.getByText("简单编辑模式")).toBeInTheDocument();
    });
  });
});
