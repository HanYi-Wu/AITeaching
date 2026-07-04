import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ClipboardList, RefreshCw, Upload, Wifi } from "lucide-react";
import { resolveApiUrl } from "../../api/client";
import {
  listPlatformPapers,
  listTeacherAssignedClasses,
  publishPlatformPaper,
  updatePlatformPaperDeliveryMode,
  uploadPaperScores,
  type PlatformPaperRecord,
  type TeacherClassRecord,
} from "../../platform/auth";

type Props = {
  onOpenAnalysis?: (examId: string) => void;
  onError?: (message: string | null) => void;
};

function deliveryLabel(mode: PlatformPaperRecord["delivery_mode"]): string {
  return mode === "online" ? "线上" : "线下";
}

function mergePaper(existing: PlatformPaperRecord, patch: PlatformPaperRecord): PlatformPaperRecord {
  return {
    ...existing,
    ...patch,
    question_count: patch.question_count || existing.question_count,
    section_count: patch.section_count || existing.section_count,
    score_batch_count: patch.score_batch_count || existing.score_batch_count,
    publication_count: patch.publication_count || existing.publication_count,
    published_class_count: patch.published_class_count || existing.published_class_count,
  };
}

export function PapersWorkspace({ onOpenAnalysis, onError }: Props) {
  const [papers, setPapers] = useState<PlatformPaperRecord[]>([]);
  const [classes, setClasses] = useState<TeacherClassRecord[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.paper_id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );

  function reportError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    onError?.(text);
    setMessage(text);
  }

  async function refresh() {
    setLoading(true);
    onError?.(null);
    setMessage(null);
    try {
      const [paperData, classData] = await Promise.all([listPlatformPapers(), listTeacherAssignedClasses()]);
      setPapers(paperData.papers);
      setClasses(classData.classes);
      setSelectedPaperId((current) => {
        if (current && paperData.papers.some((paper) => paper.paper_id === current)) return current;
        return paperData.papers[0]?.paper_id ?? "";
      });
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setDeliveryMode(paper: PlatformPaperRecord, mode: PlatformPaperRecord["delivery_mode"]) {
    setBusy(`mode:${paper.paper_id}`);
    setMessage(null);
    try {
      const updated = await updatePlatformPaperDeliveryMode(paper.paper_id, mode);
      setPapers((current) =>
        current.map((item) => (item.paper_id === paper.paper_id ? mergePaper(item, updated.paper) : item)),
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function toggleClass(classId: string) {
    setSelectedClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  async function publishSelectedPaper() {
    if (!selectedPaper) return;
    setBusy(`publish:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await publishPlatformPaper(selectedPaper.paper_id, {
        class_ids: selectedClassIds,
        title: selectedPaper.title,
      });
      setPapers((current) =>
        current.map((item) =>
          item.paper_id === selectedPaper.paper_id
            ? {
                ...item,
                delivery_mode: "online",
                status: "published",
                publication_count: item.publication_count + 1,
                published_class_count: Math.max(item.published_class_count, selectedClassIds.length),
              }
            : item,
        ),
      );
      setMessage("已发布");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function downloadScoreTemplate() {
    if (!selectedPaper) return;
    const url = await resolveApiUrl(`/api/exams/${encodeURIComponent(selectedPaper.exam_id)}/score-template`);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function uploadScores(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedPaper) return;
    setBusy(`scores:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await uploadPaperScores(selectedPaper.exam_id, file);
      setMessage("成绩已上传");
      await refresh();
    } catch (e) {
      reportError(e);
    } finally {
      event.target.value = "";
      setBusy(null);
    }
  }

  const modeBusy = selectedPaper ? busy === `mode:${selectedPaper.paper_id}` : false;
  const publishBusy = selectedPaper ? busy === `publish:${selectedPaper.paper_id}` : false;
  const scoresBusy = selectedPaper ? busy === `scores:${selectedPaper.paper_id}` : false;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50 text-slate-950">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">试卷管理</h1>
            <p className="text-sm text-slate-500">线上发布、线下成绩和分析入口</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,360px)_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-white p-3">
          <div className="space-y-2">
            {papers.map((paper) => (
              <button
                key={paper.paper_id}
                type="button"
                onClick={() => setSelectedPaperId(paper.paper_id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedPaper?.paper_id === paper.paper_id
                    ? "border-slate-900 bg-slate-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{paper.title}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      paper.delivery_mode === "online"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {deliveryLabel(paper.delivery_mode)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{paper.subject}</span>
                  <span>{paper.question_count} 题</span>
                  <span>{paper.score_batch_count} 次成绩</span>
                </div>
              </button>
            ))}
            {!loading && papers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                暂无已导出的试卷
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto p-6">
          {selectedPaper ? (
            <div className="mx-auto flex max-w-5xl flex-col gap-5">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{selectedPaper.subject}</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950">{selectedPaper.title}</h2>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
                      <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.question_count} 题</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.section_count} 个题组</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">
                        {selectedPaper.score_batch_count} 次成绩
                      </span>
                      {selectedPaper.status === "published" ? (
                        <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-700">已发布</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-1">
                    <button
                      type="button"
                      data-testid="paper-mode-offline"
                      disabled={modeBusy || selectedPaper.delivery_mode === "offline"}
                      onClick={() => void setDeliveryMode(selectedPaper, "offline")}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        selectedPaper.delivery_mode === "offline"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      } disabled:opacity-70`}
                    >
                      设为线下
                    </button>
                    <button
                      type="button"
                      data-testid="paper-mode-online"
                      disabled={modeBusy || selectedPaper.delivery_mode === "online"}
                      onClick={() => void setDeliveryMode(selectedPaper, "online")}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        selectedPaper.delivery_mode === "online"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      } disabled:opacity-70`}
                    >
                      设为线上
                    </button>
                  </div>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <Wifi className="h-5 w-5 text-slate-600" />
                    <h3 className="font-semibold">发布班级</h3>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {classes.map((klass) => (
                      <label
                        key={klass.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-slate-300"
                      >
                        <input
                          data-testid={`paper-class-${klass.id}`}
                          type="checkbox"
                          checked={selectedClassIds.includes(klass.id)}
                          onChange={() => toggleClass(klass.id)}
                          className="h-4 w-4"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{klass.name}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {[klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </label>
                    ))}
                    {classes.length === 0 ? (
                      <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        暂无可发布班级
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    data-testid="paper-publish"
                    disabled={publishBusy || selectedClassIds.length === 0}
                    onClick={() => void publishSelectedPaper()}
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    发布到班级
                  </button>
                </section>

                <aside className="space-y-4">
                  <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <Upload className="h-5 w-5 text-slate-600" />
                      <h3 className="font-semibold">线下成绩</h3>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void downloadScoreTemplate()}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        下载成绩模板
                      </button>
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        {scoresBusy ? "上传中..." : "上传成绩"}
                        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => void uploadScores(event)} />
                      </label>
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-slate-600" />
                      <h3 className="font-semibold">分析</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAnalysis?.(selectedPaper.exam_id)}
                      className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      打开分析
                    </button>
                  </section>
                </aside>
              </div>
              {message ? (
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                  {message}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {loading ? "正在加载试卷..." : "暂无试卷"}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
