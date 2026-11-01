import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BankQuestionEditorPanel } from "../../../../components/BankQuestionEditorPanel";
import type { BankDetailState, MetaRow } from "../../../../components/BankQuestionEditorPanel";
import { LatexRichTextField } from "../../../../components/LatexRichTextField";
import { setupTestI18n, TestI18nProvider } from "../../../../test/i18nTestUtils";
import {
  buildEditorDom,
  getSerializedCaretOffset,
  IMAGE_WIDGET_CLASS,
  serializeEditor,
} from "../../../../components/latexField/contentPreview";
import {
  focusVisualEditorAtSerializedOffset,
  waitForAsyncFieldCompositionCommit,
} from "../../../../components/latexField/asyncCallbackBridge";
import { insertSnippetIntoDetail, useBankImageUpload } from "../../bankImageAdapter";

const mocks = vi.hoisted(() => ({ postFormData: vi.fn() }));

vi.mock("../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/client")>();
  return { ...actual, apiPostFormData: mocks.postFormData };
});

vi.mock("mathlive", () => ({
  MathfieldElement: class MockMathfieldElement extends HTMLElement {
    getValue() { return ""; }
    setValue() {}
  },
}));

vi.mock("../../../../lib/katexRender", () => ({
  renderMathToHtmlSimple: (latex: string) => `<span>${latex}</span>`,
}));

vi.mock("../../../../lib/mermaidInit", () => ({ initMermaid: vi.fn() }));

const initialDetail: BankDetailState = {
  qualified_id: "数学/default/ime-image-q1",
  question: {
    id: "ime-image-q1",
    type: "fill",
    content: "题干",
    answer: "答案",
    analysis: "解析",
    metadata: {},
  },
  file_yaml: "id: ime-image-q1\n",
  version: "v7",
  storage_path: "resource/数学/default/ime-image-q1.yaml",
  storage_kind: "single",
};

const groupDetail: BankDetailState = {
  ...initialDetail,
  qualified_id: "数学/default/ime-image-group",
  question: {
    ...initialDetail.question,
    id: "ime-image-group__01",
    type: "group",
    content: "第一小题",
  },
  storage_kind: "group",
  question_group: {
    id: "ime-image-group",
    type: "group",
    unified: "fill",
    material: "材料",
    items: [
      { content: "第一小题", answer: "答案一", analysis: "解析一", metadata: {} },
      { content: "旧第二小题", answer: "答案二", analysis: "解析二", metadata: {} },
    ],
  },
};

type LifecycleActions = {
  setDetail: Dispatch<SetStateAction<BankDetailState | null>>;
  setEditorVisible: Dispatch<SetStateAction<boolean>>;
  beginImageEmbed: ReturnType<typeof useBankImageUpload>["beginImageEmbed"];
};

function LifecycleHarness({
  onDetail,
  onActions,
  onBusyChange,
  onError = () => undefined,
  startingDetail = initialDetail,
}: {
  onDetail: (detail: BankDetailState, busy: boolean) => void;
  onActions?: (actions: LifecycleActions) => void;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: string | null) => void;
  startingDetail?: BankDetailState;
}) {
  const [detail, setDetail] = useState<BankDetailState | null>(startingDetail);
  const [busy, setBusy] = useState(false);
  const [editorVisible, setEditorVisible] = useState(true);
  const [editorTab, setEditorTab] = useState<"form" | "yaml">("form");
  const [rawYaml, setRawYaml] = useState(startingDetail.file_yaml);
  const [metaRows, setMetaRows] = useState<MetaRow[]>([]);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const analysisRef = useRef<HTMLTextAreaElement>(null);
  const materialGroupRef = useRef<HTMLTextAreaElement>(null);
  const upload = useBankImageUpload({
    detail,
    setDetail,
    setBusy,
    onError,
    contentRef,
    answerRef,
    analysisRef,
    materialGroupRef,
  });

  useEffect(() => {
    if (detail) onDetail(detail, busy);
  }, [busy, detail, onDetail]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onActions?.({ setDetail, setEditorVisible, beginImageEmbed: upload.beginImageEmbed });
  }, [onActions, setDetail, setEditorVisible, upload.beginImageEmbed]);

  if (!detail) return null;
  return (
    <TestI18nProvider>
      <button type="button" data-testid="focus-sentinel">Focus sentinel</button>
      {editorVisible ? (
        <BankQuestionEditorPanel
          panelMode="form"
          embedded
          detail={detail}
          setDetail={setDetail}
          busy={busy}
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
          imageInputRef={upload.imageInputRef}
          beginMathEmbed={vi.fn()}
          beginMermaidEmbed={vi.fn()}
          beginPrimeBrushEmbed={vi.fn()}
          beginImageEmbed={upload.beginImageEmbed}
          onImageFileSelected={upload.onImageFileSelected}
          onRemove={vi.fn()}
          onSave={vi.fn()}
          onSaveYaml={vi.fn()}
        />
      ) : <button type="button" data-testid="show-editor" onClick={() => setEditorVisible(true)}>Show editor</button>}
    </TestI18nProvider>
  );
}

function ControlledLatexHarness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState("原文");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => onValue(value), [onValue, value]);
  return (
    <TestI18nProvider>
      <button type="button" onClick={() => setValue("外部更新")}>外部更新</button>
      <LatexRichTextField value={value} onChange={setValue} textAreaRef={textAreaRef} />
    </TestI18nProvider>
  );
}

async function exerciseFinalCompositionInput(
  mode: "visual" | "source",
  finalInput: "same" | "append",
) {
  let resolveUpload!: (value: { marker: string }) => void;
  mocks.postFormData.mockImplementationOnce(
    () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
  );
  let latestDetail = initialDetail;
  let actions: LifecycleActions | undefined;
  const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
  const captureActions = (next: LifecycleActions) => { actions = next; };
  const { container } = render(
    <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
  );
  await waitFor(() => expect(actions).toBeDefined());

  if (mode === "source") {
    fireEvent.click(screen.getByRole("button", { name: "展开公式与绘图工具" }));
    fireEvent.click(screen.getAllByRole("button", { name: "源码" })[0]!);
  }
  const field = mode === "visual"
    ? container.querySelector("[contenteditable='true']") as HTMLDivElement
    : container.querySelector("textarea:not(.sr-only)") as HTMLTextAreaElement;
  act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
  fireEvent.change(container.querySelector("input[type='file']")!, {
    target: { files: [new File(["bytes"], `final-input-${mode}-${finalInput}.png`, { type: "image/png" })] },
  });
  await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

  fireEvent.compositionStart(field);
  const compositionText = "题干合成字";
  if (mode === "visual") {
    field.textContent = compositionText;
    fireEvent.input(field, { inputType: "insertCompositionText", data: "合成字" });
  } else {
    fireEvent.change(field, { target: { value: compositionText } });
  }
  await act(async () => {
    resolveUpload({ marker: ":::EMBED_IMG:final-input.png:::" });
    await Promise.resolve();
  });
  expect(latestDetail.question.content).toBe("题干");

  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  fireEvent.compositionEnd(field, { data: "合成字" });

  const finalText = finalInput === "append" ? `${compositionText}后` : compositionText;
  if (mode === "visual") {
    field.textContent = finalText;
    fireEvent.input(field, {
      inputType: finalInput === "append" ? "insertText" : "insertCompositionText",
      data: finalInput === "append" ? "后" : "合成字",
    });
  } else {
    fireEvent.change(field, { target: { value: finalText } });
  }

  const expected = `题干:::EMBED_IMG:final-input.png:::${finalText.slice("题干".length)}`;
  await waitFor(() => expect(latestDetail.question.content).toBe(expected));
  const syncTextarea = container.querySelector("textarea.sr-only") as HTMLTextAreaElement;
  expect(syncTextarea.value).toBe(expected);
  if (mode === "visual") expect(serializeEditor(field as HTMLDivElement)).toBe(expected);
  else expect((field as HTMLTextAreaElement).value).toBe(expected);
  expect(latestDetail.question.content.match(/:::EMBED_IMG:final-input\.png:::/g)).toHaveLength(1);

  if (frames[0]) act(() => frames[0]!(0));
  expect(latestDetail.question.content).toBe(expected);
  if (mode === "visual") expect(serializeEditor(field as HTMLDivElement)).toBe(expected);
  else expect((field as HTMLTextAreaElement).value).toBe(expected);
}

describe("bank image insertion during IME composition", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("solaire.platform.session", "ime-image-session");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps composed text and inserts the receipt at the saved position in the real editor", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; })
    );
    let latestDetail = initialDetail;
    let latestBusy = false;
    const observeDetail = (detail: BankDetailState, busy: boolean) => {
      latestDetail = detail;
      latestBusy = busy;
    };
    const { container } = render(<LifecycleHarness onDetail={observeDetail} />);

    fireEvent.click(screen.getByText("展开公式与绘图工具"));
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    const syncTextarea = container.querySelector("textarea.sr-only") as HTMLTextAreaElement;
    expect(editor.textContent).toBe("题干");
    syncTextarea.setSelectionRange(2, 2);
    fireEvent.click(container.querySelectorAll('button[title="插入图片"]')[0]);

    const imageInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const image = new File(["image-bytes"], "lesson.png", { type: "image/png" });
    fireEvent.change(imageInput, { target: { files: [image] } });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    expect(mocks.postFormData).toHaveBeenCalledWith(
      `/api/bank/items/${encodeURIComponent(initialDetail.qualified_id)}/image`,
      expect.any(FormData),
      { "If-Match": "v7" },
    );

    fireEvent.compositionStart(editor);
    editor.textContent = "题干新字";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "新字" });

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:resource/pic.png:::" });
      await Promise.resolve();
    });

    fireEvent.compositionEnd(editor, { data: "新字" });
    await waitFor(() => expect(latestDetail.question.content).toBe("题干:::EMBED_IMG:resource/pic.png:::新字"));

    expect(latestDetail.question.content).toBe("题干:::EMBED_IMG:resource/pic.png:::新字");
    expect(latestBusy).toBe(false);
    expect(syncTextarea.value).toBe(latestDetail.question.content);
    expect(serializeEditor(editor)).toBe(latestDetail.question.content);
    expect(editor.querySelectorAll(`.${IMAGE_WIDGET_CLASS}`)).toHaveLength(1);
    await waitFor(() => {
      expect(document.activeElement).toBe(editor);
      expect(syncTextarea.selectionStart).toBe("题干:::EMBED_IMG:resource/pic.png:::".length);
    });
  });

  it("orders same-field upload receipts by request and keeps image busy until both finish", async () => {
    const pending: Array<(value: { marker: string }) => void> = [];
    mocks.postFormData.mockImplementation(
      () => new Promise<{ marker: string }>((resolve) => { pending.push(resolve); }),
    );
    let latestDetail = initialDetail;
    let latestBusy = false;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState, busy: boolean) => {
      latestDetail = detail;
      latestBusy = busy;
    };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());

    const imageInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const select = (name: string) => fireEvent.change(imageInput, {
      target: { files: [new File([name], name, { type: "image/png" })] },
    });

    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("first.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("second.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(2));

    await act(async () => {
      pending[1]({ marker: ":::EMBED_IMG:second.png:::" });
      await Promise.resolve();
    });
    expect(latestBusy).toBe(true);
    expect(latestDetail.question.content).toBe("题干");

    await act(async () => {
      pending[0]({ marker: ":::EMBED_IMG:first.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(latestDetail.question.content).toBe(
        "题干:::EMBED_IMG:first.png::::::EMBED_IMG:second.png:::",
      );
      expect(latestBusy).toBe(false);
    });
  });

  it("keeps same-snapshot IME uploads in request order when the second receipt arrives first", async () => {
    const pending: Array<{ resolve: (value: { marker: string }) => void }> = [];
    mocks.postFormData.mockImplementation(
      () => new Promise<{ marker: string }>((resolve) => { pending.push({ resolve }); }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    const imageInput = container.querySelector("input[type='file']")!;
    const select = (name: string) => fireEvent.change(imageInput, {
      target: { files: [new File([name], name, { type: "image/png" })] },
    });
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("ime-first.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("ime-second.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(2));

    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);
    editor.textContent = "题干合成字";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "合成字" });
    await act(async () => {
      pending[1]!.resolve({ marker: ":::EMBED_IMG:ime-second.png:::" });
      await Promise.resolve();
    });
    await act(async () => {
      pending[0]!.resolve({ marker: ":::EMBED_IMG:ime-first.png:::" });
      await Promise.resolve();
    });
    fireEvent.compositionEnd(editor, { data: "合成字" });

    const expected = "题干:::EMBED_IMG:ime-first.png::::::EMBED_IMG:ime-second.png:::合成字";
    await waitFor(() => expect(latestDetail.question.content).toBe(expected));
    const syncTextarea = container.querySelector("textarea.sr-only") as HTMLTextAreaElement;
    expect(syncTextarea.value).toBe(expected);
    expect(serializeEditor(editor)).toBe(expected);
    expect(editor.querySelectorAll(`.${IMAGE_WIDGET_CLASS}`)).toHaveLength(2);
  });

  it("rechecks composition after an earlier same-field upload fails its insertion turn", async () => {
    const pending: Array<{
      resolve: (value: { marker: string }) => void;
      reject: (error: Error) => void;
    }> = [];
    mocks.postFormData.mockImplementation(
      () => new Promise<{ marker: string }>((resolve, reject) => { pending.push({ resolve, reject }); }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    const imageInput = container.querySelector("input[type='file']")!;
    const select = (name: string) => fireEvent.change(imageInput, {
      target: { files: [new File([name], name, { type: "image/png" })] },
    });
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("turn-fails.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    select("turn-succeeds.png");
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(2));

    await act(async () => {
      pending[1]!.resolve({ marker: ":::EMBED_IMG:turn-succeeds.png:::" });
      await Promise.resolve();
    });
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);
    editor.textContent = "题干稍后提交";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "稍后提交" });
    await act(async () => {
      pending[0]!.reject(new Error("first upload failed"));
      await Promise.resolve();
    });
    fireEvent.compositionEnd(editor, { data: "稍后提交" });

    const expected = "题干:::EMBED_IMG:turn-succeeds.png:::稍后提交";
    await waitFor(() => expect(latestDetail.question.content).toBe(expected));
    expect(serializeEditor(editor)).toBe(expected);
    expect((container.querySelector("textarea.sr-only") as HTMLTextAreaElement).value).toBe(expected);
  });

  it("does not apply a late upload to a newly added group member at the same index", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = groupDetail;
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} startingDetail={groupDetail} />,
    );

    const secondMemberCard = screen.getByText("小题 2").parentElement!;
    const secondMemberImageButton = secondMemberCard.querySelector("button[title]") as HTMLButtonElement;
    expect(secondMemberImageButton).toBeTruthy();
    fireEvent.click(secondMemberImageButton);
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "removed-member.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    const removedField = container.querySelector("#bank-gi-1-content") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "删除最后一个小题" }));
    fireEvent.click(screen.getByRole("button", { name: "添加小题" }));
    const replacementField = container.querySelector("#bank-gi-1-content") as HTMLTextAreaElement;
    expect(replacementField).toBeTruthy();
    expect(replacementField).not.toBe(removedField);

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:removed-member.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => expect(latestDetail.question_group?.items).toHaveLength(2));
    expect(latestDetail.question_group?.items[1]?.content).toBe("");
    const currentSecondMember = screen.getByText("小题 2").parentElement!;
    expect((currentSecondMember.querySelector("textarea.sr-only") as HTMLTextAreaElement).value).toBe("");
    expect(serializeEditor(currentSecondMember.querySelector("[contenteditable='true']")!)).toBe("");
  });

  it.each([
    ["visual", "same"],
    ["visual", "append"],
    ["source", "same"],
    ["source", "append"],
  ] as const)("preserves an upload and %s composition after the %s final input", async (mode, finalInput) => {
    await exerciseFinalCompositionInput(mode, finalInput);
  });

  it("inserts after the saved cursor while preserving ordinary text typed after upload starts", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());

    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "later.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    editor.textContent = "题干后续文字";
    fireEvent.input(editor, { inputType: "insertText", data: "后续文字" });
    await waitFor(() => expect(latestDetail.question.content).toBe("题干后续文字"));

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:later.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(latestDetail.question.content).toBe("题干:::EMBED_IMG:later.png:::后续文字");
      expect(serializeEditor(editor)).toBe(latestDetail.question.content);
    });
  });

  it("applies a completed upload after the field view unmounts without composition", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "detached.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    act(() => actions!.setEditorVisible(false));
    expect(container.querySelector("[contenteditable='true']")).toBeNull();
    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:detached.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => expect(latestDetail.question.content).toBe("题干:::EMBED_IMG:detached.png:::"));

    act(() => actions!.setEditorVisible(true));
    const editor = await waitFor(() => {
      const mountedEditor = container.querySelector("[contenteditable='true']") as HTMLDivElement | null;
      expect(mountedEditor).not.toBeNull();
      return mountedEditor!;
    });
    expect(serializeEditor(editor)).toBe(latestDetail.question.content);
    expect(editor.querySelectorAll(`.${IMAGE_WIDGET_CLASS}`)).toHaveLength(1);
  });

  it("does not insert after a composing field unmounts before the upload reply", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "composing-detached.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);
    editor.textContent = "题干未提交文字";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "未提交文字" });
    act(() => actions!.setEditorVisible(false));

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:composing-detached.png:::" });
      await Promise.resolve();
    });
    expect(latestDetail.question.content).toBe("题干");
  });

  it("treats compositionEnd queued before field unmount as pending until its callback runs", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "end-before-unmount.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    const callbacks: Array<FrameRequestCallback> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);
    editor.textContent = "题干已结束待提交";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "已结束待提交" });
    fireEvent.compositionEnd(editor, { data: "已结束待提交" });
    expect(callbacks).toHaveLength(1);
    act(() => actions!.setEditorVisible(false));

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:end-before-unmount.png:::" });
      await Promise.resolve();
    });
    expect(latestDetail.question.content).toBe("题干");
    act(() => callbacks[0]!(0));
    expect(latestDetail.question.content).toBe("题干");
  });

  it("ignores an upload that resolves after the editor switches questions", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let latestBusy = false;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState, busy: boolean) => {
      latestDetail = detail;
      latestBusy = busy;
    };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "pending.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    const otherDetail: BankDetailState = {
      ...initialDetail,
      qualified_id: "数学/default/ime-image-q2",
      question: { ...initialDetail.question, id: "ime-image-q2", content: "新题正文" },
      version: "v8",
    };
    act(() => actions!.setDetail(null));
    act(() => actions!.setDetail(otherDetail));
    await waitFor(() => expect(latestDetail.qualified_id).toBe(otherDetail.qualified_id));

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:late.png:::" });
      await Promise.resolve();
    });
    expect(latestDetail.question.content).toBe("新题正文");
    await waitFor(() => expect(latestBusy).toBe(false));
  });

  it("does not let a queued focus restore target a newly mounted question field", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "focus.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    const queued: Array<{ id: number; callback: FrameRequestCallback }> = [];
    let nextFrameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrameId;
      queued.push({ id, callback });
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:focus.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => expect(latestDetail.question.content).toContain("focus.png"));
    const staleFocus = queued.at(-1)?.callback;
    expect(staleFocus).toBeDefined();

    const otherDetail: BankDetailState = {
      ...initialDetail,
      qualified_id: "数学/default/ime-image-q3",
      question: { ...initialDetail.question, id: "ime-image-q3", content: "另一题" },
      version: "v9",
    };
    act(() => actions!.setDetail(null));
    act(() => actions!.setDetail(otherDetail));
    await waitFor(() => expect(latestDetail.qualified_id).toBe(otherDetail.qualified_id));
    const sentinel = screen.getByTestId("focus-sentinel");
    (sentinel as HTMLButtonElement).focus();

    act(() => staleFocus!(0));
    expect(document.activeElement).toBe(sentinel);
  });

  it("does not commit a response after the account session changes", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let latestBusy = false;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState, busy: boolean) => {
      latestDetail = detail;
      latestBusy = busy;
    };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "account.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));

    localStorage.setItem("solaire.platform.session", "different-account");
    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:account.png:::" });
      await Promise.resolve();
    });
    expect(latestDetail.question.content).toBe("题干");
    await waitFor(() => expect(latestBusy).toBe(false));
  });

  it("reports upload failure without inserting a marker or retaining image busy", async () => {
    mocks.postFormData.mockRejectedValueOnce(new Error("upload failed"));
    const onError = vi.fn();
    let latestDetail = initialDetail;
    let latestBusy = false;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState, busy: boolean) => {
      latestDetail = detail;
      latestBusy = busy;
    };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} onError={onError} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "fail.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("upload failed"));
    expect(latestDetail.question.content).toBe("题干");
    await waitFor(() => expect(latestBusy).toBe(false));
  });

  it("ignores a duplicate file-change callback after the picker target was consumed", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const { container } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    const imageInput = container.querySelector("input[type='file']")!;
    const selectedFile = new File(["bytes"], "duplicate.png", { type: "image/png" });
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(imageInput, { target: { files: [selectedFile] } });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    fireEvent.change(imageInput, { target: { files: [selectedFile] } });
    expect(mocks.postFormData).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:duplicate.png:::" });
      await Promise.resolve();
    });
    await waitFor(() => expect(latestDetail.question.content).toBe("题干:::EMBED_IMG:duplicate.png:::"));
    expect((latestDetail.question.content.match(/:::EMBED_IMG:/g) ?? [])).toHaveLength(1);
  });

  it("resolves a pending composition waiter on unmount without updating busy or detail", async () => {
    let resolveUpload!: (value: { marker: string }) => void;
    mocks.postFormData.mockImplementationOnce(
      () => new Promise<{ marker: string }>((resolve) => { resolveUpload = resolve; }),
    );
    let latestDetail = initialDetail;
    let actions: LifecycleActions | undefined;
    const captureActions = (next: LifecycleActions) => { actions = next; };
    const observeDetail = (detail: BankDetailState) => { latestDetail = detail; };
    const busyChanges = vi.fn();
    const { container, unmount } = render(
      <LifecycleHarness onDetail={observeDetail} onActions={captureActions} onBusyChange={busyChanges} />,
    );
    await waitFor(() => expect(actions).toBeDefined());
    act(() => actions!.beginImageEmbed({ k: "q", f: "content" }, { start: 2, end: 2 }));
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [new File(["bytes"], "unmount.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.postFormData).toHaveBeenCalledTimes(1));
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);

    await act(async () => {
      resolveUpload({ marker: ":::EMBED_IMG:unmount.png:::" });
      await Promise.resolve();
    });
    expect(busyChanges).toHaveBeenLastCalledWith(true);
    const busyCallCount = busyChanges.mock.calls.length;

    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(busyChanges).toHaveBeenCalledTimes(busyCallCount);
    expect(latestDetail.question.content).toBe("题干");
  });

  it("keeps question group material and selected member mirrors synchronized", () => {
    const groupDetail: BankDetailState = {
      ...initialDetail,
      question: {
        ...initialDetail.question,
        id: "ime-group__02",
        type: "group",
        content: "小题二题干",
        answer: "小题二答案",
        analysis: "小题二解析",
        group_material: "原材料",
      },
      question_group: {
        id: "ime-group",
        type: "group",
        material: "原材料",
        unified: false,
        items: [
          { type: "fill", content: "小题一", answer: "1", analysis: "解析一" },
          { type: "fill", content: "小题二题干", answer: "小题二答案", analysis: "小题二解析" },
        ],
      },
    };
    const member = insertSnippetIntoDetail(
      groupDetail,
      "[图]",
      { k: "gi", i: 1, f: "content" },
      { start: 3, end: 3 },
    );
    expect(member.question_group?.items[1]?.content).toBe("小题二[图]题干");
    expect(member.question.content).toBe("小题二[图]题干");

    const material = insertSnippetIntoDetail(
      groupDetail,
      "[材料图]",
      { k: "gm" },
      { start: 1, end: 1 },
    );
    expect(material.question_group?.material).toBe("原[材料图]材料");
    expect(material.question.group_material).toBe("原[材料图]材料");
  });
});

describe("rich text composition handoff and serialized caret", () => {
  it("commits captured visual and source composition values across mode switches", async () => {
    let latestValue = "";
    const observeValue = (value: string) => { latestValue = value; };
    const { container } = render(<ControlledLatexHarness onValue={observeValue} />);
    await waitFor(() => expect(latestValue).toBe("原文"));

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const visualEditor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(visualEditor);
    visualEditor.textContent = "原文视觉输入";
    fireEvent.input(visualEditor, { inputType: "insertCompositionText", data: "视觉输入" });
    fireEvent.compositionEnd(visualEditor, { data: "视觉输入" });
    const visualCommit = frames.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    act(() => visualCommit(0));
    await waitFor(() => expect(latestValue).toBe("原文视觉输入"));
    expect(container.querySelector("textarea:not(.sr-only)")?.textContent).not.toBe("外部更新");

    const source = container.querySelector("textarea:not(.sr-only)") as HTMLTextAreaElement;
    fireEvent.compositionStart(source);
    fireEvent.change(source, { target: { value: "源码输入已提交" } });
    fireEvent.compositionEnd(source, { data: "源码输入已提交" });
    const sourceCommit = frames.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "可视化" }));
    act(() => sourceCommit(0));
    await waitFor(() => expect(latestValue).toBe("源码输入已提交"));
    expect(serializeEditor(container.querySelector("[contenteditable='true']")!)).toBe(latestValue);
  });

  it("cancels a delayed composition callback when a newer controlled value arrives", async () => {
    let latestValue = "";
    const observeValue = (value: string) => { latestValue = value; };
    const { container } = render(<ControlledLatexHarness onValue={observeValue} />);
    await waitFor(() => expect(latestValue).toBe("原文"));
    const syncTextarea = container.querySelector("textarea.sr-only") as HTMLTextAreaElement;

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    fireEvent.compositionStart(editor);
    editor.textContent = "原文过期组合";
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "过期组合" });
    fireEvent.compositionEnd(editor, { data: "过期组合" });
    const staleCommit = frames.at(-1)!;
    const waitResult: { value?: boolean } = {};
    void waitForAsyncFieldCompositionCommit(syncTextarea).then((value) => { waitResult.value = value; });

    fireEvent.click(screen.getByRole("button", { name: "外部更新" }));
    await waitFor(() => expect(latestValue).toBe("外部更新"));
    await waitFor(() => expect(waitResult.value).toBe(false));
    act(() => staleCommit(0));
    expect(latestValue).toBe("外部更新");
    expect(serializeEditor(editor)).toBe("外部更新");
  });

  it("round-trips caret offsets across text, BR, and image widgets", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    root.tabIndex = 0;
    document.body.appendChild(root);
    const value = "甲\n:::EMBED_IMG:p.png:::乙";
    buildEditorDom(root, value);
    expect(serializeEditor(root)).toBe(value);
    const afterImage = "甲\n:::EMBED_IMG:p.png:::".length;
    const offsets = [0, 1, 2, afterImage, afterImage + 1, value.length];

    for (const offset of offsets) {
      focusVisualEditorAtSerializedOffset(root, offset);
      const selection = window.getSelection();
      expect(selection?.rangeCount).toBe(1);
      expect(getSerializedCaretOffset(root, selection!.getRangeAt(0))).toBe(offset);
    }

    root.remove();
  });
});
