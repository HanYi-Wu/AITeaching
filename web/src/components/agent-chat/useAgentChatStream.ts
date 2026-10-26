import { useCallback, useRef, useState } from "react";
import i18n from "../../i18n/i18n";
import {
  apiAgentChatStream,
  apiAgentSessionCancel,
  apiAgentSessionContextMeter,
  apiAgentSessionGet,
} from "../../api/client";
import type { AgentPageContextPayload } from "../../contexts/AgentContext";
import { notifyAgentContentChanged } from "../../lib/contentEvents";
import { formatToolLineLabel, mapSessionMessagesToLines } from "./formatTool";
import type { ChatLine, TaskStep } from "./types";

export interface UseAgentChatStreamOptions {
  sidebarOpen?: boolean;
  activeSkillId: string | null;
  setActiveSkillId: (id: string | null) => void;
  pageContext?: AgentPageContextPayload | null;
  notifyAgentBackground: (msg: string, type?: "info" | "warning" | "success") => void;
  refreshSessionList: () => Promise<void>;
  onErrorMsg?: (msg: string | null) => void;
}

export function useAgentChatStream({
  sidebarOpen,
  activeSkillId,
  setActiveSkillId,
  pageContext,
  notifyAgentBackground,
  refreshSessionList,
  onErrorMsg,
}: UseAgentChatStreamOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [taskSteps, setTaskSteps] = useState<TaskStep[] | null>(null);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [contextTokensEst, setContextTokensEst] = useState<number | null>(null);
  const [contextLimit, setContextLimit] = useState<number | null>(null);
  const [contextMeterRefreshing, setContextMeterRefreshing] = useState(false);
  const [currentFocus, setCurrentFocus] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const assistantSegmentClosedRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  const refreshContextMeter = useCallback(async (sid: string) => {
    if (!sid.trim()) return;
    setContextMeterRefreshing(true);
    try {
      const r = await apiAgentSessionContextMeter(sid);
      if (typeof r.context_tokens_est === "number" && Number.isFinite(r.context_tokens_est)) {
        setContextTokensEst(Math.round(r.context_tokens_est));
      }
      if (typeof r.context_limit === "number" && Number.isFinite(r.context_limit)) {
        setContextLimit(Math.round(r.context_limit));
      } else {
        setContextLimit(null);
      }
    } catch {
      /* retain estimation */
    } finally {
      setContextMeterRefreshing(false);
    }
  }, []);

  const buildChatBody = useCallback(
    (body: Parameters<typeof apiAgentChatStream>[0]): Parameters<typeof apiAgentChatStream>[0] => {
      let next = { ...body };
      if (activeSkillId) {
        next = { ...next, skill_id: activeSkillId };
      }
      if (!pageContext) return next;
      return {
        ...next,
        page_context: {
          current_page: pageContext.current_page,
          ...(pageContext.selected_resource_type != null
            ? { selected_resource_type: pageContext.selected_resource_type }
            : {}),
          ...(pageContext.selected_resource_id != null
            ? { selected_resource_id: pageContext.selected_resource_id }
            : {}),
          ...(pageContext.summary ? { summary: pageContext.summary } : {}),
        },
      };
    },
    [pageContext, activeSkillId],
  );

  const runStream = useCallback(
    async (body: Parameters<typeof apiAgentChatStream>[0]) => {
      setBusy(true);
      setThinkingText(null);
      const ac = new AbortController();
      streamAbortRef.current = ac;
      const payload = buildChatBody(body);
      try {
        await apiAgentChatStream(
          payload,
          (ev, data) => {
            if (ev === "session" && typeof data.session_id === "string") {
              sessionIdRef.current = data.session_id;
              setSessionId(data.session_id);
            }
            if (ev === "thinking" && typeof data.message === "string") {
              setThinkingText(data.message);
            }
            if (ev === "text_delta" && typeof data.text === "string") {
              const chunk = data.text;
              setThinkingText(null);
              setLines((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.kind === "assistant" && !assistantSegmentClosedRef.current) {
                  next[next.length - 1] = { kind: "assistant", text: last.text + chunk };
                } else {
                  assistantSegmentClosedRef.current = false;
                  next.push({ kind: "assistant", text: chunk });
                }
                return next;
              });
            }
            if (ev === "tool_start") {
              assistantSegmentClosedRef.current = true;
              setThinkingText(null);
              const tool_name = String(data.tool_name ?? "");
              const label =
                typeof data.label === "string" ? data.label : formatToolLineLabel(tool_name);
              const key = `${tool_name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              setLines((prev) => {
                // Prevent duplicate pending tool cards for the same active tool
                if (prev.some((l) => l.kind === "tool_pending" && l.tool_name === tool_name)) {
                  return prev;
                }
                return [...prev, { kind: "tool_pending", tool_name, label, key }];
              });
            }
            if (ev === "tool_result") {
              assistantSegmentClosedRef.current = true;
              setThinkingText(null);
              const tool_name = String(data.tool_name ?? "");
              notifyAgentContentChanged(tool_name, String(data.status ?? ""));
              const summary = String(data.summary ?? data.status ?? "");
              const subagent = Boolean(data.subagent);
              const download_url =
                typeof data.download_url === "string" ? data.download_url : undefined;
              const filename = typeof data.filename === "string" ? data.filename : undefined;

              setLines((prev) => {
                const next = [...prev];
                const idx = next.findIndex(
                  (l) => l.kind === "tool_pending" && l.tool_name === tool_name,
                );
                if (idx >= 0) {
                  next.splice(idx, 1);
                } else {
                  // If no matching pending and last line is already identical tool card, skip duplicate
                  const last = next[next.length - 1];
                  if (
                    last?.kind === "tool" &&
                    last.tool_name === tool_name &&
                    last.summary === summary &&
                    last.download_url === download_url
                  ) {
                    return prev;
                  }
                }
                next.push({
                  kind: "tool",
                  tool_name,
                  summary,
                  subagent,
                  download_url,
                  filename,
                });
                return next;
              });
            }
            if (ev === "task_update") {
              const raw = data.steps;
              if (Array.isArray(raw)) {
                setTaskSteps(
                  raw.map((s) => ({
                    title: String((s as { title?: string }).title ?? ""),
                    status: String((s as { status?: string }).status ?? ""),
                  })),
                );
              }
            }
            if (ev === "context_metrics") {
              const rawEst = (data as { context_tokens_est?: unknown }).context_tokens_est;
              const rawLim = (data as { context_limit?: unknown }).context_limit;
              if (typeof rawEst === "number" && Number.isFinite(rawEst)) {
                setContextTokensEst(Math.round(rawEst));
              }
              if (typeof rawLim === "number" && Number.isFinite(rawLim)) {
                setContextLimit(Math.round(rawLim));
              }
            }
            if (ev === "memory_updated") {
              setLines((prev) => [
                ...prev,
                { kind: "system", text: i18n.t("agent:memoryUpdatedRound") },
              ]);
              if (!sidebarOpen) {
                notifyAgentBackground(i18n.t("agent:memoryUpdatedSidebar"), "success");
              }
            }
            if (ev === "memory_update_failed") {
              const msg = String(data.message ?? i18n.t("agent:memoryUpdateFail"));
              setLines((prev) => [...prev, { kind: "system", text: msg }]);
              if (!sidebarOpen) {
                notifyAgentBackground(
                  i18n.t("agent:memoryWriteWarn", { msg: msg.slice(0, 80) }),
                  "warning",
                );
              }
            }
            if (ev === "confirm_needed") {
              const action_id = String(data.action_id ?? "");
              const tool_name = String(data.tool_name ?? "");
              const description = String(data.description ?? "");
              setLines((prev) => {
                // Prevent duplicate confirm card for the same action_id
                if (prev.some((l) => l.kind === "confirm" && l.action_id === action_id)) {
                  return prev;
                }
                return [...prev, { kind: "confirm", action_id, tool_name, description }];
              });
              if (!sidebarOpen) {
                notifyAgentBackground(i18n.t("agent:confirmOpenSidebar"), "warning");
              }
            }
            if (ev === "error") {
              const msg = String(data.message ?? i18n.t("agent:unknownErr"));
              setLines((prev) => [...prev, { kind: "system", text: msg }]);
              if (!sidebarOpen) {
                notifyAgentBackground(
                  i18n.t("agent:assistantHint", { msg: msg.slice(0, 100) }),
                  "warning",
                );
              }
            }
            if (ev === "done") {
              setThinkingText(null);
              const rawEst = (data as { context_tokens_est?: unknown }).context_tokens_est;
              const rawLim = (data as { context_limit?: unknown }).context_limit;
              const usage = (data as { usage?: { total_tokens?: unknown } }).usage;
              if (typeof rawEst === "number" && Number.isFinite(rawEst)) {
                setContextTokensEst(Math.round(rawEst));
              } else if (
                usage &&
                typeof usage.total_tokens === "number" &&
                Number.isFinite(usage.total_tokens)
              ) {
                setContextTokensEst(Math.round(usage.total_tokens));
              }
              if (typeof rawLim === "number" && Number.isFinite(rawLim)) {
                setContextLimit(Math.round(rawLim));
              }
              void refreshSessionList();
              const sidRefresh = sessionIdRef.current;
              if (sidRefresh) void refreshContextMeter(sidRefresh);
              if (!sidebarOpen) {
                notifyAgentBackground(i18n.t("agent:roundEnd"));
              }
            }
            if (ev === "focus_changed") {
              const focus = String(data.focus ?? "general");
              setCurrentFocus(focus);
              const label = i18n.t(`agent:focusLabels.${focus}`, { defaultValue: focus });
              setLines((prev) => [
                ...prev,
                { kind: "system", text: i18n.t("agent:switchedFocus", { label }) },
              ]);
            }
            if (ev === "plan_ready") {
              assistantSegmentClosedRef.current = true;
              const plan_file_path = String(data.plan_file_path ?? "");
              const content = String(data.content ?? "");
              setLines((prev) => {
                // Prevent duplicate plan card for the same plan_file_path
                if (
                  prev.some(
                    (l) => l.kind === "plan_ready" && l.plan_file_path === plan_file_path,
                  )
                ) {
                  return prev;
                }
                return [...prev, { kind: "plan_ready", plan_file_path, content }];
              });
              if (!sidebarOpen) {
                notifyAgentBackground(i18n.t("agent:planReady"), "warning");
              }
            }
            if (ev === "subagent_start" || ev === "subagent_done") {
              const line =
                ev === "subagent_start"
                  ? i18n.t("agent:subtaskStart", {
                      text: `${String(data.task_description ?? "").slice(0, 120)}…`,
                    })
                  : i18n.t("agent:subtaskDone", {
                      text: `${String(data.summary ?? "").slice(0, 200)}…`,
                    });
              setLines((prev) => [...prev, { kind: "system", text: line }]);
            }
          },
          { signal: ac.signal },
        );
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        if (aborted) {
          setLines((prev) => [...prev, { kind: "system", text: i18n.t("agent:stopped") }]);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setLines((prev) => [...prev, { kind: "system", text: msg }]);
        }
      } finally {
        streamAbortRef.current = null;
        setBusy(false);
        setThinkingText(null);
      }
    },
    [buildChatBody, notifyAgentBackground, refreshContextMeter, refreshSessionList, sidebarOpen],
  );

  const confirm = useCallback(
    async (action_id: string, accepted: boolean, ensureSession: () => Promise<string>) => {
      if (busy) return;
      setLines((prev) =>
        prev.map((ln) =>
          ln.kind === "confirm" && ln.action_id === action_id
            ? { ...ln, resolved: accepted ? "accepted" : "rejected" }
            : ln,
        ),
      );
      const sid = await ensureSession();
      await runStream({
        session_id: sid,
        message: "",
        confirm_action_id: action_id,
        confirm_accepted: accepted,
      });
    },
    [busy, runStream],
  );

  const planAction = useCallback(
    async (
      action: "execute" | "modify" | "cancel",
      planPath: string,
      ensureSession: () => Promise<string>,
    ) => {
      if (busy) return;
      setLines((prev) =>
        prev.map((ln) =>
          ln.kind === "plan_ready" && ln.plan_file_path === planPath
            ? { ...ln, resolved: action }
            : ln,
        ),
      );
      const sid = await ensureSession();
      if (action === "execute") {
        await runStream({
          session_id: sid,
          message: i18n.t("agent:executePlanMsg", { path: planPath }),
          mode: "execute",
          execution_plan_path: planPath,
        });
      } else if (action === "modify") {
        const feedback = window.prompt(i18n.t("agent:modifyPrompt"));
        if (feedback?.trim()) {
          await runStream({
            session_id: sid,
            message: i18n.t("agent:modifyPlanMsg", { feedback }),
            mode: "execute",
          });
        }
      } else if (action === "cancel") {
        await runStream({
          session_id: sid,
          message: i18n.t("agent:planCancelMsg"),
          mode: "execute",
          clear_pending_plan_path: planPath,
        });
      }
    },
    [busy, runStream],
  );

  const newChat = useCallback(() => {
    streamAbortRef.current?.abort();
    sessionIdRef.current = null;
    setSessionId(null);
    setLines([]);
    setTaskSteps(null);
    setActiveSkillId(null);
    setContextTokensEst(null);
    setContextLimit(null);
    setContextMeterRefreshing(false);
  }, [setActiveSkillId]);

  const stopStream = useCallback(async () => {
    const sid = sessionId;
    streamAbortRef.current?.abort();
    if (sid) {
      try {
        await apiAgentSessionCancel(sid);
      } catch {
        /* ignore */
      }
    }
  }, [sessionId]);

  const loadHistorySession = useCallback(
    async (id: string, onDone?: () => void) => {
      if (busy) return;
      onDone?.();
      try {
        const snap = await apiAgentSessionGet(id);
        const msgs = snap.session?.messages ?? [];
        sessionIdRef.current = id;
        setSessionId(id);
        setLines(mapSessionMessagesToLines(msgs));
        setTaskSteps(null);
        void refreshContextMeter(id);
      } catch (e) {
        onErrorMsg?.(e instanceof Error ? e.message : i18n.t("agent:sessionLoadErr"));
      }
    },
    [busy, refreshContextMeter, onErrorMsg],
  );

  return {
    sessionId,
    setSessionId,
    sessionIdRef,
    lines,
    setLines,
    busy,
    setBusy,
    taskSteps,
    setTaskSteps,
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
    refreshContextMeter,
  };
}
