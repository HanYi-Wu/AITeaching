import { useTranslation } from "react-i18next";
import {
  apiAgentMemoryIndexPut,
  apiAgentMemoryTopicGet,
  apiAgentMemoryTopicPut,
} from "../../api/client";

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
    <div className="border-b border-slate-100 px-2 py-2 text-[11px] text-slate-700">
      <div className="mb-1 flex gap-1">
        <button
          type="button"
          className={`rounded px-2 py-0.5 ${
            memoryTab === "index" ? "bg-violet-100 text-violet-900" : "bg-slate-100"
          }`}
          onClick={() => setMemoryTab("index")}
        >
          {t("memoryIndex")}
        </button>
        <button
          type="button"
          className={`rounded px-2 py-0.5 ${
            memoryTab === "topic" ? "bg-violet-100 text-violet-900" : "bg-slate-100"
          }`}
          onClick={() => setMemoryTab("topic")}
        >
          {t("topicNotes")}
        </button>
      </div>
      {memoryMsg && <p className="mb-1 text-red-600">{memoryMsg}</p>}
      {memoryTab === "index" && (
        <div className="space-y-1">
          <textarea
            value={indexDraft}
            onChange={(e) => setIndexDraft(e.target.value)}
            rows={5}
            disabled={memoryBusy}
            className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[10px]"
          />
          <button
            type="button"
            disabled={memoryBusy}
            onClick={() =>
              void apiAgentMemoryIndexPut(indexDraft).then(() =>
                setMemoryMsg(t("indexSaved")),
              )
            }
            className="rounded bg-violet-600 px-2 py-0.5 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {t("saveIndex")}
          </button>
        </div>
      )}
      {memoryTab === "topic" && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            <select
              value={topicPick}
              onChange={(e) => setTopicPick(e.target.value)}
              className="max-w-[10rem] rounded border border-slate-200 px-1 py-0.5 text-[10px]"
            >
              {topicOptions.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={memoryBusy || !topicPick}
              onClick={() =>
                void apiAgentMemoryTopicGet(topicPick).then((r) => {
                  setTopicDraft(r.content);
                  setMemoryMsg(null);
                })
              }
              className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
            >
              {t("load")}
            </button>
          </div>
          <textarea
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            rows={5}
            placeholder={t("topicDraftPh")}
            className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[10px]"
          />
          <button
            type="button"
            disabled={memoryBusy || !topicPick}
            onClick={() =>
              void apiAgentMemoryTopicPut(topicPick, topicDraft).then(() =>
                setMemoryMsg(t("topicSaved")),
              )
            }
            className="rounded bg-violet-600 px-2 py-0.5 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {t("saveTopic")}
          </button>
        </div>
      )}
    </div>
  );
}
