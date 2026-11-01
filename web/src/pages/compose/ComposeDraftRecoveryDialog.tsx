import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { ComposeLocalDraftRecord } from "../../types/compose";

export function ComposeDraftRecoveryDialog({
  record,
  busy,
  onRestore,
  onDiscard,
}: {
  record: ComposeLocalDraftRecord | null;
  busy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t, i18n } = useTranslation(["compose"]);
  if (!record) return null;
  const timestamp = Date.parse(record.updatedAt);
  return (
    <Dialog.Root open onOpenChange={() => {}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-950/40 backdrop-blur-[2px]" />
        <Dialog.Content
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="or-g49-dialog-surface fixed left-1/2 top-1/2 z-[91] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title className="text-lg font-semibold text-[var(--or-text)]">
            {t("compose:draftRecoveryTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-[var(--or-muted)]">
            {t("compose:draftRecoveryChoiceRequired")}
          </Dialog.Description>
          <div className="mt-3.5 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3">
            <p className="break-words text-sm font-semibold text-[var(--or-text)]">
              {record.paper.draftName || record.paper.exportLabel}
            </p>
            {Number.isFinite(timestamp) ? (
              <p className="mt-1 text-[13px] text-[var(--or-muted)]">
                {t("compose:draftRecoverySavedAt", {
                  time: new Date(timestamp).toLocaleString(i18n.resolvedLanguage),
                })}
              </p>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onDiscard}
              className="or-g49-btn or-g49-btn-secondary"
            >
              {t("compose:discardLocalDraft")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRestore}
              className="or-g49-btn bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {t("compose:restoreLocalDraft")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
