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
        aria-label={inputPlaceholder}
        className="or-agent-composer-input"
      />

      {busy ? (
        <button
          type="button"
          title={stopLabel}
          aria-label={stopLabel}
          onClick={() => void onStop()}
          className="or-agent-composer-action"
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
          className="or-agent-composer-action or-agent-composer-send"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
