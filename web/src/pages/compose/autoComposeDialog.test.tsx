import { render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { ComposePaperState, TemplateRow } from "../../types/compose";
import type { AutoComposeOptions, AutoComposeResponse } from "../../types/autoCompose";
import { AutoComposeDialog } from "./AutoComposeDialog";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

const template: TemplateRow = {
  id: "goal-template-v1",
  path: "templates/goal-template.yaml",
  layout: "single_column",
  sections: [
    { section_id: "选择题", type: "single_choice", required_count: 2, score_per_item: 2 },
    { section_id: "填空题", type: "fill", required_count: 1, score_per_item: 3 },
    { section_id: "说明", type: "text", required_count: 0, score_per_item: 0 },
  ],
};

const paperState: ComposePaperState = {
  exportLabel: "阶段测验",
  subject: "数学",
  templatePath: template.path,
  templateRef: template.id,
  draftName: "阶段测验",
  bySection: { 选择题: [], 填空题: [], 说明: [] },
  scoreBySection: { 选择题: 2, 填空题: 3, 说明: 0 },
  countBySection: { 选择题: 2, 填空题: 1, 说明: 0 },
  scoreOverrides: {},
  perQuestionMode: {},
};

const options: AutoComposeOptions = {
  total_count: 7,
  knowledge_points: [{ id: "node/functions", name: "函数与导数", question_count: 4 }],
  difficulty_counts: { easy: 2, medium: 3, hard: 1, unknown: 1 },
  type_counts: { single_choice: 4, fill: 3 },
  namespaces: ["数学/基础题库"],
  warnings: [],
};

function result(): AutoComposeResponse {
  return {
    ok: true,
    complete: false,
    template_ref: template.id,
    template_path: template.path,
    selected_items: [{ section_id: "选择题", question_ids: ["数学/基础题库/q1"], required_count: 2, score_per_item: 2 }],
    requested_count: 3,
    generated_count: 1,
    candidate_count: 7,
    excluded_history_count: 0,
    goals: {
      knowledge: {
        target_points: ["node/functions"],
        covered_points: [],
        missing_points: ["node/functions"],
        coverage_ratio: 0,
        required_ratio: 0.8,
        met: false,
      },
      difficulty: { target: { easy: 1 }, actual: { easy: 0, medium: 0, hard: 0, unknown: 1 }, met: false },
      types: { target: { single_choice: 2, fill: 1 }, actual: { single_choice: 1, fill: 0 }, met: false },
      sections: [
        { section_id: "选择题", requested_count: 2, actual_count: 1 },
        { section_id: "填空题", requested_count: 1, actual_count: 0 },
      ],
      met: false,
    },
    duplicate_report: {
      method: "text_ngram_v1",
      threshold: 0.85,
      summary: { question_count: 1, flagged_count: 0, exact_count: 0, similar_count: 0, history_count: 0, within_paper_count: 0 },
      questions: [],
      warnings: [],
    },
    warnings: ["题量不足"],
  };
}

function renderDialog(props: Partial<ComponentProps<typeof AutoComposeDialog>> = {}) {
  return render(
    <TestI18nProvider>
      <AutoComposeDialog
        open
        onClose={vi.fn()}
        subject="数学"
        template={template}
        paperState={paperState}
        currentExamId="期中/数学"
        requestScopeKey="teacher-a/project-a/期中/数学"
        optionsScopeKey="teacher-a/project-a/期中/数学/数学/goal-template-v1"
        onApply={vi.fn()}
        {...props}
      />
    </TestI18nProvider>,
  );
}

describe("AutoComposeDialog", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue(options);
    mocks.apiPost.mockResolvedValue(result());
  });

  it("loads subject options, submits target fields, and applies the returned result", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onApply, onClose });

    expect(await screen.findByLabelText(/函数与导数/)).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/exam/auto-compose/options?subject=%E6%95%B0%E5%AD%A6");
    await user.click(screen.getByLabelText(/函数与导数/));
    await user.click(screen.getByRole("button", { name: "生成并应用" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    const [path, request] = mocks.apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/api/exam/auto-compose");
    expect(request).toEqual({
      template_path: "templates/goal-template.yaml",
      template_ref: "goal-template-v1",
      subject: "数学",
      total_count: 3,
      knowledge_points: ["node/functions"],
      coverage_ratio: 0.8,
      difficulty_distribution: {},
      type_distribution: {},
      section_counts: { 选择题: 2, 填空题: 1 },
      avoid_history: false,
      exclude_exam_id: "期中/数学",
      similarity_threshold: 0.85,
      namespaces: ["数学/基础题库"],
    });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ generated_count: 1, complete: false }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("自动组卷实际结果")).toBeInTheDocument();
    expect(screen.getByText(/难度未标注 1/)).toBeInTheDocument();
    expect(screen.getByTestId("auto-compose-result").textContent).toContain("未覆盖：函数与导数");
  });

  it("does not apply a generated result after the request scope changes", async () => {
    let resolvePost!: (value: AutoComposeResponse) => void;
    mocks.apiPost.mockReturnValue(new Promise<AutoComposeResponse>((resolve) => { resolvePost = resolve; }));
    const user = userEvent.setup();
    const onApply = vi.fn();
    const view = renderDialog({ onApply });
    await screen.findByLabelText(/函数与导数/);
    await user.click(screen.getByRole("button", { name: "生成并应用" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));

    view.rerender(
      <TestI18nProvider>
        <AutoComposeDialog
          open
          onClose={vi.fn()}
          subject="数学"
          template={template}
          paperState={paperState}
          currentExamId="期中/数学"
          requestScopeKey="teacher-b/project-a/期中/数学"
          onApply={onApply}
        />
      </TestI18nProvider>,
    );
    resolvePost(result());

    await waitFor(() => expect(onApply).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("自动组卷实际结果")).toBeNull();
  });

  it("keeps type weights when applying a result changes the current paper fingerprint", async () => {
    const user = userEvent.setup();
    const view = renderDialog();
    await screen.findByLabelText(/函数与导数/);
    const typeGroup = screen.getByRole("group", { name: "题型比例" });
    await user.click(within(typeGroup).getByRole("checkbox", { name: /指定题型相对比例/ }));
    await user.type(within(typeGroup).getByLabelText(/单选题/), "1");
    await user.type(within(typeGroup).getByLabelText(/填空题/), "2");
    await user.click(screen.getByRole("button", { name: "生成并应用" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));

    const changedPaperState: ComposePaperState = {
      ...paperState,
      bySection: { ...paperState.bySection, 选择题: ["数学/基础题库/applied-question"] },
    };
    view.rerender(
      <TestI18nProvider>
        <AutoComposeDialog
          open
          onClose={vi.fn()}
          subject="数学"
          template={template}
          paperState={changedPaperState}
          currentExamId="期中/数学"
          requestScopeKey="teacher-a/project-a/期中/数学/changed-paper-fingerprint"
          optionsScopeKey="teacher-a/project-a/期中/数学/数学/goal-template-v1"
          onApply={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("group", { name: "题型比例" })).getByLabelText(/单选题/)).toHaveValue(1);
    expect(within(screen.getByRole("group", { name: "题型比例" })).getByLabelText(/填空题/)).toHaveValue(2);
    await user.click(screen.getByRole("button", { name: "生成并应用" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));

    expect(mocks.apiPost.mock.calls[1][1]).toEqual(expect.objectContaining({
      type_distribution: { single_choice: 1, fill: 2 },
    }));
  });

  it("offers simple easy/medium/hard difficulty choices that are optional and reversible", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText(/函数与导数/);

    const difficultyGroup = screen.getByRole("group", { name: "难度" });
    expect(within(difficultyGroup).queryByRole("spinbutton")).not.toBeInTheDocument();
    const easy = within(difficultyGroup).getByRole("checkbox", { name: "简单" });
    const medium = within(difficultyGroup).getByRole("checkbox", { name: "中等" });
    const hard = within(difficultyGroup).getByRole("checkbox", { name: "较难" });
    expect(easy).not.toBeChecked();
    expect(medium).not.toBeChecked();
    expect(hard).not.toBeChecked();

    await user.click(easy);
    await user.click(hard);
    await user.click(screen.getByRole("button", { name: "生成并应用" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost.mock.calls[0][1]).toEqual(expect.objectContaining({
      difficulty_distribution: { easy: 1, hard: 1 },
    }));

    await user.click(easy);
    await user.click(hard);
    await user.click(screen.getByRole("button", { name: "生成并应用" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost.mock.calls[1][1]).toEqual(expect.objectContaining({
      difficulty_distribution: {},
    }));
  });
});
