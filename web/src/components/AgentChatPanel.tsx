import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  BookMarked,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  apiAgentConfig,
  apiAgentCreateSession,
  apiAgentMemoryIndexGet,
  apiAgentMemoryTopicList,
  apiAgentSessionDelete,
  apiAgentSessionsList,
  apiAgentSkillsList,
  apiPostFormData,
  type AgentConfig,
  type AgentSessionListItem,
  type AgentSkillInfo,
  type apiAgentChatStream,
} from "../api/client";
import { useAgentContext } from "../contexts/AgentContext";
import { confirmDialog } from "../lib/confirmDialog";
import { isImeComposingKeyboardEvent } from "../lib/ime";
import i18n from "../i18n/i18n";
import {
  AGENT_UPLOAD_ACCEPT,
  agentSendMessage,
  createAgentSubmissionGate,
  formatUploadFailure,
  isFileDrag,
  shouldDispatchAgentMessage,
} from "./agentUpload";
import {
  ASSISTANT_PROSE_CLASS,
  AgentAttachmentList,
  AgentContextRing,
  AgentMemoryDrawer,
  AgentMessageItem,
  AgentSessionHistoryMenu,
  useAgentChatStream,
  type ChatLine,
  type FileAttachment,
} from "./agent-chat";

export { ASSISTANT_PROSE_CLASS };

export function AgentChatPanel({
  projectBound = false,
  onRequestCollapse,
}: {
  projectBound?: boolean;
  onRequestCollapse?: () => void;
} = {}) {
  const { t } = useTranslation("agent");
  const { pageContext, sidebarOpen, prefillRequest, notifyAgentBackground } = useAgentContext();

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [input, setInput] = useState("");
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<AgentSessionListItem[]>([]);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDragActive, setFileDragActive] = useState(false);

  // Memory state
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryTab, setMemoryTab] = useState<"index" | "topic">("index");
  const [indexDraft, setIndexDraft] = useState("");
  const [topicDraft, setTopicDraft] = useState("");
  const [topicPick, setTopicPick] = useState("");
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryMsg, setMemoryMsg] = useState<string | null>(null);

  const assistantEnabled = config?.llm_configured !== false;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const sendGateRef = useRef<ReturnType<typeof createAgentSubmissionGate> | null>(null);
  if (sendGateRef.current === null) sendGateRef.current = createAgentSubmissionGate();

  // Scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const historyShellRef = useRef<HTMLDivElement>(null);
  const fallbackLineKeysRef = useRef(new WeakMap<ChatLine, string>());
  const fallbackLineSerialRef = useRef(0);

  const refreshSessionList = useCallback(async () => {
    try {
      const { sessions } = await apiAgentSessionsList();
      setSessionList(sessions || []);
    } catch {
      setSessionList([]);
    }
  }, []);

  const stream = useAgentChatStream({
    sidebarOpen,
    activeSkillId,
    setActiveSkillId,
    pageContext,
    notifyAgentBackground,
    refreshSessionList,
    onErrorMsg: setMemoryMsg,
  });

  const {
    sessionId,
    setSessionId,
    sessionIdRef,
    conversationEpochRef,
    lines,
    setLines,
    busy,
    setBusy,
    taskSteps,
    thinkingText,
    contextTokensEst,
    contextLimit,
    contextMeterRefreshing,
    currentFocus,
    runStream,
    confirm,
    planAction,
    newChat,
    stopStream,
    loadHistorySession,
  } = stream;

  useEffect(() => {
    void apiAgentConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
    void apiAgentSkillsList()
      .then((r) => setSkills(r.skills || []))
      .catch(() => setSkills([]));
  }, [projectBound]);

  // Auto-scroll when user is at bottom; preserve position if user manually departed
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView?.({ behavior: busy ? "auto" : "smooth" });
    }
  }, [lines, busy, thinkingText]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom < 40;
  }, []);

  useEffect(() => {
    void refreshSessionList();
  }, [refreshSessionList]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSessionMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionMenuOpen]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = historyShellRef.current;
      if (!el?.contains(e.target as Node)) setSessionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sessionMenuOpen]);

  const refreshMemoryIndex = useCallback(async () => {
    setMemoryBusy(true);
    setMemoryMsg(null);
    try {
      const { content } = await apiAgentMemoryIndexGet();
      setIndexDraft(content);
    } catch (e) {
      setMemoryMsg(e instanceof Error ? e.message : t("memoryIndexLoadErr"));
    } finally {
      setMemoryBusy(false);
    }
  }, [t]);

  const refreshTopicList = useCallback(async () => {
    try {
      const { topics } = await apiAgentMemoryTopicList();
      setTopicOptions(topics);
      setTopicPick((prev) => prev || topics[0] || "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!memoryOpen) return;
    void refreshMemoryIndex();
    void refreshTopicList();
  }, [memoryOpen, refreshMemoryIndex, refreshTopicList]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const epoch = conversationEpochRef.current;
    const { session_id } = await apiAgentCreateSession();
    if (epoch !== conversationEpochRef.current) throw new DOMException("Conversation replaced", "AbortError");
    sessionIdRef.current = session_id;
    setSessionId(session_id);
    void refreshSessionList();
    return session_id;
  }, [refreshSessionList, sessionIdRef, setSessionId, conversationEpochRef]);

  const startNewChat = useCallback(() => {
    sendGateRef.current = createAgentSubmissionGate();
    newChat();
  }, [newChat]);

  const handleConfirm = useCallback(
    (actionId: string, accepted: boolean) => confirm(actionId, accepted, ensureSession),
    [confirm, ensureSession],
  );
  const handlePlanAction = useCallback(
    (action: "execute" | "modify" | "cancel", planPath: string) => planAction(action, planPath, ensureSession),
    [planAction, ensureSession],
  );

  function lineKey(line: ChatLine): string {
    if (line.key) return line.key;
    const keys = fallbackLineKeysRef.current;
    let key = keys.get(line);
    if (!key) {
      key = `chat-local-${++fallbackLineSerialRef.current}`;
      keys.set(line, key);
    }
    return key;
  }

  const send = useCallback(async () => {
    if (!assistantEnabled) return;
    const typedInput = input.trim();
    const filesToUpload = [...pendingFiles];
    const msgText = agentSendMessage(typedInput, filesToUpload.length, t("fileOnlyPrompt"));
    const gate = sendGateRef.current;
    if (!msgText || busy || !gate?.tryAcquire()) return;
    const epoch = conversationEpochRef.current;
    const isCurrent = () => conversationEpochRef.current === epoch && sendGateRef.current === gate;
    setBusy(true);
    setInput("");
    setPendingFiles([]);
    isAtBottomRef.current = true;
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });

    try {
      const sid = await ensureSession();
      if (!isCurrent()) return;
      const attachments: FileAttachment[] = [];
      const failedFiles: File[] = [];
      for (const f of filesToUpload) {
        try {
          const fd = new FormData();
          fd.append("file", f);
          fd.append("session_id", sid);
          const res = await apiPostFormData<{
            ok: boolean;
            path: string;
            mime_type: string | null;
            original_name: string;
          }>("/api/agent/upload", fd);
          if (!isCurrent()) return;
          attachments.push({
            path: res.path,
            mime_type: res.mime_type,
            original_name: res.original_name,
          });
        } catch (e) {
          if (!isCurrent()) return;
          failedFiles.push(f);
          setLines((prev) => [
            ...prev,
            {
              kind: "system",
              text: i18n.t("agent:uploadFail", {
                name: formatUploadFailure(f.name, e),
              }),
            },
          ]);
        }
      }
      if (failedFiles.length > 0) {
        setPendingFiles((prev) => [...failedFiles, ...prev]);
      }
      if (!shouldDispatchAgentMessage(typedInput, filesToUpload.length, attachments.length)) return;

      setLines((prev) => [...prev, { kind: "user", text: msgText }]);
      await runStream({
        session_id: sid,
        message: msgText,
        mode: "execute",
        ...(attachments.length > 0 ? { file_attachments: attachments } : {}),
      } as Parameters<typeof apiAgentChatStream>[0]);
    } catch (e) {
      if (!isCurrent()) return;
      setPendingFiles((prev) => [...filesToUpload, ...prev]);
      setLines((prev) => [
        ...prev,
        { kind: "system", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      gate.release();
      if (isCurrent()) setBusy(false);
    }
  }, [
    assistantEnabled,
    busy,
    ensureSession,
    conversationEpochRef,
    input,
    pendingFiles,
    runStream,
    setBusy,
    setLines,
    t,
  ]);

  useEffect(() => {
    if (!prefillRequest) return;
    if (prefillRequest.newChat ?? true) {
      startNewChat();
    }
    setInput(prefillRequest.message);
  }, [startNewChat, prefillRequest]);

  const pickSkill = useCallback((s: AgentSkillInfo) => {
    setActiveSkillId(s.id);
    setInput(s.suggested_user_input);
  }, []);

  const removeHistorySession = useCallback(
    async (id: string) => {
      if (!(await confirmDialog(t("confirmDeleteSession")))) return;
      try {
        await apiAgentSessionDelete(id);
        await refreshSessionList();
        if (sessionId === id) {
          startNewChat();
        }
      } catch (e) {
        window.alert(
          `${t("sessionDeleteErr")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [t, refreshSessionList, sessionId, startNewChat],
  );

  return (
    <div
      className="relative flex h-full min-h-[320px] flex-col border-t border-slate-200 bg-white"
      data-testid="agent-file-drop-surface"
      onDragEnter={(e) => {
        if (!isFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDragActive(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault();
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setFileDragActive(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault();
        fileDragDepthRef.current = 0;
        setFileDragActive(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
      }}
    >
      {fileDragActive ? (
        <div
          className="pointer-events-none absolute inset-1 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-violet-500 bg-violet-50/95 p-4 text-center text-sm font-semibold text-violet-800 shadow-inner"
          role="status"
          aria-live="polite"
        >
          {t("dropFilesHere")}
        </div>
      ) : null}
      <div ref={historyShellRef} className="relative shrink-0 border-b border-slate-100">
        <div className="relative px-2 py-1.5 pr-10">
          {onRequestCollapse ? (
            <button
              type="button"
              title={t("collapseSidebar")}
              aria-label={t("collapseSidebar")}
              onClick={() => onRequestCollapse()}
              className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
              <span className="truncate">{t("title")}</span>
            </div>
            <div className="flex min-w-0 shrink items-center justify-end gap-1">
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSessionMenuOpen((o) => {
                      if (!o) void refreshSessionList();
                      return !o;
                    });
                  }}
                  className="flex items-center gap-0.5 rounded px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                >
                  <History className="h-3 w-3" />
                  {t("history")}
                  {sessionMenuOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              </div>
              <div className="flex min-w-0 shrink items-center justify-end gap-1 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setMemoryOpen((o) => !o)}
                  className="flex shrink-0 items-center gap-0.5 rounded px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                >
                  <BookMarked className="h-3 w-3" />
                  {t("longTermMemory")}
                  {memoryOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={startNewChat}
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                >
                  {t("newChat")}
                </button>
              </div>
            </div>
          </div>
        </div>
        <AgentSessionHistoryMenu
          isOpen={sessionMenuOpen}
          onClose={() => setSessionMenuOpen(false)}
          sessionList={sessionList}
          busy={busy}
          onLoadSession={async (id) => {
            await loadHistorySession(id, () => setSessionMenuOpen(false));
          }}
          onRemoveSession={removeHistorySession}
        />
      </div>
      <AgentMemoryDrawer
        isOpen={memoryOpen}
        memoryTab={memoryTab}
        setMemoryTab={setMemoryTab}
        memoryMsg={memoryMsg}
        setMemoryMsg={setMemoryMsg}
        indexDraft={indexDraft}
        setIndexDraft={setIndexDraft}
        topicDraft={topicDraft}
        setTopicDraft={setTopicDraft}
        topicPick={topicPick}
        setTopicPick={setTopicPick}
        topicOptions={topicOptions}
        memoryBusy={memoryBusy}
      />
      {config && !config.llm_configured && (
        <div className="mx-2 mt-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{t("noLlmConfig")}</span>
        </div>
      )}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 space-y-2 overflow-y-auto px-2 py-2 text-sm"
      >
        {currentFocus && currentFocus !== "general" && (
          <div className="rounded border border-blue-100 bg-blue-50/60 px-2 py-1 text-[11px] text-blue-900">
            {t("currentFocus")}
            {t(`focusLabels.${currentFocus}`, { defaultValue: currentFocus })}
          </div>
        )}
        {activeSkillId && (
          <div className="rounded border border-violet-100 bg-violet-50/60 px-2 py-1 text-[11px] text-violet-900">
            {t("quickAssist")}
            {skills.find((x) => x.id === activeSkillId)?.label ?? activeSkillId}
            <button
              type="button"
              className="ml-2 text-violet-600 underline"
              onClick={() => setActiveSkillId(null)}
            >
              {t("clear")}
            </button>
          </div>
        )}
        {taskSteps && taskSteps.length > 0 && (
          <div className="rounded border border-violet-100 bg-violet-50/80 px-2 py-1.5 text-[11px] text-violet-950">
            <div className="font-medium text-violet-900">{t("currentSteps")}</div>
            <ol className="mt-1 list-decimal pl-4 text-violet-900">
              {taskSteps.map((s, j) => (
                <li key={j}>
                  <span className="text-violet-600">[{s.status}]</span> {s.title}
                </li>
              ))}
            </ol>
          </div>
        )}
        {pageContext?.summary && (
          <div className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-[11px] text-slate-600">
            {t("currentUi", { summary: pageContext.summary })}
          </div>
        )}
        {lines.length === 0 && skills.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500">{t("quickStart")}</p>
            <div className="flex flex-wrap gap-1">
              {skills.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.description}
                  onClick={() => pickSkill(s)}
                  className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-800 hover:bg-violet-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.length === 0 && (
          <p className="text-xs text-slate-500">{t("freeformHint")}</p>
        )}
        {lines.map((ln) => (
          <div key={lineKey(ln)}>
            <AgentMessageItem
              line={ln}
              busy={busy}
              onConfirm={handleConfirm}
              onPlanAction={handlePlanAction}
            />
          </div>
        ))}
        {thinkingText && (
          <div className="flex items-center gap-2 overflow-hidden text-xs text-violet-600">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="animate-pulse">{thinkingText}</span>
          </div>
        )}
        {busy && !thinkingText && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("processing")}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-slate-100 p-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={AGENT_UPLOAD_ACCEPT}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
            e.target.value = "";
          }}
        />
        <AgentAttachmentList
          files={pendingFiles}
          onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
        />
        <div className="flex gap-1">
          <div className="flex shrink-0 flex-col items-center gap-1 self-end">
            {sessionId != null &&
            (contextTokensEst != null ||
              contextLimit != null ||
              contextMeterRefreshing) ? (
              <AgentContextRing
                used={contextTokensEst}
                limit={contextLimit}
                refreshing={contextMeterRefreshing}
                title={
                  contextLimit != null
                    ? t("contextMeterTooltip", {
                        used: (contextTokensEst ?? 0).toLocaleString(),
                        cap: contextLimit.toLocaleString(),
                      })
                    : t("contextMeterTooltipNoCap", {
                        used: (contextTokensEst ?? 0).toLocaleString(),
                      })
                }
                ariaLabel={
                  contextLimit != null
                    ? t("contextMeterAria", {
                        used: (contextTokensEst ?? 0).toLocaleString(),
                        cap: contextLimit.toLocaleString(),
                      })
                    : t("contextMeterAriaNoCap", {
                        used: (contextTokensEst ?? 0).toLocaleString(),
                      })
                }
              />
            ) : null}
            <button
              type="button"
              title={t("addAttachment")}
              aria-label={t("addAttachment")}
              disabled={!assistantEnabled}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-slate-300 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={input}
            disabled={!assistantEnabled}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposingKeyboardEvent(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={assistantEnabled ? t("inputPh") : t("disabledInputPh")}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          {busy ? (
            <button
              type="button"
              title={t("stop")}
              aria-label={t("stop")}
              onClick={() => void stopStream()}
              className="self-end rounded-md border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={
                !assistantEnabled || busy || (!input.trim() && pendingFiles.length === 0)
              }
              onClick={() => void send()}
              className="self-end rounded-md bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
