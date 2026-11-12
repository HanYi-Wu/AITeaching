import { useCallback, useEffect, useState } from "react";
import { Send, Square } from "lucide-react";
import { isImeComposingKeyboardEvent } from "../../lib/ime";

export type AgentChatDraftPreset = { id: number; text: string };

export function AgentChatComposer({
  busy,
  disabled,
  hasAttachments,
  inputPlaceholder,
  sendLabel,
  stopLabel,
  draftPreset,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  hasAttachments: boolean;
  inputPlaceholder: string;
  sendLabel: string;
  stopLabel: string;
  draftPreset: AgentChatDraftPreset | null;
  onSend: (draft: string) => boolean;
  onStop: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (draftPreset) setDraft(draftPreset.text);
  }, [draftPreset?.id]);

  const send = useCallback(() => {
    if (disabled || busy || (!draft.trim() && !hasAttachments)) return;
    if (onSend(draft)) setDraft("");
  }, [busy, disabled, draft, hasAttachments, onSend]);

  return (
    <>
      <textarea
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposingKeyboardEvent(event)) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        rows={2}
        placeholder={inputPlaceholder}
        className="min-h-[46px] min-w-0 flex-1 resize-none rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 text-[16px] sm:text-[15px] text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus disabled:cursor-not-allowed disabled:bg-[var(--or-page)] disabled:text-[var(--or-muted)]"
      />

      {busy ? (
        <button
          type="button"
          title={stopLabel}
          aria-label={stopLabel}
          onClick={() => void onStop()}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] shadow-sm transition hover:bg-[var(--or-page)]"
        >
          <Square className="h-4 w-4 fill-current text-or-error" />
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || (!draft.trim() && !hasAttachments)}
          onClick={send}
          aria-label={sendLabel}
          title={sendLabel}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-or-primary text-or-on-primary shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-[var(--or-page)] disabled:text-[var(--or-muted)] disabled:opacity-100 disabled:shadow-none"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
