import { useTranslation } from "react-i18next";
import {
  apiAgentMemoryIndexPut,
  apiAgentMemoryTopicGet,
  apiAgentMemoryTopicPut,
} from "../../api/client";
import "../../ui-redesign/g55/g55.css";
import { Select as AppSelect } from "../ui/select";

export interface AgentMemoryDrawerProps {
  isOpen: boolean;
  memoryTab: "index" | "topic";
  setMemoryTab: (t: "index" | "topic") => void;
  memoryMsg: string | null;
  setMemoryMsg: (m: string | null) => void;
  indexDraft: string;
  setIndexDraft: (s: string) => void;
  topicDraft: string;
  setTopicDraft: (s: string) => void;
  topicPick: string;
  setTopicPick: (s: string) => void;
  topicOptions: string[];
  memoryBusy: boolean;
}

export function AgentMemoryDrawer({
  isOpen,
  memoryTab,
  setMemoryTab,
  memoryMsg,
  setMemoryMsg,
  indexDraft,
  setIndexDraft,
  topicDraft,
  setTopicDraft,
  topicPick,
  setTopicPick,
  topicOptions,
  memoryBusy,
}: AgentMemoryDrawerProps) {
  const { t } = useTranslation("agent");

  if (!isOpen) return null;

  return (
    <div className="border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3 text-xs text-[var(--or-muted)]   ">
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          className={`or-g55-pill px-3 py-1 font-semibold transition ${
            memoryTab === "index"
              ? "bg-or-primary text-or-on-primary shadow-sm"
              : "bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-outline)_80%,transparent)]  "
          }`}
          onClick={() => setMemoryTab("index")}
        >
          {t("memoryIndex")}
        </button>
        <button
          type="button"
          className={`or-g55-pill px-3 py-1 font-semibold transition ${
            memoryTab === "topic"
              ? "bg-or-primary text-or-on-primary shadow-sm"
              : "bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-outline)_80%,transparent)]  "
          }`}
          onClick={() => setMemoryTab("topic")}
        >
          {t("topicNotes")}
        </button>
      </div>
      {memoryMsg && <p className="mb-2 text-xs font-medium text-or-error">{memoryMsg}</p>}
      {memoryTab === "index" && (
        <div className="space-y-2">
          <textarea
            value={indexDraft}
            onChange={(e) => setIndexDraft(e.target.value)}
            rows={5}
            disabled={memoryBusy}
            className="w-full resize-y rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 font-mono text-xs text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus   "
          />
          <button
            type="button"
            disabled={memoryBusy}
            onClick={() =>
              void apiAgentMemoryIndexPut(indexDraft).then(() =>
                setMemoryMsg(t("indexSaved")),
              )
            }
            className="inline-flex h-8 items-center justify-center rounded-lg bg-or-primary px-3.5 text-xs font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {t("saveIndex")}
          </button>
        </div>
      )}
      {memoryTab === "topic" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <AppSelect
              value={topicPick}
              onValueChange={(value) => setTopicPick(value)}
              className="h-8 max-w-[12rem] rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 text-xs text-[var(--or-text)] outline-none transition focus:border-or-focus   "
            >
              {topicOptions.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </AppSelect>
            <button
              type="button"
              disabled={memoryBusy || !topicPick}
              onClick={() =>
                void apiAgentMemoryTopicGet(topicPick).then((r) => {
                  setTopicDraft(r.content);
                  setMemoryMsg(null);
                })
              }
              className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 text-xs font-medium text-[var(--or-muted)] transition hover:bg-[var(--or-block)] disabled:opacity-50   "
            >
              {t("load")}
            </button>
          </div>
          <textarea
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            rows={5}
            placeholder={t("topicDraftPh")}
            className="w-full resize-y rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 font-mono text-xs text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus   "
          />
          <button
            type="button"
            disabled={memoryBusy || !topicPick}
            onClick={() =>
              void apiAgentMemoryTopicPut(topicPick, topicDraft).then(() =>
                setMemoryMsg(t("topicSaved")),
              )
            }
            className="inline-flex h-8 items-center justify-center rounded-lg bg-or-primary px-3.5 text-xs font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {t("saveTopic")}
          </button>
        </div>
      )}
    </div>
  );
}
