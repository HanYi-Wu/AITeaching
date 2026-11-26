import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiAgentMemoryIndexGet, apiAgentMemoryIndexPut,
  apiAgentMemoryTopicGet, apiAgentMemoryTopicList, apiAgentMemoryTopicPut,
} from "../../api/client";
import { Select as AppSelect } from "../ui/select";

export function AgentMemoryDrawer() {
  const [open, setOpen] = useState(false);
  return <section className="rounded-2xl border border-or-outline bg-or-card p-4 sm:p-6">
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">智能体主题与记忆</summary>
      {open && <MemoryEditor />}
    </details>
  </section>;
}

function MemoryEditor() {
  const { t } = useTranslation("agent");
  const [tab, setTab] = useState<"index" | "topic">("index");
  const [index, setIndex] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[] | null>(null);
  const [topic, setTopic] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await action(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setBusy(false); }
  }

  const loadIndex = () => run(async () => { setIndex((await apiAgentMemoryIndexGet()).content); });
  const loadTopics = () => run(async () => {
    const { topics: names } = await apiAgentMemoryTopicList();
    setTopics(names);
    setTopic(names[0] ?? "");
    setDraft(null);
  });
  return <div className="mt-4 space-y-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} aria-pressed={tab === "index"}
        className={tab === "index" ? "or-button or-button-primary" : "or-button or-button-outline"}
        onClick={() => { setTab("index"); setMessage(null); }}>{t("memoryIndex")}</button>
      <button type="button" disabled={busy} aria-pressed={tab === "topic"}
        className={tab === "topic" ? "or-button or-button-primary" : "or-button or-button-outline"}
        onClick={() => { setTab("topic"); setMessage(null); if (!topics) void loadTopics(); }}>{t("topicNotes")}</button>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-or-error" : "text-sm text-or-muted"}>{message.text}</p>}
    {tab === "index" && (index === null
      ? <button type="button" className="or-button or-button-outline" disabled={busy} onClick={() => void loadIndex()}>{t("load")}{t("memoryIndex")}</button>
      : <>
          <textarea aria-label={t("memoryIndex")} value={index} onChange={(e) => setIndex(e.target.value)}
            rows={6} disabled={busy} className="or-input w-full resize-y rounded-lg border border-or-outline p-3 font-mono text-sm" />
          <button type="button" className="or-button or-button-primary" disabled={busy} onClick={() => void run(async () => {
            await apiAgentMemoryIndexPut(index); setMessage({ text: t("indexSaved") });
          })}>{t("saveIndex")}</button>
        </>)}
    {tab === "topic" && <>
      {topics === null && <button type="button" className="or-button or-button-outline" disabled={busy} onClick={() => void loadTopics()}>{t("load")}{t("topicNotes")}</button>}
      {topics?.length === 0 && <p className="text-sm text-or-muted">暂无主题记录。</p>}
      {!!topics?.length && <div className="flex flex-wrap gap-2">
        <AppSelect aria-label={t("topicNotes")} value={topic} disabled={busy}
          onValueChange={(name) => { setTopic(name); setDraft(null); setMessage(null); }}>
          {topics.map((name) => <option key={name} value={name}>{name}</option>)}
        </AppSelect>
        <button type="button" className="or-button or-button-outline" disabled={busy || !topic}
          onClick={() => void run(async () => setDraft((await apiAgentMemoryTopicGet(topic)).content))}>{t("load")}</button>
      </div>}
      {draft !== null && <>
        <textarea aria-label={t("topicNotes")} value={draft} onChange={(e) => setDraft(e.target.value)} rows={6}
          disabled={busy} className="or-input w-full resize-y rounded-lg border border-or-outline p-3 font-mono text-sm" />
        <button type="button" className="or-button or-button-primary" disabled={busy || !topic} onClick={() => void run(async () => {
          await apiAgentMemoryTopicPut(topic, draft); setMessage({ text: t("topicSaved") });
        })}>{t("saveTopic")}</button>
      </>}
    </>}
  </div>;
}
