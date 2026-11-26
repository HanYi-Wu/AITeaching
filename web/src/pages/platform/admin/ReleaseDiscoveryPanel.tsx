import { useEffect, useState } from "react";
import { platformRequest } from "../../../platform/platformRequest";
import { confirmDialog } from "../../../lib/confirmDialog";

type Status = {
  status: "pending" | "disabled" | "unreachable" | "available" | "current";
  installed: string;
  latest: string | null;
  checked_at: string | null;
  online_package_available?: boolean;
};

type Receipt = { package_id: string; version: string; base: string; file_count?: number; source?: "github";
  state: "verified" | "scheduled" | "preflighting" | "preflight_passed" | "preflight_failed" | "frontend_applied"
    | "rollback_requested" | "frontend_rolled_back" | "rollback_failed" | "backend_applied" | "backend_rolled_back"
    | "download_queued" | "downloading" | "download_failed" | "waiting_for_drain";
  run_at?: string; changed_count?: number; backend_changed?: boolean; schema_unchanged?: boolean;
  schema_before?: number; schema_after?: number; frontend_changed?: boolean; switch_seconds?: number };
type Inbox = { enabled: boolean; pending: Receipt | null };

const labels: Record<Status["status"], string> = {
  pending: "等待后台检查",
  disabled: "已关闭自动检查",
  unreachable: "无法检查更新，下次将自动重试",
  available: "有新版本可用",
  current: "当前已是最新正式版",
};

export function ReleaseDiscoveryPanel() {
  const [result, setResult] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => void platformRequest<Status>("/api/admin/system/updates", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { setResult(value); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    read();
    const readInbox = () => void platformRequest<Inbox>("/api/admin/system/update-package", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setInbox(value); }).catch(() => {});
    readInbox();
    const timer = window.setInterval(() => { read(); readInbox(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  async function upload() {
    if (!packageFile || uploading || !inbox?.enabled || inbox.pending) return;
    setUploadError("");
    setUploading(true);
    try {
      const pending = await platformRequest<Receipt>("/api/admin/system/update-package", {
        method: "POST", headers: { "Content-Type": "application/zip" }, body: packageFile,
      });
      setInbox({ enabled: true, pending });
      setPackageFile(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function schedule(when: string | null) {
    if (scheduling || !inbox?.enabled) return;
    const local = inbox.pending?.state === "verified" ? inbox.pending : null;
    const online = !inbox.pending && result?.online_package_available && result.latest ? result.latest : null;
    if (!local && !online) return;
    setUploadError("");
    setScheduling(true);
    try {
      const pending = await platformRequest<Receipt>(`/api/admin/system/update-package/${local ? "schedule" : "github"}`, {
        method: "POST", body: JSON.stringify({ ...(local ? { package_id: local.package_id } : { version: online }),
          run_at: when ? new Date(when).toISOString() : null }),
      });
      setInbox({ enabled: true, pending });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "预约失败");
    } finally {
      setScheduling(false);
    }
  }

  async function discard() {
    if (!inbox?.pending || scheduling) return;
    setUploadError("");
    setScheduling(true);
    try {
      if (!await confirmDialog("结束这条任务并清理暂存包？已安装版本不会改变；本任务的回滚入口会关闭。", "结束更新任务")) return;
      await platformRequest(`/api/admin/system/update-package/${encodeURIComponent(inbox.pending.package_id)}`, { method: "DELETE" });
      setInbox({ enabled: inbox.enabled, pending: null });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "移除失败");
    } finally { setScheduling(false); }
  }

  async function rollback() {
    if (scheduling || !inbox?.pending || !["frontend_applied", "backend_applied"].includes(inbox.pending.state)) return;
    setScheduling(true);
    setUploadError("");
    try {
      const message = inbox.pending.state === "frontend_applied" ? "恢复到更新前的前端版本？后端不重启。"
        : "将新请求切回更新前的版本？旧后端必须仍在运行且通过健康检查。";
      if (!await confirmDialog(message, "回滚版本")) return;
      const pending = await platformRequest<Receipt>("/api/admin/system/update-package/rollback", {
        method: "POST", body: JSON.stringify({ package_id: inbox.pending.package_id }),
      });
      setInbox({ enabled: inbox.enabled, pending });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "回滚申请失败");
    } finally {
      setScheduling(false);
    }
  }

  return <section aria-labelledby="admin-update-title" className="mb-4 rounded-xl border p-4">
    <h2 id="admin-update-title" className="font-semibold">版本更新</h2>
    <p role="status" className="mt-1 text-sm">{failed ? "无法读取后台检查状态" : result ? labels[result.status] : "正在读取检查状态…"}</p>
    {result && <p className="mt-1 text-sm">已安装 {result.installed}{result.latest ? ` · 最近发现 ${result.latest}` : ""}{result.checked_at ? ` · 检查时间 ${new Date(result.checked_at).toLocaleString()}` : ""}</p>}
    {result?.status === "available" && !result.online_package_available && <p className="mt-1 text-xs text-or-muted">此 Release 没有可识别的 ZIP，可手动上传签名包。</p>}
    {inbox?.pending ? <div className="mt-3 text-sm">
      <p role="status">{inbox.pending.source === "github" ? `GitHub 更新 ${inbox.pending.version}` : `更新包 ${inbox.pending.version} 已验签（${inbox.pending.file_count} 个文件）。`}</p>
      {inbox.pending.state === "download_queued" && <p className="mt-2" role="status">等待后台下载：{inbox.pending.run_at ? new Date(inbox.pending.run_at).toLocaleString() : "立即"}。</p>}
      {inbox.pending.state === "downloading" && <p className="mt-2" role="status">正在下载，完成后才会验签。</p>}
      {inbox.pending.state === "waiting_for_drain" && <p className="mt-2" role="status">旧实例尚未安全排空，更新器将在稍后重查，不会强行停止现有请求。</p>}
      {inbox.pending.state === "download_failed" && <p className="mt-2" role="alert">下载未完成，任务已停止。可移除任务后手动上传更新包。</p>}
      {inbox.pending.state === "scheduled" && <p className="mt-2" role="status">已排队：{inbox.pending.run_at ? new Date(inbox.pending.run_at).toLocaleString() : "立即"}。等待独立更新服务。</p>}
      {inbox.pending.state === "preflighting" && <p className="mt-2" role="status">正在隔离验证候选版本，当前服务仍在运行。</p>}
      {inbox.pending.state === "preflight_passed" && <p className="mt-2" role="status">候选检查通过（{inbox.pending.changed_count} 个变更），尚未切换生产版本。</p>}
      {inbox.pending.state === "preflight_passed" && inbox.pending.backend_changed && <p className="mt-1">
        {inbox.pending.schema_unchanged === undefined ? "尚未使用数据库副本试跑。" : inbox.pending.schema_unchanged
          ? `数据库副本试跑通过（结构版本 ${inbox.pending.schema_after} 未变）。`
          : `数据库副本试跑通过（版本 ${inbox.pending.schema_before} → ${inbox.pending.schema_after}，结构有变更），需要维护窗口。`}
      </p>}
      {inbox.pending.state === "preflight_failed" && <p className="mt-2" role="alert">候选检查未通过，未修改生产版本。</p>}
      {inbox.pending.state === "backend_applied" && <p className="mt-2" role="status">{inbox.pending.frontend_changed ? "前后端已同步切换" : "后端已切流"}，旧实例仍可完成已有请求。
        {inbox.pending.switch_seconds != null ? ` 网关切换及核验用时 ${inbox.pending.switch_seconds} 秒。` : ""}</p>}
      {inbox.pending.state === "backend_applied" && <button type="button" className="or-g53-btn-tonal mt-2 px-3 py-2" disabled={scheduling} onClick={() => void rollback()}>回滚版本</button>}
      {inbox.pending.state === "preflight_passed" && inbox.pending.backend_changed && inbox.pending.frontend_changed &&
        <p className="mt-1">前后端一并切换需要共享发布目录和兼容性检查通过。</p>}
      {inbox.pending.state === "frontend_applied" && <div className="mt-2 flex flex-wrap items-center gap-2">
        <p role="status">前端已切换，后端没有重启。</p>
        <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={scheduling} onClick={() => void rollback()}>回滚前端</button>
      </div>}
      {inbox.pending.state === "rollback_requested" && <p className="mt-2" role="status">已提交回滚请求，等待独立更新服务。</p>}
      {inbox.pending.state === "frontend_rolled_back" && <p className="mt-2" role="status">已恢复更新前的前端版本。</p>}
      {inbox.pending.state === "backend_rolled_back" && <p className="mt-2" role="status">已恢复更新前的路由和版本。</p>}
      {inbox.pending.state === "rollback_failed" && <p className="mt-2" role="alert">未能回滚，请检查更新服务日志。</p>}
      {["download_failed", "preflight_failed", "frontend_rolled_back", "frontend_applied", "backend_applied", "backend_rolled_back", "rollback_failed"].includes(inbox.pending.state) &&
        <button type="button" className="or-g53-btn-tonal mt-2 px-3 py-2" disabled={scheduling} onClick={() => void discard()}>结束任务</button>}
      {inbox.pending.state === "verified" && <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={scheduling} onClick={() => void schedule(null)}>立即排队</button>
          <input type="datetime-local" aria-label="预约更新时间（本地时间）" value={scheduleTime} disabled={scheduling}
            onChange={(event) => setScheduleTime(event.target.value)} />
          <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={!scheduleTime || scheduling} onClick={() => void schedule(scheduleTime)}>预约更新</button>
        </div>}
    </div>
      : inbox?.enabled ? <><div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="file" aria-label="签名 ZIP 更新包" accept=".zip,application/zip" disabled={uploading}
          onChange={(event) => setPackageFile(event.target.files?.[0] ?? null)} />
        <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={!packageFile || uploading} onClick={() => void upload()}>
          {uploading ? "正在上传并验签…" : "上传并验签"}
        </button>
      </div>
      {result?.online_package_available && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={scheduling || uploading} onClick={() => void schedule(null)}>立即下载并排队</button>
        <input type="datetime-local" aria-label="预约 GitHub 更新时间（本地时间）" value={scheduleTime}
          disabled={scheduling || uploading} onChange={(event) => setScheduleTime(event.target.value)} />
        <button type="button" className="or-g53-btn-tonal px-3 py-2" disabled={!scheduleTime || scheduling || uploading} onClick={() => void schedule(scheduleTime)}>预约 GitHub 更新</button>
      </div>}</> : inbox && <p className="mt-3 text-sm">安装受信任的更新签名公钥后，可上传 ZIP 更新包。</p>}
    {uploadError && <p role="alert" className="mt-2 text-sm">{uploadError}</p>}
  </section>;
}
