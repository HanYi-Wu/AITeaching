import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { apiPost } from "../api/client";

function isPickCanceledMessage(msg: string) {
  return (
    msg.includes("取消") ||
    msg.includes("未选择") ||
    /cancel(ed)?/i.test(msg) ||
    /user cancel/i.test(msg) ||
    /not select/i.test(msg)
  );
}

export function ProjectPanel({
  onDone,
  onError,
}: {
  onDone: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [root, setRoot] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("my_exam_project");
  const [busy, setBusy] = useState(false);

  async function openProject() {
    onError(null);
    setBusy(true);
    try {
      await apiPost("/api/project/open", { root: root.trim() });
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickOpenFolder() {
    onError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; root: string }>("/api/project/pick-open", {});
      setRoot(res.root);
      await onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPickCanceledMessage(msg)) {
        onError(null);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickParentFolder() {
    onError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; path: string }>("/api/project/pick-parent", {});
      setParent(res.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPickCanceledMessage(msg)) {
        onError(null);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    onError(null);
    setBusy(true);
    try {
      await apiPost("/api/project/create", { parent: parent.trim(), name: name.trim() });
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-4 sm:p-8 text-[var(--or-text)] shadow-sm">
      <h2 className="text-lg font-semibold text-[var(--or-text)]">{t("app:project.openTitle")}</h2>
      <p className="mt-1 text-sm text-[var(--or-muted)] leading-relaxed">
        {t("app:project.openIntroBefore")}
        <strong>{t("app:project.openIntroStrong")}</strong>
        {t("app:project.openIntroMid")}
        <code className="rounded bg-[var(--or-block)] px-1 py-0.5 font-mono text-xs">SOLAIRE_PROJECT_ROOT</code>
        {t("app:project.openIntroAnd")}
        <code className="rounded bg-[var(--or-block)] px-1 py-0.5 font-mono text-xs">SOLAIRE_BIND_PROJECT_FROM_ENV=1</code>
        {t("app:project.openIntroAfter")}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="or-button or-button-outline inline-flex items-center gap-2 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] shadow-sm hover:bg-[var(--or-block)] disabled:opacity-50"
          disabled={busy}
          onClick={() => void pickOpenFolder()}
        >
          <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("app:project.pickFolder")}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 w-full sm:min-w-[240px] sm:w-auto flex-1 flex-col gap-1.5 text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
          {t("app:project.rootLabel")}
          <input
            className="or-input or-field rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] shadow-sm focus:border-[var(--or-focus)] focus:outline-none"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={t("app:project.rootPlaceholder")}
          />
        </label>
        <button
          type="button"
          className="or-button or-button-primary rounded-[10px] px-4 py-2 text-sm font-semibold shadow disabled:opacity-50"
          disabled={busy || !root.trim()}
          onClick={() => void openProject()}
        >
          {t("app:project.openButton")}
        </button>
      </div>

      <div className="mt-8 border-t border-[var(--or-outline)] pt-6">
        <h2 className="text-lg font-semibold text-[var(--or-text)]">{t("app:project.newTitle")}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="or-button or-button-outline inline-flex items-center gap-2 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] shadow-sm hover:bg-[var(--or-block)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void pickParentFolder()}
          >
            <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {t("app:project.pickParent")}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 w-full sm:min-w-[200px] sm:w-auto flex-1 flex-col gap-1.5 text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
            {t("app:project.parentLabel")}
            <input
              className="or-input or-field rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm shadow-sm focus:border-[var(--or-focus)] focus:outline-none"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder={t("app:project.parentPlaceholder")}
            />
          </label>
          <label className="flex min-w-0 w-full sm:min-w-[160px] sm:w-auto flex-col gap-1.5 text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
            {t("app:project.folderName")}
            <input
              className="or-input or-field rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm shadow-sm focus:border-[var(--or-focus)] focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="or-button or-button-primary rounded-[10px] px-4 py-2 text-sm font-semibold shadow disabled:opacity-50"
            disabled={busy || !parent.trim() || !name.trim()}
            onClick={() => void createProject()}
          >
            {t("app:project.createButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
