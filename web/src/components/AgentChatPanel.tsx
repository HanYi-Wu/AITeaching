import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  History,
  ImagePlus,
  Info,
  Loader2,
  MousePointer2,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  apiAgentConfig,
  apiAgentCreateSession,
  apiAgentSessionDelete,
  apiAgentSessionsList,
  apiPostFormData,
  type AgentConfig,
  type AgentSessionListItem,
  type AgentQuestionReview,
  type apiAgentChatStream,
} from "../api/client";
import { useAgentContext } from "../contexts/AgentContext";
import { confirmDialog } from "../lib/confirmDialog";
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
  AgentChatComposer,
  AgentMessageItem,
  AgentSessionHistoryMenu,
  useAgentChatStream,
  type ChatLine,
  type FileAttachment,
} from "./agent-chat";
import "../ui-redesign/g55/g55.css";
import { getPageSelectionTarget, keyboardPageTargets, readPageSelection, type PageSelection } from "./agent-chat/pageSelection";

export { ASSISTANT_PROSE_CLASS };
export type AgentWindowDragProps = Pick<HTMLAttributes<HTMLDivElement>,
  "role" | "aria-label" | "tabIndex" | "onPointerDown" | "onPointerMove" | "onPointerUp" |
  "onPointerCancel" | "onLostPointerCapture" | "onKeyDown"
> & { "data-agent-window-drag": true };

export function AgentChatPanel({
  projectBound = false,
  onRequestCollapse,
  onReady,
  tucked = false,
  windowControls,
  windowDrag,
}: {
  projectBound?: boolean;
  onRequestCollapse?: () => void;
  onReady?: () => void;
  tucked?: boolean;
  windowControls?: ReactNode;
  windowDrag?: AgentWindowDragProps;
} = {}) {
  const { t } = useTranslation("agent");
  const { pageContext, sidebarOpen, prefillRequest, notifyAgentBackground } = useAgentContext();
  useEffect(() => { onReady?.(); }, [onReady]);

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const composerPresetIdRef = useRef(0);
  const [composerPreset, setComposerPreset] = useState<{ id: number; text: string } | null>(null);
  const [sessionList, setSessionList] = useState<AgentSessionListItem[]>([]);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<PageSelection | null>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!picking || !sidebarOpen || tucked) return;
    document.body.classList.add("or-agent-picking");
    let highlighted: Element | null = null;
    let temporaryTabTarget: Element | null = null;
    const highlight = (element: Element | null) => {
      const target = getPageSelectionTarget(element);
      if (target === highlighted) return;
      highlighted?.removeAttribute("data-agent-highlight");
      highlighted = target;
      highlighted?.setAttribute("data-agent-highlight", "");
    };
    const finish = (target?: PageSelection) => {
      if (target) setSelection(target);
      setPicking(false);
      pickerButton.current?.focus({ preventScroll: true });
    };
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".or-assistant-drawer,.or-g55-agent-panel,.or-assistant-edge-tab")) return;
      const chosen = readPageSelection(element, pageContext?.current_page);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (chosen) finish(chosen);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); finish();
      } else if (event.key === "Tab") {
        const controls = [...new Set(Array.from(document.querySelectorAll<HTMLElement>(keyboardPageTargets))
          .map((target) => getPageSelectionTarget(target))
          .filter((target): target is HTMLElement => target instanceof HTMLElement && target.getClientRects().length > 0 &&
            getComputedStyle(target).visibility === "visible"))];
        if (!controls.length) return;
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const index = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        const target = controls[index];
        temporaryTabTarget?.removeAttribute("tabindex");
        temporaryTabTarget = null;
        if (!target.hasAttribute("tabindex")) { target.setAttribute("tabindex", "-1"); temporaryTabTarget = target; }
        event.preventDefault(); event.stopImmediatePropagation(); target.focus(); highlight(target);
      } else if (event.key === "Enter") {
        const chosen = readPageSelection(document.activeElement, pageContext?.current_page);
        if (chosen) { event.preventDefault(); event.stopImmediatePropagation(); finish(chosen); }
      }
    };
    const pointer = (event: PointerEvent) => highlight(event.target instanceof Element ? event.target : null);
    const preventUnderlyingPress = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest(".or-assistant-drawer,.or-g55-agent-panel,.or-assistant-edge-tab")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = getPageSelectionTarget(element);
      if (target?.matches(":disabled")) {
        const chosen = readPageSelection(target, pageContext?.current_page);
        if (chosen) finish(chosen);
      }
    };
    document.addEventListener("pointerover", pointer, true);
    document.addEventListener("pointerdown", preventUnderlyingPress, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.body.classList.remove("or-agent-picking");
      highlighted?.removeAttribute("data-agent-highlight");
      temporaryTabTarget?.removeAttribute("tabindex");
      document.removeEventListener("pointerover", pointer, true);
      document.removeEventListener("pointerdown", preventUnderlyingPress, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [picking, sidebarOpen, tucked, pageContext?.current_page]);

  useEffect(() => { if (!sidebarOpen || tucked) setPicking(false); }, [sidebarOpen, tucked]);

  const [chatError, setChatError] = useState<string | null>(null);

  const assistantEnabled = config?.llm_configured !== false;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const sendGateRef = useRef<ReturnType<typeof createAgentSubmissionGate> | null>(null);
  if (sendGateRef.current === null) sendGateRef.current = createAgentSubmissionGate();

  // Scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
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
    pageContext,
    notifyAgentBackground,
    refreshSessionList: async () => { if (sessionMenuOpen) await refreshSessionList(); },
    onErrorMsg: setChatError,
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
    turnUsage,
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
    if (tucked) setSessionMenuOpen(false);
  }, [tucked]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const epoch = conversationEpochRef.current;
    const { session_id } = await apiAgentCreateSession();
    if (epoch !== conversationEpochRef.current) throw new DOMException("Conversation replaced", "AbortError");
    sessionIdRef.current = session_id;
    setSessionId(session_id);
    return session_id;
  }, [sessionIdRef, setSessionId, conversationEpochRef]);

  const startNewChat = useCallback(() => {
    sendGateRef.current = createAgentSubmissionGate();
    newChat();
  }, [newChat]);

  const handleConfirm = useCallback(
    (actionId: string, accepted: boolean, review?: AgentQuestionReview[]) => confirm(actionId, accepted, ensureSession, review),
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

  const send = useCallback((draft: string): boolean => {
    if (!assistantEnabled) return false;
    const typedInput = draft.trim();
    const filesToUpload = [...pendingFiles];
    const msgText = agentSendMessage(typedInput, filesToUpload.length, t("fileOnlyPrompt"));
    const gate = sendGateRef.current;
    if (!msgText || busy || !gate?.tryAcquire()) return false;
    const epoch = conversationEpochRef.current;
    const isCurrent = () => conversationEpochRef.current === epoch && sendGateRef.current === gate;
    setBusy(true);
    setPendingFiles([]);
    isAtBottomRef.current = true;
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });

    void (async () => {
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
        if (selection) setSelection((current) => current === selection ? null : current);
        await runStream({
          session_id: sid,
          message: msgText,
          mode: "execute",
          ...(selection ? { page_context: selection.context } : {}),
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
    })();
    return true;
  }, [
    assistantEnabled,
    busy,
    ensureSession,
    conversationEpochRef,
    pendingFiles,
    selection,
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
    setComposerPreset({ id: ++composerPresetIdRef.current, text: prefillRequest.message });
  }, [startNewChat, prefillRequest]);

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
  const closeHistory = () => {
    setSessionMenuOpen(false);
    historyButtonRef.current?.focus({ preventScroll: true });
  };
  const queueFiles = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    input.value = "";
  };

  return (
    <div
      className="or-g55-agent-panel relative flex h-full min-h-0 flex-col bg-[var(--or-card)] text-[var(--or-text)]"
      data-testid="agent-file-drop-surface"
      onKeyDown={(event) => {
        if (event.key === "Escape" && sessionMenuOpen) {
          event.preventDefault(); event.stopPropagation(); closeHistory();
        }
      }}
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

      <div className="or-agent-header" {...windowDrag}>
        <span className="or-agent-header-title"><Sparkles className="h-4 w-4 shrink-0 text-or-primary" /><span className="truncate">{t("title")}</span></span>
        <button ref={historyButtonRef} type="button" className="or-agent-icon" aria-expanded={sessionMenuOpen}
          aria-label={t("history")} title={t("history")}
          onClick={() => { if (sessionMenuOpen) closeHistory(); else { setSessionMenuOpen(true); void refreshSessionList(); } }}>
          <History className="h-4 w-4" />
        </button>
        <button type="button" className="or-agent-icon or-agent-new-chat" onClick={() => { startNewChat(); setSessionMenuOpen(false); }}
          title={t("newChat")} aria-label={t("newChat")}><Plus className="h-4 w-4" /></button>
        {windowControls}
        {onRequestCollapse && <button type="button" data-assistant-close className="or-agent-icon"
          title={t("collapseSidebar")} aria-label={t("collapseSidebar")} onClick={onRequestCollapse}><X className="h-4 w-4" /></button>}
      </div>
        <AgentSessionHistoryMenu
          isOpen={sessionMenuOpen}
          onClose={closeHistory}
          sessionList={sessionList}
          busy={busy}
          onLoadSession={async (id) => {
            await loadHistorySession(id, closeHistory);
          }}
          onRemoveSession={removeHistorySession}
          footer={(turnUsage || contextTokensEst !== null) ? <>
            {turnUsage && <p>最近一轮：{turnUsage.total.toLocaleString()} tokens
              {turnUsage.input !== null && turnUsage.output !== null ? `（输入 ${turnUsage.input.toLocaleString()} · 输出 ${turnUsage.output.toLocaleString()}）` : ""}</p>}
            {contextTokensEst !== null && <p>上下文估算：{contextTokensEst.toLocaleString()}{contextLimit ? ` / ${contextLimit.toLocaleString()}` : ""}{contextMeterRefreshing ? "（更新中）" : ""}</p>}
          </> : undefined}
        />

      {chatError && <p role="alert" className="px-3 py-2 text-xs text-or-error">{chatError}</p>}

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

        {lines.length === 0 && (
          <p className="pt-2 text-sm leading-relaxed text-[var(--or-muted)]">{t("freeformHint")}</p>
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
      <div className="shrink-0 border-t border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 or-g55-safe-bottom">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={AGENT_UPLOAD_ACCEPT}
          onChange={(e) => queueFiles(e.currentTarget)}
        />
        <input ref={imageInputRef} type="file" multiple className="hidden"
          accept=".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif" onChange={(event) => queueFiles(event.currentTarget)} />

        <AgentAttachmentList
          files={pendingFiles}
          onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
        />

        {picking && <p role="status" className="mb-2 text-xs">点击高亮内容，或按 Tab 选择、Enter 确认、Esc 退出。</p>}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button ref={pickerButton} type="button" disabled={!assistantEnabled || busy} aria-pressed={picking}
            className="or-agent-tool or-agent-picker-button"
            onClick={() => setPicking((value) => !value)}><MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />{picking ? "退出选取" : "选取页面内容"}</button>
          <button type="button" className="or-agent-tool" disabled={!assistantEnabled || busy} onClick={() => imageInputRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />上传图片
          </button>
        </div>
        {selection && <div className="or-agent-reference mb-2">
          <details className="min-w-0 flex-1">
            <summary className="flex cursor-pointer items-center gap-1 truncate text-xs"><Info className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">引用：{selection.label}</span>
            </summary>
            <div className="or-agent-reference-preview">
              <p>发送时附带以下控件与页面文字：</p>
              <p className="font-medium">结构：{selection.context.selected_control?.tag} · {selection.label}</p>
              {selection.context.selected_control?.text && <p>{selection.context.selected_control.text}</p>}
              <p>{selection.context.visible_page_text || "没有可读取的页面文字。"}</p>
            </div>
          </details>
          <button type="button" className="or-agent-icon" onClick={() => setSelection(null)}
            aria-label={`移除引用：${selection.label}`}><X className="h-3.5 w-3.5" /></button>
        </div>}
        <div className="or-agent-composer-row">
            <button
              type="button"
              title={t("addAttachment")}
              aria-label={t("addAttachment")}
              disabled={!assistantEnabled}
              onClick={() => fileInputRef.current?.click()}
              className="or-agent-composer-action"
            >
              <Paperclip className="h-4 w-4" />
            </button>

          <AgentChatComposer
            busy={busy}
            disabled={!assistantEnabled}
            hasAttachments={pendingFiles.length > 0}
            inputPlaceholder={assistantEnabled ? t("inputPh") : t("disabledInputPh")}
            sendLabel={sendLabel}
            stopLabel={t("stop")}
            draftPreset={composerPreset}
            onSend={send}
            onStop={stopStream}
          />
        </div>
      </div>
    </div>
  );
}
