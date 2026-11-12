import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, X } from "lucide-react";
import {
  downloadPaperAnalysisReport, exportStudentAccounts, listClasses, listPlatformPapers, getSchoolPaperExportOptions,
  type ClassRecord, type PlatformPaperRecord, type SchoolPaperExportOption,
} from "../../../../platform/auth";
import { Select } from "../../../../components/ui/select";
import { downloadBlob } from "../hooks/useSchoolWorkspaceData";

export function SchoolExportDialog({ kind, onClose }: {
  kind: "accounts" | "analysis";
  onClose: () => void;
}) {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [classId, setClassId] = useState("");
  const [loadingClasses, setLoadingClasses] = useState(kind === "accounts");
  const [papers, setPapers] = useState<PlatformPaperRecord[]>([]);
  const [paperId, setPaperId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingPapers, setLoadingPapers] = useState(kind === "analysis");
  const [publications, setPublications] = useState<SchoolPaperExportOption[]>([]);
  const [publicationId, setPublicationId] = useState("");
  const [scopePaperId, setScopePaperId] = useState("");
  const [loadingScope, setLoadingScope] = useState(false);
  const [format, setFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [exporting, setExporting] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectPortalContainer, setSelectPortalContainer] = useState<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (kind !== "accounts") return;
    let active = true;
    void (async () => {
      const all: ClassRecord[] = [];
      const seen = new Set<string>();
      let nextPage = 1;
      while (active) {
        const result = await listClasses({ page: nextPage, pageSize: 100 });
        if (!active) return;
        for (const klass of result.classes) {
          if (seen.has(klass.id)) throw new Error("班级列表已变化，请关闭后重新打开导出窗口");
          seen.add(klass.id);
          all.push(klass);
        }
        if (nextPage >= (result.total_pages ?? 1)) break;
        nextPage += 1;
      }
      if (active) setClasses(all);
    })().catch((e) => { if (active) setClassError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (active) setLoadingClasses(false); });
    return () => { active = false; };
  }, [kind]);

  useEffect(() => {
    if (kind !== "analysis") return;
    let active = true;
    setLoadingPapers(true);
    setPaperError(null);
    setPaperId("");
    const timer = setTimeout(() => {
      void listPlatformPapers({ q: query.trim() || undefined, page, pageSize: 100 })
        .then((result) => {
          if (!active) return;
          setPapers(result.papers);
          setTotalPages(result.total_pages ?? 1);
        }).catch((e) => { if (active) setPaperError(String(e instanceof Error ? e.message : e)); })
        .finally(() => { if (active) setLoadingPapers(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, query, page]);

  useEffect(() => {
    if (kind !== "analysis") return;
    let active = true;
    setPublications([]);
    setPublicationId("");
    setScopePaperId("");
    setClassId("");
    setLoadingScope(!!paperId);
    if (paperId) {
      setPaperError(null);
      void getSchoolPaperExportOptions(paperId).then((result) => {
        if (!active) return;
        setPublications(result.publications);
        setScopePaperId(paperId);
        setPublicationId((result.publications.find((record) => record.status !== "revoked") ?? result.publications[0])?.id ?? "");
      }).catch((e) => { if (active) setPaperError(String(e instanceof Error ? e.message : e)); })
        .finally(() => { if (active) setLoadingScope(false); });
    }
    return () => { active = false; };
  }, [kind, paperId]);

  const selectedPublication = scopePaperId === paperId ? publications.find((record) => record.id === publicationId) : undefined;
  const classChoices = kind === "accounts" ? classes : selectedPublication?.classes ?? [];
  const validClass = !classId || classChoices.some((klass) => klass.id === classId);
  const validPaper = kind === "accounts" || papers.some((paper) => paper.paper_id === paperId);
  const disabled = exporting || loadingClasses || loadingPapers || loadingScope || !!classError || !!paperError || !validClass || !validPaper || (kind === "analysis" && !selectedPublication);
  async function runExport() {
    if (disabled) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = kind === "accounts"
        ? await exportStudentAccounts(classId || undefined)
        : await downloadPaperAnalysisReport(paperId, format, publicationId, classId || undefined);
      if (!mounted.current) return;
      const className = classChoices.find((klass) => klass.id === classId)?.name ?? "全部班级";
      const safeName = className.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      downloadBlob(blob, kind === "accounts" ? `学生账号_${safeName}.xlsx` : `成绩分析_${safeName}.${format}`);
      onClose();
    } catch (e) {
      if (mounted.current) setExportError(String(e instanceof Error ? e.message : e));
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  const title = kind === "accounts" ? "导出学生账号" : "导出成绩分析";
  const classField = <label className="block text-sm font-medium text-or-text">导出班级
    <Select portalContainer={selectPortalContainer} aria-label="导出班级" className="mt-2 w-full" value={classId} onValueChange={setClassId} disabled={loadingClasses || loadingScope || exporting || !!classError || (kind === "analysis" && !selectedPublication)}>
      <option value="">全部班级</option>
      {classChoices.map((klass) => <option key={klass.id} value={klass.id}>{[klass.grade, klass.name].filter(Boolean).join(" · ")}</option>)}
    </Select>
  </label>;
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !exporting) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="or-dialog-backdrop fixed inset-0 z-[101] bg-black/40 backdrop-blur-sm" />
      <div className="pointer-events-none fixed inset-0 z-[102] flex items-center justify-center p-3">
        <Dialog.Content ref={setSelectPortalContainer} aria-describedby={undefined} className="pointer-events-auto w-full max-w-lg outline-none">
          <div data-state="open" className="or-g53-dialog border border-or-outline p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold text-or-text">{title}</Dialog.Title>
            <Dialog.Close disabled={exporting} aria-label="关闭导出窗口" className="or-g53-icon-btn"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="space-y-4">
            {kind === "accounts" ? classField : null}
            {kind === "analysis" ? <>
              <label className="block text-sm font-medium text-or-text">查找试卷
                <input aria-label="查找导出试卷" className="or-g53-input mt-2 w-full px-3 py-2" value={query} disabled={exporting} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="输入试卷名称或学科" />
              </label>
              <label className="block text-sm font-medium text-or-text">导出试卷
                <Select portalContainer={selectPortalContainer} aria-label="导出试卷" className="mt-2 w-full" value={paperId} onValueChange={setPaperId} disabled={loadingPapers || exporting}>
                  <option value="">{loadingPapers ? "正在读取试卷…" : papers.length ? "请选择试卷" : "暂无匹配试卷"}</option>
                  {papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}{paper.subject ? ` · ${paper.subject}` : ""}</option>)}
                </Select>
              </label>
              {totalPages > 1 ? <div className="flex items-center justify-between gap-2 text-sm text-or-muted">
                <button type="button" disabled={page <= 1 || loadingPapers || exporting} onClick={() => setPage((p) => p - 1)} className="or-g53-btn-tonal px-3 py-1.5">上一页</button>
                <span>第 {page} / {totalPages} 页</span>
                <button type="button" disabled={page >= totalPages || loadingPapers || exporting} onClick={() => setPage((p) => p + 1)} className="or-g53-btn-tonal px-3 py-1.5">下一页</button>
              </div> : null}
              <label className="block text-sm font-medium text-or-text">发布记录
                <Select portalContainer={selectPortalContainer} aria-label="导出发布记录" className="mt-2 w-full" value={publicationId} onValueChange={(value) => { setPublicationId(value); setClassId(""); }} disabled={loadingScope || exporting || !paperId || !publications.length}>
                  {!publications.length ? <option value="">{loadingScope ? "正在读取发布记录…" : "暂无可导出的班级发布记录"}</option> : null}
                  {publications.map((record) => <option key={record.id} value={record.id}>{record.title} · {record.created_at}{record.status === "revoked" ? "（已撤回）" : ""}</option>)}
                </Select>
              </label>
              {classField}
              <label className="block text-sm font-medium text-or-text">导出格式
                <Select portalContainer={selectPortalContainer} aria-label="导出格式" className="mt-2 w-full" value={format} onValueChange={(value) => setFormat(value as "xlsx" | "pdf")} disabled={exporting}>
                  <option value="xlsx">Excel（.xlsx）</option><option value="pdf">PDF（.pdf）</option>
                </Select>
              </label>
            </> : null}
            {classError || paperError || exportError ? <p role="alert" className="text-sm text-or-on-error">{classError || paperError || exportError}</p> : null}
            <div className="flex justify-end gap-2 border-t border-or-outline pt-4">
              <Dialog.Close disabled={exporting} className="or-g53-btn-tonal px-4 py-2">取消</Dialog.Close>
              <button type="button" disabled={disabled} onClick={() => void runExport()} className="or-g53-btn-primary px-4 py-2 disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? "正在导出…" : "确认导出"}</button>
            </div>
          </div>
          </div>
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  </Dialog.Root>;
}
