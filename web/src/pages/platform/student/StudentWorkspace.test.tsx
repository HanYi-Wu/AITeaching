import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentWorkspace } from "./StudentWorkspace";
import { studentDraftKey } from "./studentTextDraft";

const mocks = vi.hoisted(() => ({
  updateStudentAccount: vi.fn(),
  listStudentPapers: vi.fn(),
  startStudentPaper: vi.fn(),
  saveStudentAnswers: vi.fn(),
  submitStudentAttempt: vi.fn(),
  listStudentResults: vi.fn(),
  recordStudentProctorEvent: vi.fn(),
  apiGetBlob: vi.fn(),
}));

function delayedIndexedDb() {
  const rows = new Map<string, unknown>();
  let created = false;
  let delayNextWrite = false;
  let signalWrite!: () => void;
  let releaseWrite: (() => void) | null = null;
  let writeStarted = new Promise<void>((resolve) => { signalWrite = resolve; });
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close: () => undefined,
    transaction: (_storeName: string, mode: IDBTransactionMode) => {
      const tx: {
        error: DOMException | null; oncomplete: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null; onabort: ((event: Event) => void) | null;
        objectStore: () => unknown;
      } = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: () => store };
      const complete = () => {
        if (mode === "readwrite" && delayNextWrite) {
          delayNextWrite = false;
          signalWrite();
          releaseWrite = () => tx.oncomplete?.(new Event("complete"));
        } else queueMicrotask(() => tx.oncomplete?.(new Event("complete")));
      };
      const store = {
        get: (key: string) => {
          const request: { result?: unknown; error?: DOMException; onsuccess?: (event: Event) => void; onerror?: (event: Event) => void } = {};
          queueMicrotask(() => { request.result = rows.get(key); request.onsuccess?.(new Event("success")); });
          return request;
        },
        put: (value: { key: string }) => { rows.set(value.key, structuredClone(value)); complete(); },
        delete: (key: string) => { rows.delete(key); complete(); },
      };
      return tx as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const factory = {
    open: () => {
      const request = {} as IDBOpenDBRequest;
      Object.defineProperty(request, "result", { configurable: true, get: () => database });
      queueMicrotask(() => {
        if (!created) request.onupgradeneeded?.(new Event("upgrade") as IDBVersionChangeEvent);
        request.onsuccess?.(new Event("success"));
      });
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    arm() { delayNextWrite = true; writeStarted = new Promise<void>((resolve) => { signalWrite = resolve; }); },
    waitForWrite() { return writeStarted; },
    release() { releaseWrite?.(); releaseWrite = null; },
  };
}

vi.mock('../../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/client')>(), apiGetBlob: mocks.apiGetBlob,
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    updateStudentAccount: mocks.updateStudentAccount,
    listStudentPapers: mocks.listStudentPapers,
    startStudentPaper: mocks.startStudentPaper,
    saveStudentAnswers: mocks.saveStudentAnswers,
    submitStudentAttempt: mocks.submitStudentAttempt,
    listStudentResults: mocks.listStudentResults,
    recordStudentProctorEvent: mocks.recordStudentProctorEvent,
  };
});

describe("StudentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("solaire.platform.session", "test-token");
    mocks.listStudentPapers.mockResolvedValue({
      papers: [
        {
          publication_id: "pub1",
          attempt_id: "attempt1",
          exam_id: "midterm/Math",
          title: "Online Midterm",
          subject: "Math",
          status: "not_started",
          question_count: 2,
          paper_max_score: 10,
          screen_switch_count: 0,
          screen_switch_limit: 2,
          time_spent_seconds: 0,
          time_limit_minutes: 30,
          end_at: "2026-08-25T08:00:00Z",
          show_results: true,
        },
      ],
    });
    mocks.listStudentResults.mockResolvedValue({
      results: [
        {
          attempt_id: "done1",
          publication_id: "pub0",
          exam_id: "quiz/Math",
          title: "Old Quiz",
          subject: "Math",
          status: "submitted",
          score: 8,
          max_score: 10,
          score_percent: 80,
          screen_switch_count: 1,
          screen_switch_limit: 2,
          time_spent_seconds: 300,
          show_results: true,
          analysis: { correct_count: 1, wrong_count: 1, answered_count: 2, screen_switch_count: 1 },
          answers: [],
        },
      ],
    });
  });

  it("lets a student change password and username separately", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: { id: "s1", role: "student", username: "student_custom", display_name: "Student", status: "active" },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("student-page-home")).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId("student-page-account"));
    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.type(screen.getByTestId("student-account-confirm-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: null,
        current_password: "initial123",
        new_password: "changed123",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "修改用户名" }));
    await userEvent.type(screen.getByTestId("student-account-username"), "student_custom");
    await userEvent.type(screen.getByTestId("student-account-current-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenLastCalledWith({
        username: "student_custom",
        current_password: "changed123",
        new_password: null,
      }),
    );
  });

  it("shows a student getting-started checklist derived from real progress", async () => {
    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    expect(screen.getByText("完成改密、查看待答试卷并提交第一份答卷")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(2);
  });

  it("shows every graded question and can filter the review to wrong answers", async () => {
    mocks.listStudentResults.mockResolvedValue({
      results: [{
        attempt_id: "done1", publication_id: "pub0", exam_id: "quiz/Math", title: "Old Quiz", subject: "Math",
        status: "submitted", score: 8, max_score: 10, score_percent: 80, time_spent_seconds: 300, show_results: true,
        analysis: { correct_count: 1, wrong_count: 1, answered_count: 2 },
        answers: [
          { question_id: "q1", header: "1", content: "1+1=?", answer: "A", correct_answer: "A", analysis: "因为 1+1=2", score: 5, score_per_item: 5, is_correct: true, feedback: "回答正确。" },
          { question_id: "q2", header: "2", content: "2+2=?", answer: "3", correct_answer: "4", analysis: "两个 2 相加等于 4", score: 0, score_per_item: 5, is_correct: false, feedback: "注意基本运算。" },
        ],
      }],
    });

    render(<StudentWorkspace user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }} onLogout={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("student-page-results"));

    expect(await screen.findByText("逐题复盘")).toBeInTheDocument();
    expect(screen.getByText("回答正确。")).toBeInTheDocument();
    expect(screen.getByText("因为 1+1=2")).toBeInTheDocument();
    expect(screen.getByText("正确答案：A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "只看错题" }));
    expect(screen.queryByText("回答正确。")).not.toBeInTheDocument();
    expect(screen.getByText("注意基本运算。")).toBeInTheDocument();
  });

  it("forces first-login students to change password before entering papers", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: {
        id: "s1",
        role: "student",
        username: "stu_abcd",
        display_name: "Student",
        status: "active",
        must_change_password: false,
      },
    });

    render(
      <StudentWorkspace
        user={{
          id: "s1",
          role: "student",
          username: "stu_abcd",
          display_name: "Student",
          status: "active",
          must_change_password: true,
        }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByText("首次登录必须先修改密码，完成后才能进入答题和成绩页面。")).toBeInTheDocument();
    expect(screen.getByTestId("student-page-home")).toBeDisabled();
    expect(screen.getByTestId("student-page-papers")).toBeDisabled();
    expect(screen.queryByTestId("student-account-username")).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.type(screen.getByTestId("student-account-confirm-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: null,
        current_password: "initial123",
        new_password: "changed123",
      }),
    );
  });

  it("lets a student answer an online paper and see result analysis", async () => {
    mocks.apiGetBlob.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    URL.createObjectURL = vi.fn(() => 'blob:student-question');
    URL.revokeObjectURL = vi.fn();
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        screen_switch_count: 0,
        screen_switch_limit: 2,
        time_limit_minutes: 30,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?\n:::EMBED_IMG:数学/默认/image/9dd960026799698df.png:::",
          options: { A: "2", B: "3" },
        },
        {
          question_id: "math/q2",
          header: "1.2",
          section_id: "Choice",
          score_per_item: 5,
          type: "fill",
          content: "计算 $2+2$",
          options: null,
        },
        {
          question_id: "math/q3",
          header: "1.3",
          section_id: "Choice",
          score_per_item: 5,
          type: "multiple_choice",
          content: "Select primes",
          options: { A: "2", B: "4", C: "5" },
        },
      ],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 2 });
    mocks.submitStudentAttempt.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "submitted",
        score: 5,
        max_score: 10,
        score_percent: 50,
        time_spent_seconds: 120,
        screen_switch_count: 0,
        screen_switch_limit: 2,
        show_results: true,
      },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("student-page-papers"));
    expect(await screen.findByText("Online Midterm")).toBeInTheDocument();
    expect(screen.getByText("总分 10 分")).toBeInTheDocument();
    expect(screen.getByText("限时 30 分钟")).toBeInTheDocument();
    expect(screen.getByText(/截止/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    expect(await screen.findByText("1+1=?")).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '题目图片' })).toHaveAttribute('src', 'blob:student-question');
    expect(screen.queryByText(/:::EMBED_IMG/)).not.toBeInTheDocument();
    expect(document.querySelector(".katex")).not.toBeNull();
    expect(screen.getByText("30:00")).toBeInTheDocument();
    expect(screen.queryByText("返回待答")).not.toBeInTheDocument();
    expect(screen.queryByText("退出登录")).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByLabelText("A. 2")[0]!);
    await userEvent.type(screen.getByTestId("student-answer-math/q2"), "4");
    await userEvent.click(screen.getAllByLabelText("A. 2")[1]!);
    await userEvent.click(screen.getByLabelText("C. 5"));
    await userEvent.click(screen.getByTestId("student-submit-attempt"));

    expect(mocks.saveStudentAnswers).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "提交前确认" })).toBeInTheDocument();
    expect(screen.getByText("已答 3 题")).toBeInTheDocument();
    expect(screen.getByText("未答 0 题")).toBeInTheDocument();
    expect(screen.getByText("有未保存修改，将随提交一并保存")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() =>
      expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
        "attempt1",
        expect.objectContaining({
          time_spent_seconds: expect.any(Number),
          answers: [
            { question_id: "math/q1", answer: "A", images: [] },
            { question_id: "math/q2", answer: "4", images: [] },
            { question_id: "math/q3", answer: "AC", images: [] },
          ],
        }),
      ),
    );
    await waitFor(() => expect(screen.getAllByText("Old Quiz").length).toBeGreaterThan(0));
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/切屏/)).not.toBeInTheDocument();
  });

  it("submits image answers when the publication requires image upload", async () => {
    mocks.listStudentPapers.mockResolvedValue({
      papers: [
        {
          publication_id: "pub-img",
          attempt_id: "attempt-img",
          exam_id: "image/Math",
          title: "Image Exam",
          subject: "Math",
          status: "not_started",
          question_count: 1,
          screen_switch_count: 0,
          screen_switch_limit: 0,
          time_spent_seconds: 0,
          show_results: false,
          submission_mode: "image_ai",
        },
      ],
    });
    mocks.listStudentResults.mockResolvedValue({ results: [] });
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt-img",
        publication_id: "pub-img",
        exam_id: "image/Math",
        title: "Image Exam",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        screen_switch_count: 0,
        screen_switch_limit: 0,
        show_results: false,
        submission_mode: "image_ai",
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Work",
          score_per_item: 5,
          type: "short_answer",
          content: "Show your work.",
          options: null,
        },
      ],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 1 });
    mocks.submitStudentAttempt.mockResolvedValue({
      attempt: {
        id: "attempt-img",
        publication_id: "pub-img",
        exam_id: "image/Math",
        title: "Image Exam",
        subject: "Math",
        status: "submitted",
        score: null,
        max_score: 5,
        score_percent: null,
        time_spent_seconds: 120,
        screen_switch_count: 0,
        screen_switch_limit: 0,
        show_results: false,
        submission_mode: "image_ai",
      },
    });

    const originalReadAsDataURL = FileReader.prototype.readAsDataURL;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function readAsDataURL(this: FileReader) {
      Object.defineProperty(this, "result", { value: "data:image/png;base64,ZmFrZQ==", configurable: true });
      this.onload?.({ target: this } as ProgressEvent<FileReader>);
    });

    try {
      render(
        <StudentWorkspace
          user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
          onLogout={vi.fn()}
        />,
      );

      await userEvent.click(await screen.findByTestId("student-page-papers"));
      expect(await screen.findByText("Image Exam")).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("student-start-pub-img"));
      const file = new File(["fake"], "answer.png", { type: "image/png" });
      await userEvent.upload(await screen.findByTestId("student-image-math/q1"), file);
      expect(await screen.findByText("本机图片存储暂不可用，图片只保留在当前页面；请及时保存到服务器。")).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("student-submit-attempt"));
      await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

      await waitFor(() =>
        expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
          "attempt-img",
          expect.objectContaining({
            answers: [
              {
                question_id: "math/q1",
                answer: "",
                images: [{ name: "answer.png", mime_type: "image/png", data_url: "data:image/png;base64,ZmFrZQ==" }],
              },
            ],
          }),
        ),
      );
      expect(await screen.findByText("查看未确认的本机图片：Image Exam")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "math/q1 未确认的答题图片" })).toBeInTheDocument();
    } finally {
      FileReader.prototype.readAsDataURL = originalReadAsDataURL;
    }
  });

  it("shows both submitted and newer unconfirmed images when submission has no acceptance receipt", async () => {
    mocks.listStudentPapers.mockResolvedValue({ papers: [{
      publication_id: "pub-img", attempt_id: "attempt-img", exam_id: "image/Math", title: "Image Exam", subject: "Math",
      status: "not_started", question_count: 1, screen_switch_count: 0, screen_switch_limit: 0, time_spent_seconds: 0,
      show_results: false, submission_mode: "image_ai",
    }] });
    mocks.listStudentResults.mockResolvedValue({ results: [] });
    mocks.startStudentPaper.mockResolvedValue({
      attempt: { id: "attempt-img", publication_id: "pub-img", title: "Image Exam", status: "in_progress", submission_mode: "image_ai" },
      questions: [{ question_id: "math/q1", header: "1", section_id: "Work", score_per_item: 5, type: "short_answer", content: "Show work" }],
    });
    let finishSubmit!: (value: { attempt: { id: string; status: string } }) => void;
    mocks.submitStudentAttempt.mockImplementationOnce(() => new Promise((resolve) => { finishSubmit = resolve; }));
    const originalReadAsDataURL = FileReader.prototype.readAsDataURL;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function readAsDataURL(this: FileReader, blob?: Blob) {
      const name = blob instanceof File ? blob.name : "answer.png";
      Object.defineProperty(this, "result", { value: `data:image/png;base64,${name}`, configurable: true });
      this.onload?.({ target: this } as ProgressEvent<FileReader>);
    });
    try {
      render(<StudentWorkspace user={{ id: "s1", role: "student", username: "student", display_name: "Student", status: "active" }} onLogout={vi.fn()} />);
      await userEvent.click(await screen.findByTestId("student-page-papers"));
      await userEvent.click(screen.getByTestId("student-start-pub-img"));
      const input = await screen.findByTestId("student-image-math/q1");
      await userEvent.upload(input, new File(["first"], "first.png", { type: "image/png" }));
      await userEvent.click(screen.getByTestId("student-submit-attempt"));
      await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
      await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
      await userEvent.upload(input, new File(["newer"], "newer.png", { type: "image/png" }));
      await waitFor(() => expect(screen.getByText("newer.png")).toBeInTheDocument());
      await act(async () => finishSubmit({ attempt: { id: "attempt-img", status: "submitted" } }));
      expect(await screen.findByText("查看未确认的本机图片：Image Exam")).toBeInTheDocument();
      expect(screen.getByText("math/q1 · newer.png")).toBeInTheDocument();
      expect(screen.getByText("math/q1 · first.png")).toBeInTheDocument();
    } finally {
      FileReader.prototype.readAsDataURL = originalReadAsDataURL;
    }
  });

  it("restores a draft, shows progress, saves without submitting on page hide, and confirms unanswered questions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        time_limit_minutes: 30,
        remaining_seconds: 1234,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?",
          options: { A: "2", B: "3" },
        },
        {
          question_id: "math/q2",
          header: "1.2",
          section_id: "Choice",
          score_per_item: 5,
          type: "fill",
          content: "2+2=?",
          options: null,
        },
      ],
      saved_answers: [{ question_id: "math/q1", answer: "A", images: [] }],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 2 });
    mocks.submitStudentAttempt.mockResolvedValue({ attempt: { id: "attempt1", status: "submitted" } });
    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));

    expect(await screen.findByText("20:34")).toBeInTheDocument();
    expect(screen.getByText("已作答 1 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("A. 2")).toBeChecked();
    expect(screen.getByText("草稿已恢复")).toBeInTheDocument();

    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.submitStudentAttempt).not.toHaveBeenCalled();
    await waitFor(() => {
      const keepaliveCall = fetchSpy.mock.calls.find(([, init]) => init?.keepalive === true);
      expect(keepaliveCall).toBeDefined();
      expect(JSON.parse(String(keepaliveCall?.[1]?.body))).toEqual({
        answers: [
          { question_id: "math/q1", answer: "A", images: [] },
          { question_id: "math/q2", answer: "", images: [] },
        ],
      });
    });

    document.dispatchEvent(new Event("copy"));
    await waitFor(() =>
      expect(mocks.recordStudentProctorEvent).toHaveBeenCalledWith(
        "attempt1",
        expect.objectContaining({ event_type: "copy" }),
      ),
    );

    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    expect(screen.getByRole("dialog", { name: "提交前确认" })).toBeInTheDocument();
    expect(screen.getByText("已答 1 题")).toBeInTheDocument();
    expect(screen.getByText("未答 1 题")).toBeInTheDocument();
    expect(screen.getByText("草稿已恢复，可安全提交")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "继续检查" }));
    expect(mocks.submitStudentAttempt).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
    fetchSpy.mockRestore();
  });

  it("recovers newer text after a late save and retains it until submission succeeds", async () => {
    const user = { id: "s1", role: "student" as const, username: "student", display_name: "Student", status: "active" };
    const scope = { accountId: "s1", projectScope: "project-1", publicationId: "pub1", attemptId: "attempt1", snapshotVersion: "snapshot-1" };
    const data = {
      attempt: { id: "attempt1", publication_id: "pub1", exam_id: "midterm/Math", title: "Text Paper", status: "in_progress",
        project_scope: scope.projectScope, snapshot_version: scope.snapshotVersion },
      questions: [{ question_id: "math/q1", header: "1", section_id: "Work", score_per_item: 5, type: "fill", content: "Explain" }],
      saved_answers: [] as Array<{ question_id: string; answer: string }>,
    };
    mocks.startStudentPaper.mockResolvedValue(data);
    let finishSave!: (result: { answer_count: number }) => void;
    mocks.saveStudentAnswers.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const first = render(<StudentWorkspace user={user} onLogout={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    await userEvent.type(await screen.findByTestId("student-answer-math/q1"), "first");
    await userEvent.click(screen.getByTestId("student-save-draft"));
    await userEvent.type(screen.getByTestId("student-answer-math/q1"), " newest");
    await act(async () => finishSave({ answer_count: 1 }));
    expect(localStorage.getItem(studentDraftKey(scope)!)).toContain("first newest");
    first.unmount();

    mocks.startStudentPaper.mockResolvedValue({ ...data, saved_answers: [{ question_id: "math/q1", answer: "first" }] });
    render(<StudentWorkspace user={user} onLogout={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    expect(await screen.findByTestId("student-answer-math/q1")).toHaveValue("first newest");
    expect(screen.getByText("已恢复本机文本草稿，等待保存到服务器。")).toBeInTheDocument();
    mocks.submitStudentAttempt.mockRejectedValueOnce(new Error("offline submission"));
    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    expect(await screen.findByText("offline submission")).toBeInTheDocument();
    expect(localStorage.getItem(studentDraftKey(scope)!)).not.toBeNull();
    mocks.submitStudentAttempt.mockResolvedValueOnce({ attempt: { id: "attempt1", status: "submitted", submitted_answers_accepted: true } });
    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(localStorage.getItem(studentDraftKey(scope)!)).toBeNull());
    expect(mocks.submitStudentAttempt).toHaveBeenLastCalledWith("attempt1", expect.objectContaining({
      answers: [{ question_id: "math/q1", answer: "first newest", images: [] }],
    }));
  });

  it.each([[false, true], [undefined, true], [false, false], [undefined, false]])("retains text when a submission response does not confirm this payload (accepted=%s, scope=%s)", async (accepted, withScope) => {
    const scope = { accountId: "s1", projectScope: "project-1", publicationId: "pub1", attemptId: "attempt1", snapshotVersion: "snapshot-1" };
    mocks.startStudentPaper.mockResolvedValue({
      attempt: { id: "attempt1", publication_id: "pub1", exam_id: "midterm/Math", title: "Text Paper", status: "in_progress",
        ...(withScope ? { project_scope: scope.projectScope, snapshot_version: scope.snapshotVersion } : {}) },
      questions: [{ question_id: "math/q1", header: "1", section_id: "Work", score_per_item: 5, type: "fill", content: "Explain" }], saved_answers: [],
    });
    mocks.submitStudentAttempt.mockResolvedValue({ attempt: { id: "attempt1", status: "submitted", submitted_answers_accepted: accepted } });
    render(<StudentWorkspace user={{ id: "s1", role: "student", username: "student", display_name: "Student", status: "active" }} onLogout={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    await userEvent.type(await screen.findByTestId("student-answer-math/q1"), "local not submitted");
    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    expect(await screen.findByText("查看未确认的本机文本：Text Paper")).toBeInTheDocument();
    if (withScope) expect(localStorage.getItem(studentDraftKey(scope)!)).toContain("local not submitted");
    else expect(screen.getByText("本机存储暂不可用，请在离开本页前复制以下文本。")).toBeInTheDocument();
    expect(screen.getByText("math/q1: local not submitted")).toBeInTheDocument();
  });

  it("keeps text entered while post-submit image draft confirmation is waiting", async () => {
    const indexedDb = delayedIndexedDb();
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb.factory });
    const scope = { accountId: "s1", projectScope: "project-1", publicationId: "pub1", attemptId: "attempt1", snapshotVersion: "snapshot-1" };
    mocks.startStudentPaper.mockResolvedValue({
      attempt: { id: "attempt1", publication_id: "pub1", title: "Text Paper", status: "in_progress",
        project_scope: scope.projectScope, snapshot_version: scope.snapshotVersion },
      questions: [{ question_id: "math/q1", header: "1", section_id: "Work", score_per_item: 5, type: "fill", content: "Explain" }],
      saved_answers: [],
    });
    mocks.submitStudentAttempt.mockImplementationOnce(() => {
      indexedDb.arm();
      return Promise.resolve({ attempt: { id: "attempt1", status: "submitted", submitted_answers_accepted: false } });
    });
    try {
      render(<StudentWorkspace user={{ id: "s1", role: "student", username: "student", display_name: "Student", status: "active" }} onLogout={vi.fn()} />);
      await userEvent.click(await screen.findByTestId("student-page-papers"));
      await userEvent.click(screen.getByTestId("student-start-pub1"));
      const answer = await screen.findByTestId("student-answer-math/q1");
      await userEvent.type(answer, "sent");
      await userEvent.click(screen.getByTestId("student-submit-attempt"));
      await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
      await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
      await indexedDb.waitForWrite();
      await userEvent.type(answer, " later");
      indexedDb.release();
      expect(await screen.findByText("查看未确认的本机文本：Text Paper")).toBeInTheDocument();
      expect(screen.getByText("math/q1: sent later")).toBeInTheDocument();
    } finally {
      indexedDb.release();
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });

  it("auto-submits at zero without an unanswered confirmation", async () => {
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Timed Exam",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 60,
        time_limit_minutes: 1,
        remaining_seconds: 0,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?",
          options: { A: "2", B: "3" },
        },
      ],
      saved_answers: [],
    });
    mocks.submitStudentAttempt.mockResolvedValue({ attempt: { id: "attempt1", status: "submitted" } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));

    await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
      "attempt1",
      expect.objectContaining({ answers: [{ question_id: "math/q1", answer: "", images: [] }] }),
    );
    confirmSpy.mockRestore();
  });
});
