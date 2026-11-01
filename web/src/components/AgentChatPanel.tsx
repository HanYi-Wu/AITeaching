import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  BookMarked,
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
import "../ui-redesign/g55/g55.css";

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

  const sendLabel = i18n.language.startsWith("zh") ? "发送消息" : "Send message";

  return (
    <div
      className="or-g55-agent-panel relative flex h-full min-h-[320px] flex-col bg-[var(--or-card)] text-[var(--or-text)]"
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
          className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-or-primary bg-or-primary-container p-4 text-center text-sm font-semibold text-or-on-container shadow-xl backdrop-blur-sm "
          role="status"
          aria-live="polite"
        >
          {t("dropFilesHere")}
        </div>
      ) : null}

      {/* Header Bar */}
      <div ref={historyShellRef} className="relative shrink-0 border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_90%,transparent)] px-3 py-2.5 backdrop-blur-md  ">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-or-primary-container text-or-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-bold tracking-tight text-[var(--or-text)] ">
              {t("title")}
            </span>
          </div>
          {onRequestCollapse ? (
            <button
              type="button"
              data-assistant-close
              title={t("collapseSidebar")}
              aria-label={t("collapseSidebar")}
              onClick={() => onRequestCollapse()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--or-muted)] transition hover:bg-[var(--or-block)]"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            title={t("history")}
            aria-label={t("history")}
            aria-expanded={sessionMenuOpen}
            onClick={() => {
              setSessionMenuOpen((o) => {
                if (!o) void refreshSessionList();
                return !o;
              });
            }}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--or-outline)] text-[var(--or-muted)] transition hover:bg-[var(--or-block)]"
          >
            <History className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            title={t("longTermMemory")}
            aria-label={t("longTermMemory")}
            aria-expanded={memoryOpen}
            onClick={() => setMemoryOpen((o) => !o)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--or-outline)] text-[var(--or-muted)] transition hover:bg-[var(--or-block)]"
          >
            <BookMarked className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-lg bg-or-primary-container px-3 text-xs font-semibold text-or-on-container transition hover:brightness-95"
          >
            {t("newChat")}
          </button>
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
        <div className="or-g55-status-warning mx-3 mt-3 flex items-start gap-2.5 rounded-xl p-3 text-xs">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-or-warning" />
          <span className="leading-relaxed">{t("noLlmConfig")}</span>
        </div>
      )}

      {/* Message Stream Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3.5 overflow-y-auto p-3 text-sm"
      >
        {currentFocus && currentFocus !== "general" && (
          <div className="rounded-xl border border-or-primary/25 bg-or-primary-container px-3 py-1.5 text-xs text-or-on-container">
            <span className="font-medium">{t("currentFocus")}</span>
            <span>{t(`focusLabels.${currentFocus}`, { defaultValue: currentFocus })}</span>
          </div>
        )}

        {activeSkillId && (
          <div className="flex items-center justify-between rounded-xl border border-or-primary/25 bg-or-primary-container px-3 py-1.5 text-xs text-or-on-container">
            <div>
              <span className="font-medium">{t("quickAssist")}</span>
              <span>{skills.find((x) => x.id === activeSkillId)?.label ?? activeSkillId}</span>
            </div>
            <button
              type="button"
              className="font-medium text-or-primary underline hover:text-or-primary"
              onClick={() => setActiveSkillId(null)}
            >
              {t("clear")}
            </button>
          </div>
        )}

        {taskSteps && taskSteps.length > 0 && (
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3 text-xs text-[var(--or-text)]   ">
            <div className="font-semibold text-[var(--or-text)] ">{t("currentSteps")}</div>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 leading-relaxed">
              {taskSteps.map((s, j) => (
                <li key={j}>
                  <span className="font-medium text-or-primary">[{s.status}]</span> {s.title}
                </li>
              ))}
            </ol>
          </div>
        )}

        {pageContext?.summary && (
          <div className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-3 py-1.5 text-xs text-[var(--or-muted)]   ">
            {t("currentUi", { summary: pageContext.summary })}
          </div>
        )}

        {lines.length === 0 && skills.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-[var(--or-muted)] ">{t("quickStart")}</p>
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.description}
                  onClick={() => pickSkill(s)}
                  className="or-g55-pill border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-muted)] shadow-sm transition hover:border-or-primary hover:text-or-primary   "
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {lines.length === 0 && (
          <p className="pt-2 text-xs leading-relaxed text-[var(--or-muted)] ">{t("freeformHint")}</p>
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
          <div className="flex items-center gap-2 overflow-hidden text-xs font-medium text-or-primary">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="animate-pulse">{thinkingText}</span>
          </div>
        )}

        {busy && !thinkingText && (
          <div className="flex items-center gap-2 text-xs text-[var(--or-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-or-primary" />
            <span>{t("processing")}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_90%,transparent)] p-3 backdrop-blur-md   or-g55-safe-bottom">
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

        <div className="flex items-end gap-2">
          <div className="flex shrink-0 flex-col items-center gap-1.5 pb-1">
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-page)] text-[var(--or-muted)] transition hover:bg-[var(--or-block)] hover:text-[var(--or-text)] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-[var(--or-text)]"
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
            className="min-h-[46px] flex-1 resize-none rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 text-[16px] sm:text-[15px] text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus disabled:cursor-not-allowed disabled:bg-[var(--or-page)] disabled:text-[var(--or-muted)]"
          />

          {busy ? (
            <button
              type="button"
              title={t("stop")}
              aria-label={t("stop")}
              onClick={() => void stopStream()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] shadow-sm transition hover:bg-[var(--or-page)]"
            >
              <Square className="h-4 w-4 fill-current text-or-error" />
            </button>
          ) : (
            <button
              type="button"
              disabled={
                !assistantEnabled || busy || (!input.trim() && pendingFiles.length === 0)
              }
              onClick={() => void send()}
              aria-label={sendLabel}
              title={sendLabel}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-or-primary text-or-on-primary shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-[var(--or-page)] disabled:text-[var(--or-muted)] disabled:opacity-100 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
