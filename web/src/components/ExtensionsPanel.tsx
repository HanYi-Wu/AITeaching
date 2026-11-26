import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  apiSystemExtensionInstall,
  apiSystemExtensionManualPathDelete,
  apiSystemExtensionManualPathPut,
  apiSystemExtensions,
  ensureApiBase,
  type SystemExtensionStatus,
} from "../api/client";
import { pickHostPath } from "../lib/pickExtensionPath";
import { openExternalUrl } from "../lib/openExternalUrl";
import { confirmDialog } from "../lib/confirmDialog";
import { cn } from "../lib/utils";
import { Pill } from "../design-system/Pill";

function extensionDisplayReady(ext: SystemExtensionStatus): boolean {
  if (ext.id === "tesseract") {
    return ext.ocr_ready === true;
  }
  return ext.ready;
}

function hasNativePathPicker(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined
  );
}

function ExtensionCard({
  ext,
  onInstallClick,
  onCopyCommand,
  onPickPath,
  onClearManual,
  installBusyId,
  pathBusyId,
  recheckBusy,
  nativePathPickerAvailable,
  hostControlAllowed,
  manualPathValues,
  onManualPathChange,
  onSaveManualPath,
}: {
  ext: SystemExtensionStatus;
  onInstallClick: (id: string) => void;
  onCopyCommand: (command: string) => void;
  onPickPath: (id: string, locationKind: "dir" | "file") => void;
  onClearManual: (id: string) => void;
  installBusyId: string | null;
  pathBusyId: string | null;
  recheckBusy: boolean;
  nativePathPickerAvailable: boolean;
  hostControlAllowed: boolean;
  manualPathValues: Record<"dir" | "file", string>;
  onManualPathChange: (kind: "dir" | "file", value: string) => void;
  onSaveManualPath: (id: string, kind: "dir" | "file", path: string) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const ready = extensionDisplayReady(ext);
  const installBusy = installBusyId === ext.id;
  const pathBusy = pathBusyId === ext.id;

  const showOcrPartial =
    ext.id === "tesseract" && ext.ready === true && ext.ocr_ready === false;

  return (
    <div
      className={cn(
        "or-surface rounded-[16px] border p-4 sm:p-5 shadow-sm transition-colors",
        ready
          ? "border-[var(--or-success)] bg-[color-mix(in_srgb,var(--or-success-container)_40%,transparent)] dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-[var(--or-outline)] bg-[var(--or-card)]",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          className={cn(
            "flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-[12px]",
            ready
              ? "bg-[var(--or-success-container)] text-[var(--or-on-success)] dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-[var(--or-block)] text-[var(--or-muted)]",
          )}
        >
          <Package className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-base font-semibold text-[var(--or-text)]">{ext.name}</h3>
            {ready ? (
              <Pill variant="success" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                {t("ext.ready")}
              </Pill>
            ) : (
              <Pill variant="warning" size="sm" icon={<AlertCircle className="h-3.5 w-3.5" />}>
                {t("ext.notInstalled")}
              </Pill>
            )}
          </div>
          <p className="mt-1.5 text-sm text-[var(--or-muted)] leading-relaxed">{ext.description}</p>
          {showOcrPartial ? (
            <p className="mt-2 text-xs sm:text-sm text-[var(--or-on-warning)] dark:text-amber-300">{t("ext.ocrPartial")}</p>
          ) : null}
          {ext.install_hint && !ready && ext.id === "mmdr" ? (
            <p className="mt-2 text-xs sm:text-sm text-[var(--or-muted)]">{ext.install_hint}</p>
          ) : null}
          <ul className="mt-2.5 space-y-1.5 text-xs sm:text-sm text-[var(--or-muted)]">
            {ext.executables.map((e) => (
              <li key={e.name} className="break-all">
                <span className="font-medium text-[var(--or-text)]">{e.name}</span>
                {e.on_path ? (
                  <>
                    {" · "}
                    {t("ext.version")}: {e.version ?? "—"}
                    {e.path ? (
                      <>
                        {" · "}
                        {t("ext.path")}: {e.path}
                      </>
                    ) : null}
                    {e.resolved_from === "manual" ? (
                      <span className="ml-1.5 rounded-md bg-[var(--or-primary-container)] px-1.5 py-0.5 text-xs font-medium text-[var(--or-on-container)]">
                        {t("ext.fromPage")}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <> — {t("ext.missingExe")}</>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--or-outline)] pt-3.5 pl-0 sm:gap-2.5 sm:pl-[60px]">
        <button
          type="button"
          onClick={() => void openExternalUrl(ext.download_url)}
          className="or-button or-button-outline inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("ext.manualDownload")}
        </button>
        {hostControlAllowed && ext.can_auto_install ? (
          <button
            type="button"
            disabled={installBusy || pathBusy || recheckBusy}
            onClick={() => onInstallClick(ext.id)}
            className="or-button or-button-primary inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs sm:text-sm font-medium disabled:opacity-50"
          >
            {installBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {installBusy ? t("ext.installing") : t("ext.startInstall")}
          </button>
        ) : null}
        {ext.install_mode === "command" && ext.install_command ? (
          <button
            type="button"
            disabled={pathBusy || recheckBusy}
            onClick={() => onCopyCommand(ext.install_command as string)}
            className="or-button or-button-tonal inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs sm:text-sm font-medium disabled:opacity-50"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {t("ext.copyInstallCommand")}
          </button>
        ) : null}
        {hostControlAllowed && (nativePathPickerAvailable ? ext.id === "latex" ? (
          <>
            <button
              type="button"
              disabled={pathBusy || recheckBusy}
              onClick={() => void onPickPath(ext.id, "dir")}
              className="or-button or-button-outline inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
            >
              {pathBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {t("ext.chooseInstallDir")}
            </button>
            <button
              type="button"
              disabled={pathBusy || recheckBusy}
              onClick={() => void onPickPath(ext.id, "file")}
              className="or-button or-button-outline inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
            >
              {pathBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <File className="h-3.5 w-3.5" />}
              {t("ext.chooseProgramFile")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={pathBusy || recheckBusy}
              onClick={() => void onPickPath(ext.id, "file")}
              className="or-button or-button-outline inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
            >
              {pathBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <File className="h-3.5 w-3.5" />}
              {t("ext.chooseProgramFile")}
            </button>
            <button
              type="button"
              disabled={pathBusy || recheckBusy}
              onClick={() => void onPickPath(ext.id, "dir")}
              className="or-button or-button-outline inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
            >
              {pathBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {t("ext.searchInFolder")}
            </button>
          </>
        ) : (
          <div className="grid w-full gap-2 sm:grid-cols-2">
            {(["file", "dir"] as const).map((kind) => (
              <form
                key={kind}
                className="min-w-0 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveManualPath(ext.id, kind, manualPathValues[kind]);
                }}
              >
                <label
                  htmlFor={`extension-path-${ext.id}-${kind}`}
                  className="block min-w-0 text-xs font-medium text-[var(--or-muted)]"
                >
                  {kind === "dir" ? t("ext.chooseInstallDir") : t("ext.chooseProgramFile")}
                </label>
                <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input
                    id={`extension-path-${ext.id}-${kind}`}
                    aria-label={`${ext.name} ${kind === "dir" ? t("ext.chooseInstallDir") : t("ext.chooseProgramFile")}`}
                    value={manualPathValues[kind]}
                    onChange={(event) => onManualPathChange(kind, event.target.value)}
                    placeholder={kind === "dir" ? t("ext.serverDirectoryPlaceholder") : t("ext.serverFilePlaceholder")}
                    className="or-g49-input min-w-0 flex-1 px-3 py-2 text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    disabled={pathBusy || recheckBusy || !manualPathValues[kind].trim()}
                    className="or-button or-button-outline inline-flex shrink-0 items-center justify-center rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-xs font-semibold text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
                  >
                    {pathBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("ext.saveServerPath")}
                  </button>
                </div>
              </form>
            ))}
          </div>
        ))}
        {hostControlAllowed && ext.has_manual_paths ? (
          <button
            type="button"
            disabled={pathBusy || recheckBusy}
            onClick={() => void onClearManual(ext.id)}
            className="or-button inline-flex max-sm:flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--or-error)] bg-[var(--or-error-container)] dark:border-rose-900/40 dark:bg-rose-950/30 px-3 py-1.5 text-xs sm:text-sm font-medium text-[var(--or-on-error)] dark:text-rose-300 hover:bg-[var(--or-error-container)] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("ext.clearSavedPath")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  onError: (msg: string | null) => void;
};

export function ExtensionsPanel({ onError }: Props) {
  const { t } = useTranslation(["settings", "common"]);
  const [extensions, setExtensions] = useState<SystemExtensionStatus[] | null>(null);
  const [hostControlAllowed, setHostControlAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [installBusyId, setInstallBusyId] = useState<string | null>(null);
  const [pathBusyId, setPathBusyId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installPhase, setInstallPhase] = useState<"loading" | "done">("loading");
  const [installTitle, setInstallTitle] = useState("");
  const [installDetail, setInstallDetail] = useState("");
  const [installOk, setInstallOk] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [manualPathDrafts, setManualPathDrafts] = useState<Record<string, string>>({});
  const nativePathPickerAvailable = hasNativePathPicker();
  const windowsInstallerMissing = Boolean(
    extensions?.some((extension) => extension.platform === "win32" && extension.winget_on_path === false),
  );

  const load = useCallback(async () => {
    onError(null);
    try {
      await ensureApiBase();
      const data = await apiSystemExtensions();
      setExtensions(data.extensions);
      setHostControlAllowed(data.host_control_allowed !== false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setExtensions(null);
      setHostControlAllowed(false);
    }
  }, [onError]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const handleRecheck = async () => {
    setRecheckBusy(true);
    onError(null);
    try {
      await ensureApiBase();
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecheckBusy(false);
    }
  };

  const handlePickPath = async (extId: string, locationKind: "dir" | "file") => {
    setPathBusyId(extId);
    setPathError(null);
    onError(null);
    try {
      const picked = await pickHostPath(locationKind, {
        dir: t("ext.pickDirTitle"),
        file: t("ext.pickFileTitle"),
      });
      if (!picked) {
        return;
      }
      await ensureApiBase();
      const r = await apiSystemExtensionManualPathPut(extId, {
        path: picked,
        location_kind: locationKind,
      });
      setExtensions(r.extensions);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPathError(message);
      onError(message);
    } finally {
      setPathBusyId(null);
    }
  };

  const handleSaveManualPath = async (extId: string, locationKind: "dir" | "file", path: string) => {
    const cleanPath = path.trim();
    if (!cleanPath) return;
    setPathBusyId(extId);
    setPathError(null);
    onError(null);
    try {
      await ensureApiBase();
      const response = await apiSystemExtensionManualPathPut(extId, {
        path: cleanPath,
        location_kind: locationKind,
      });
      setExtensions(response.extensions);
      setManualPathDrafts((current) => ({ ...current, [`${extId}:${locationKind}`]: "" }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPathError(message);
      onError(message);
    } finally {
      setPathBusyId(null);
    }
  };

  const handleClearManual = async (extId: string) => {
    setPathBusyId(extId);
    onError(null);
    try {
      await ensureApiBase();
      const r = await apiSystemExtensionManualPathDelete(extId);
      setExtensions(r.extensions);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPathBusyId(null);
    }
  };

  const runInstall = async (extId: string) => {
    setInstallOpen(true);
    setInstallPhase("loading");
    setInstallTitle(t("ext.installDialogTitle"));
    setInstallDetail(t("ext.installDialogProgress"));
    setInstallOk(false);
    setInstallBusyId(extId);
    onError(null);
    try {
      await ensureApiBase();
      const r = await apiSystemExtensionInstall(extId);
      setInstallPhase("done");
      setInstallOk(r.ok);
      setInstallDetail(r.message);
      if (!r.ok) {
        onError(r.message);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setInstallPhase("done");
      setInstallOk(false);
      setInstallDetail(t("ext.installFailed", { message: m }));
      onError(m);
    } finally {
      setInstallBusyId(null);
    }
  };

  const handleInstallClick = async (extId: string) => {
    const extension = extensions?.find((item) => item.id === extId);
    if (
      extension?.requires_confirmation &&
      !(await confirmDialog(t("ext.confirmSystemInstall", { name: extension.name }), t("ext.installDialogTitle")))
    ) {
      return;
    }
    await runInstall(extId);
  };

  const handleCopyCommand = async (command: string) => {
    setCopyNotice(null);
    onError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = command;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand("copy")) throw new Error(t("ext.copyFailed"));
        textarea.remove();
      }
      setCopyNotice(t("ext.commandCopied"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && !extensions) {
    return (
      <div className="flex items-center justify-center gap-2.5 p-8 text-[var(--or-muted)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--or-primary)]" />
        <span className="text-sm">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={recheckBusy}
          onClick={() => void handleRecheck()}
          className="or-button or-button-outline inline-flex w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
        >
          {recheckBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("ext.recheck")}
        </button>
      </div>
      {windowsInstallerMissing ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--or-warning)] bg-[var(--or-warning-container)] dark:border-amber-900/40 dark:bg-amber-950/20 p-4 text-sm text-[var(--or-on-warning)] dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{t("ext.windowsInstallerMissingTitle")}</p>
            <p className="mt-1 text-xs sm:text-[13px] leading-5 text-[var(--or-on-warning)] dark:text-amber-300">{t("ext.windowsInstallerMissingHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => void openExternalUrl("https://apps.microsoft.com/detail/9nblggh4nns1")}
            className="or-button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-amber-300 bg-[var(--or-card)] dark:bg-amber-900/40 px-3.5 py-2 text-xs sm:text-sm font-semibold text-[var(--or-on-warning)] dark:text-amber-200 hover:bg-[var(--or-warning-container)]"
          >
            <Download className="h-3.5 w-3.5" />
            {t("ext.getWindowsInstaller")}
          </button>
        </div>
      ) : null}
      {copyNotice ? (
        <p role="status" className="rounded-[12px] border border-[var(--or-success)] bg-[var(--or-success-container)] dark:border-emerald-900/40 dark:bg-emerald-950/30 p-3 text-sm text-[var(--or-on-success)] dark:text-emerald-300">
          {copyNotice}
        </p>
      ) : null}
      {pathError ? (
        <p role="alert" className="rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] px-3.5 py-3 text-sm leading-relaxed text-[var(--or-on-error)]">
          {pathError}
        </p>
      ) : null}

      {extensions && !hostControlAllowed && <p role="status" className="text-sm text-or-muted">远程会话可检查扩展或复制安装命令；安装与修改路径请在服务器本机完成。</p>}
      <div className="space-y-4">
        {(extensions ?? []).map((ext) => (
          <ExtensionCard
            key={ext.id}
            ext={ext}
            onInstallClick={handleInstallClick}
            onCopyCommand={(command) => void handleCopyCommand(command)}
            onPickPath={handlePickPath}
            onClearManual={handleClearManual}
            installBusyId={installBusyId}
            pathBusyId={pathBusyId}
            recheckBusy={recheckBusy}
            nativePathPickerAvailable={nativePathPickerAvailable}
            hostControlAllowed={hostControlAllowed}
            manualPathValues={{
              dir: manualPathDrafts[`${ext.id}:dir`] ?? "",
              file: manualPathDrafts[`${ext.id}:file`] ?? "",
            }}
            onManualPathChange={(kind, value) => setManualPathDrafts((current) => ({
              ...current,
              [`${ext.id}:${kind}`]: value,
            }))}
            onSaveManualPath={handleSaveManualPath}
          />
        ))}
      </div>

      <Dialog.Root
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open && installOk) {
            void handleRecheck();
          }
          if (!open) {
            setInstallPhase("loading");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="or-dialog-backdrop fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="or-dialog fixed left-1/2 top-1/2 z-[101] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-[var(--or-outline)] bg-[var(--or-card)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <Dialog.Title className="text-base font-semibold text-[var(--or-text)]">{installTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] transition-colors"
                  aria-label={t("close", { ns: "common" })}
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-3.5 text-sm text-[var(--or-muted)]">
              {installPhase === "loading" ? (
                <span className="flex items-center gap-2.5">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--or-primary)]" />
                  <span>{installDetail}</span>
                </span>
              ) : (
                <span className={installOk ? "text-[var(--or-on-success)] dark:text-[var(--or-on-success)]" : "text-[var(--or-on-warning)] dark:text-[var(--or-on-warning)]"}>
                  {installDetail}
                </span>
              )}
            </Dialog.Description>
            {installPhase === "done" ? (
              <div className="mt-5 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="or-button or-button-primary rounded-[10px] px-4 py-2 text-sm font-semibold"
                  >
                    {t("ext.installDialogClose")}
                  </button>
                </Dialog.Close>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
