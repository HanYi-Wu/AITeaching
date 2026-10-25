import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { ComposeLocalDraftRecord } from "../../types/compose";

export function ComposeDraftRecoveryDialog({ record, busy, onRestore, onDiscard }: {
  record: ComposeLocalDraftRecord | null;
  busy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t, i18n } = useTranslation(["compose"]);
  if (!record) return null;
  const timestamp = Date.parse(record.updatedAt);
  return <Dialog.Root open onOpenChange={() => {}}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-900/40" />
      <Dialog.Content
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="fixed left-1/2 top-1/2 z-[91] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-5 shadow-xl"
      >
        <Dialog.Title className="font-semibold text-slate-900">{t("compose:draftRecoveryTitle")}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-slate-700">{t("compose:draftRecoveryChoiceRequired")}</Dialog.Description>
        <p className="mt-2 break-words text-sm">{record.paper.draftName || record.paper.exportLabel}</p>
        {Number.isFinite(timestamp) ? <p className="mt-1 text-xs text-slate-500">{t("compose:draftRecoverySavedAt", { time: new Date(timestamp).toLocaleString(i18n.resolvedLanguage) })}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={onDiscard} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{t("compose:discardLocalDraft")}</button>
          <button type="button" disabled={busy} onClick={onRestore} className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50">{t("compose:restoreLocalDraft")}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
