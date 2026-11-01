import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { FolderOpen, X } from "lucide-react";
import { apiPost, ensureApiBase } from "../api/client";
import { pickFolderCanceledMessage } from "../lib/pickFolder";
import { cn } from "../lib/utils";

type TemplateKind = "empty" | "math";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectReady: () => void;
  onError: (msg: string | null) => void;
};

export function NewProjectDialog({ open, onOpenChange, onProjectReady, onError }: Props) {
  const { t } = useTranslation(["welcome"]);
  const [parentPath, setParentPath] = useState("");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TemplateKind>("empty");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setParentPath("");
      setName(t("welcome:defaultNewProjectName"));
      setTemplate("empty");
      onError(null);
    }
  }, [open, onError, t]);

  const pickParent = async () => {
    onError(null);
    try {
      await ensureApiBase();
      const w = typeof window !== "undefined" ? window : undefined;
      const isTauri =
        w &&
        ("__TAURI_INTERNALS__" in w ||
          (w as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined);
      if (isTauri) {
        const { open: openDlg } = await import("@tauri-apps/plugin-dialog");
        const sel = await openDlg({
          directory: true,
          multiple: false,
          title: t("welcome:pickParentTitle"),
        });
        const path = Array.isArray(sel) ? sel[0] : sel;
        if (typeof path === "string" && path) {
          setParentPath(path);
        }
      } else {
        const res = await apiPost<{ ok: boolean; path: string }>("/api/project/pick-parent", {});
        setParentPath(res.path);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (pickFolderCanceledMessage(msg)) {
        onError(null);
      } else {
        onError(msg);
      }
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedParent = parentPath.trim();
    if (!trimmedParent) {
      onError(t("welcome:newProjectLocationRequired"));
      return;
    }
    if (!trimmedName) {
      onError(t("welcome:newProjectNameRequired"));
      return;
    }
    setSubmitting(true);
    onError(null);
    try {
      await ensureApiBase();
      await apiPost("/api/project/create", {
        parent: trimmedParent,
        name: trimmedName,
        template,
      });
      onOpenChange(false);
      onProjectReady();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="or-dialog-backdrop fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "or-dialog fixed left-1/2 top-1/2 z-[101] w-[min(100vw-2rem,30rem)] max-h-[min(90vh,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] sm:rounded-[24px] border border-[var(--or-outline)] bg-[var(--or-card)] p-5 sm:p-7 text-[var(--or-text)] shadow-2xl outline-none",
          )}
          onPointerDownOutside={(e) => {
            if (submitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (submitting) e.preventDefault();
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg sm:text-xl font-semibold leading-tight text-[var(--or-text)]">
              {t("welcome:newProjectDialogTitle")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={submitting}
                className="rounded-full p-1.5 text-[var(--or-muted)] transition hover:bg-[var(--or-block)] hover:text-[var(--or-text)] disabled:opacity-40"
                aria-label={t("welcome:newProjectDialogClose")}
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-5 text-sm text-[var(--or-muted)] leading-relaxed">
            {t("welcome:newProjectDialogIntro")}
          </Dialog.Description>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
                {t("welcome:newProjectLocationLabel")}
              </label>
              <div className="flex flex-wrap gap-2">
                <div className="min-h-[2.5rem] min-w-0 flex-1 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-block)] px-3.5 py-2 text-xs sm:text-[13px] text-[var(--or-text)] flex items-center">
                  {parentPath ? (
                    <span className="break-all">{parentPath}</span>
                  ) : (
                    <span className="text-[var(--or-muted)]">{t("welcome:newProjectLocationPlaceholder")}</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void pickParent()}
                  className="or-button or-button-outline inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] disabled:opacity-50"
                >
                  <FolderOpen className="h-4 w-4" />
                  {t("welcome:browseFolder")}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="new-project-name" className="mb-1.5 block text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
                {t("welcome:newProjectNameLabel")}
              </label>
              <input
                id="new-project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoComplete="off"
                className="or-input or-field w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-focus)] focus:outline-none disabled:opacity-50"
                placeholder={t("welcome:newProjectNamePlaceholder")}
              />
            </div>

            <fieldset>
              <legend className="mb-2 text-xs sm:text-[13px] font-medium text-[var(--or-muted)]">
                {t("welcome:templateLabel")}
              </legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setTemplate("empty")}
                  className={cn(
                    "rounded-[14px] border p-3.5 text-left text-sm transition-all duration-150",
                    template === "empty"
                      ? "border-[var(--or-primary)] bg-[var(--or-primary-container)]/30 text-[var(--or-text)] ring-1 ring-[var(--or-primary)]/50"
                      : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] hover:bg-[var(--or-block)]",
                  )}
                >
                  <span className="font-semibold text-[var(--or-text)]">{t("welcome:templateEmpty")}</span>
                  <span className="mt-1 block text-xs sm:text-[13px] text-[var(--or-muted)] leading-relaxed">
                    {t("welcome:templateEmptyDesc")}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setTemplate("math")}
                  className={cn(
                    "rounded-[14px] border p-3.5 text-left text-sm transition-all duration-150",
                    template === "math"
                      ? "border-[var(--or-primary)] bg-[var(--or-primary-container)]/30 text-[var(--or-text)] ring-1 ring-[var(--or-primary)]/50"
                      : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] hover:bg-[var(--or-block)]",
                  )}
                >
                  <span className="font-semibold text-[var(--or-text)]">{t("welcome:templateMath")}</span>
                  <span className="mt-1 block text-xs sm:text-[13px] text-[var(--or-muted)] leading-relaxed">
                    {t("welcome:templateMathDesc")}
                  </span>
                </button>
              </div>
            </fieldset>
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2.5 border-t border-[var(--or-outline)] pt-4">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={submitting}
                className="or-button or-button-outline max-sm:flex-1 rounded-[10px] px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("welcome:newProjectCancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className="or-button or-button-primary max-sm:flex-1 rounded-[10px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? t("welcome:newProjectCreating") : t("welcome:newProjectConfirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
