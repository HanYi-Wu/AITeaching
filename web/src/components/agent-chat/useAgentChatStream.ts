import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "../../i18n/i18n";
import {
  apiAgentChatStream, apiAgentSessionCancel, apiAgentSessionContextMeter, apiAgentSessionGet,
  type AgentQuestionReview,
} from "../../api/client";
import type { AgentPageContextPayload } from "../../contexts/AgentContext";
import { notifyAgentContentChanged } from "../../lib/contentEvents";
import { formatToolLineLabel, mapSessionMessagesToLines } from "./formatTool";
import { appendAssistantText, createTextDeltaBuffer, finishToolLine, startToolLine } from "./streamUpdates";
import type { ChatLine, TaskStep } from "./types";

export interface UseAgentChatStreamOptions {
  sidebarOpen?: boolean;
  activeSkillId?: string | null;
  setActiveSkillId?: (id: string | null) => void;
  pageContext?: AgentPageContextPayload | null;
  notifyAgentBackground: (msg: string, type?: "info" | "warning" | "success") => void;
  refreshSessionList: () => Promise<void>;
  onErrorMsg?: (msg: string | null) => void;
}

type ChatBody = Parameters<typeof apiAgentChatStream>[0];

export type TurnUsage = { input: number | null; output: number | null; total: number };

export function readTurnUsage(raw: unknown): TurnUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const values = raw as Record<string, unknown>;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const input = count(values.prompt_tokens);
  const output = count(values.completion_tokens);
  const total = count(values.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  return total !== null && total > 0 ? { input, output, total } : null;
}
type StreamRun = {
  controller: AbortController;
  text: ReturnType<typeof createTextDeltaBuffer>;
  segmentClosed: boolean;
};

export function useAgentChatStream(options: UseAgentChatStreamOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, updateBusy] = useState(false);
  const busyRef = useRef(false);
  const [taskSteps, setTaskSteps] = useState<TaskStep[] | null>(null);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [contextTokensEst, setContextTokensEst] = useState<number | null>(null);
  const [contextLimit, setContextLimit] = useState<number | null>(null);
  const [contextMeterRefreshing, setContextMeterRefreshing] = useState(false);
  const [turnUsage, setTurnUsage] = useState<TurnUsage | null>(null);
  const [currentFocus, setCurrentFocus] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const activeRun = useRef<StreamRun | null>(null);
  const generation = useRef(0);
  const conversationEpochRef = useRef(0);
  const meterRequest = useRef(0);
  const lineSerial = useRef(0);
  const nextKey = () => `chat-line-${++lineSerial.current}`;

  const setBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    updateBusy(value);
  }, []);

  const refreshContextMeter = useCallback(async (sid: string) => {
    if (!sid.trim()) return;
    const request = ++meterRequest.current;
    const epoch = generation.current;
    setContextMeterRefreshing(true);
    try {
      const result = await apiAgentSessionContextMeter(sid);
      if (request !== meterRequest.current || epoch !== generation.current || sessionIdRef.current !== sid) return;
      if (typeof result.context_tokens_est === "number" && Number.isFinite(result.context_tokens_est)) {
        setContextTokensEst(Math.round(result.context_tokens_est));
      }
      setContextLimit(typeof result.context_limit === "number" && Number.isFinite(result.context_limit)
        ? Math.round(result.context_limit) : null);
    } catch {
      /* Retain the last known estimate when the request fails. */
    } finally {
      if (request === meterRequest.current && epoch === generation.current) setContextMeterRefreshing(false);
    }
  }, []);

  const runStream = useCallback(async (body: ChatBody) => {
    if (activeRun.current) return;
    const epoch = ++generation.current;
    ++meterRequest.current;
    setContextMeterRefreshing(false);
    setTurnUsage(null);
    const current = () => activeRun.current === run && generation.current === epoch;
    const run: StreamRun = {
      controller: new AbortController(),
      segmentClosed: false,
      text: createTextDeltaBuffer((text) => {
        if (!current()) return;
        const closed = run.segmentClosed;
        run.segmentClosed = false;
        const key = nextKey();
        setLines((previous) => appendAssistantText(previous, text, closed, key));
      }),
    };
    activeRun.current = run;
    setBusy(true);
    setThinkingText(null);
    const context = latest.current;
    const payload: ChatBody = { ...body };
    if (context.activeSkillId) payload.skill_id = context.activeSkillId;
    if (payload.page_context === undefined && context.pageContext) {
      const page = context.pageContext;
      payload.page_context = {
        current_page: page.current_page,
        ...(page.selected_resource_type != null ? { selected_resource_type: page.selected_resource_type } : {}),
        ...(page.selected_resource_id != null ? { selected_resource_id: page.selected_resource_id } : {}),
        ...(page.summary ? { summary: page.summary } : {}),
      };
    }
    const append = (line: ChatLine) => {
      const keyed = { ...line, key: nextKey() };
      setLines((previous) => [...previous, keyed]);
    };
    const notify = (message: string, type?: "info" | "warning" | "success") => {
      if (!latest.current.sidebarOpen) latest.current.notifyAgentBackground(message, type);
    };
    const updateMetrics = (data: Record<string, unknown>, useUsage = false) => {
      const usage = data.usage as { total_tokens?: unknown } | undefined;
      const estimate = data.context_tokens_est ?? (useUsage ? usage?.total_tokens : undefined);
      if (typeof estimate === "number" && Number.isFinite(estimate)) setContextTokensEst(Math.round(estimate));
      if (typeof data.context_limit === "number" && Number.isFinite(data.context_limit)) setContextLimit(Math.round(data.context_limit));
    };
    try {
      await apiAgentChatStream(payload, (event, data) => {
        if (!current()) return;
        if (event === "text_delta" && typeof data.text === "string") {
          setThinkingText(null);
          run.text.push(data.text);
          return;
        }
        // A control event must observe every preceding text chunk in arrival order.
        run.text.flush();
        switch (event) {
          case "session":
            if (typeof data.session_id === "string") {
              sessionIdRef.current = data.session_id;
              setSessionId(data.session_id);
            }
            break;
          case "thinking":
            if (typeof data.message === "string") setThinkingText(data.message);
            break;
          case "tool_start": {
            run.segmentClosed = true;
            setThinkingText(null);
            const tool_name = String(data.tool_name ?? "");
            const pending: Extract<ChatLine, { kind: "tool_pending" }> = {
              kind: "tool_pending", key: nextKey(), tool_name,
              tool_call_id: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
              label: typeof data.label === "string" ? data.label : formatToolLineLabel(tool_name),
            };
            setLines((previous) => startToolLine(previous, pending));
            break;
          }
          case "tool_result": {
            run.segmentClosed = true;
            setThinkingText(null);
            const tool_name = String(data.tool_name ?? "");
            notifyAgentContentChanged(tool_name, String(data.status ?? ""));
            const result: Extract<ChatLine, { kind: "tool" }> = {
              kind: "tool", key: nextKey(), tool_name,
              tool_call_id: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
              summary: String(data.summary ?? data.status ?? ""), subagent: Boolean(data.subagent),
              download_url: typeof data.download_url === "string" ? data.download_url : undefined,
              filename: typeof data.filename === "string" ? data.filename : undefined,
            };
            setLines((previous) => finishToolLine(previous, result));
            break;
          }
          case "task_update":
            if (Array.isArray(data.steps)) setTaskSteps(data.steps.map((step) => ({
              title: String((step as { title?: string }).title ?? ""),
              status: String((step as { status?: string }).status ?? ""),
            })));
            break;
          case "context_metrics":
            updateMetrics(data);
            break;
          case "memory_updated":
            append({ kind: "system", text: i18n.t("agent:memoryUpdatedRound") });
            notify(i18n.t("agent:memoryUpdatedSidebar"), "success");
            break;
          case "memory_update_failed": {
            const message = String(data.message ?? i18n.t("agent:memoryUpdateFail"));
            append({ kind: "system", text: message });
            notify(i18n.t("agent:memoryWriteWarn", { msg: message.slice(0, 80) }), "warning");
            break;
          }
          case "confirm_needed": {
            const action_id = String(data.action_id ?? "");
            const line: ChatLine = { kind: "confirm", key: nextKey(), action_id,
              tool_name: String(data.tool_name ?? ""), description: String(data.description ?? ""),
              preview: (data.preview ?? null) as Extract<ChatLine, { kind: "confirm" }>["preview"] };
            setLines((previous) => previous.some((item) => item.kind === "confirm" && item.action_id === action_id)
              ? previous : [...previous, line]);
            notify(i18n.t("agent:confirmOpenSidebar"), "warning");
            break;
          }
          case "error": {
            if (data.code === "invalid_question_review") {
              setLines((previous) => previous.map((line) => line.kind === "confirm" && line.action_id === data.action_id
                ? { ...line, resolved: undefined } : line));
            }
            const message = String(data.message ?? i18n.t("agent:unknownErr"));
            append({ kind: "system", text: message });
            notify(i18n.t("agent:assistantHint", { msg: message.slice(0, 100) }), "warning");
            break;
          }
          case "done":
            setThinkingText(null);
            setTurnUsage(readTurnUsage(data.usage));
            updateMetrics(data, true);
            void latest.current.refreshSessionList();
            if (sessionIdRef.current) void refreshContextMeter(sessionIdRef.current);
            notify(i18n.t("agent:roundEnd"));
            break;
          case "focus_changed": {
            const focus = String(data.focus ?? "general");
            setCurrentFocus(focus);
            const label = i18n.t(`agent:focusLabels.${focus}`, { defaultValue: focus });
            append({ kind: "system", text: i18n.t("agent:switchedFocus", { label }) });
            break;
          }
          case "plan_ready": {
            run.segmentClosed = true;
            const path = String(data.plan_file_path ?? "");
            const line: Extract<ChatLine, { kind: "plan_ready" }> = {
              kind: "plan_ready", key: nextKey(), plan_file_path: path, content: String(data.content ?? ""),
            };
            setLines((previous) => {
              const index = previous.findIndex((item) => item.kind === "plan_ready" && item.plan_file_path === path && !item.resolved);
              if (index < 0) return [...previous, line];
              const next = previous.slice();
              next[index] = { ...line, key: previous[index].key ?? line.key };
              return next;
            });
            notify(i18n.t("agent:planReady"), "warning");
            break;
          }
          case "subagent_start":
          case "subagent_done":
            append({ kind: "system", text: event === "subagent_start"
              ? i18n.t("agent:subtaskStart", { text: `${String(data.task_description ?? "").slice(0, 120)}…` })
              : i18n.t("agent:subtaskDone", { text: `${String(data.summary ?? "").slice(0, 200)}…` }) });
            break;
        }
      }, { signal: run.controller.signal });
    } catch (error) {
      if (current()) {
        run.text.flush();
        append({ kind: "system", text: error instanceof Error && error.name === "AbortError"
          ? i18n.t("agent:stopped") : error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (current()) {
        run.text.flush();
        activeRun.current = null;
        setBusy(false);
        setThinkingText(null);
      } else run.text.discard();
    }
  }, [refreshContextMeter, setBusy]);

  const confirm = useCallback(async (action_id: string, accepted: boolean, ensureSession: () => Promise<string>, review?: AgentQuestionReview[]) => {
    if (busyRef.current) return;
    setLines((previous) => previous.map((line) => line.kind === "confirm" && line.action_id === action_id
      ? { ...line, resolved: accepted ? "accepted" : "rejected" } : line));
    const epoch = generation.current;
    let sid: string;
    try { sid = await ensureSession(); }
    catch (error) { if (epoch !== generation.current) return; throw error; }
    if (epoch === generation.current) await runStream({ session_id: sid, message: "", confirm_action_id: action_id,
      confirm_accepted: accepted, ...(accepted && review ? { confirm_questions: review } : {}) });
  }, [runStream]);

  const planAction = useCallback(async (
    action: "execute" | "modify" | "cancel", planPath: string, ensureSession: () => Promise<string>,
  ) => {
    if (busyRef.current) return;
    setLines((previous) => previous.map((line) => line.kind === "plan_ready" && line.plan_file_path === planPath
      ? { ...line, resolved: action } : line));
    const epoch = generation.current;
    let sid: string;
    try { sid = await ensureSession(); }
    catch (error) { if (epoch !== generation.current) return; throw error; }
    if (epoch !== generation.current) return;
    if (action === "execute") {
      await runStream({ session_id: sid, message: i18n.t("agent:executePlanMsg", { path: planPath }), mode: "execute", execution_plan_path: planPath });
    } else if (action === "modify") {
      const feedback = window.prompt(i18n.t("agent:modifyPrompt"));
      if (feedback?.trim()) await runStream({ session_id: sid, message: i18n.t("agent:modifyPlanMsg", { feedback }), mode: "execute" });
    } else {
      await runStream({ session_id: sid, message: i18n.t("agent:planCancelMsg"), mode: "execute", clear_pending_plan_path: planPath });
    }
  }, [runStream]);

  const newChat = useCallback(() => {
    ++conversationEpochRef.current;
    ++generation.current;
    ++meterRequest.current;
    activeRun.current?.text.discard();
    activeRun.current?.controller.abort();
    activeRun.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
    setLines([]);
    setTaskSteps(null);
    setThinkingText(null);
    setCurrentFocus(null);
    setBusy(false);
    latest.current.setActiveSkillId?.(null);
    setContextTokensEst(null);
    setContextLimit(null);
    setTurnUsage(null);
    setContextMeterRefreshing(false);
  }, [setBusy]);

  const stopStream = useCallback(async () => {
    const sid = sessionIdRef.current;
    activeRun.current?.text.flush();
    activeRun.current?.controller.abort();
    if (sid) {
      try { await apiAgentSessionCancel(sid); } catch { /* Best effort cancellation. */ }
    }
  }, []);

  const loadHistorySession = useCallback(async (id: string, onDone?: () => void) => {
    if (busyRef.current) return;
    ++conversationEpochRef.current;
    const epoch = ++generation.current;
    ++meterRequest.current;
    setContextMeterRefreshing(false);
    onDone?.();
    try {
      const snapshot = await apiAgentSessionGet(id);
      if (epoch !== generation.current) return;
      sessionIdRef.current = id;
      setSessionId(id);
      const pending: ChatLine[] = Object.entries(snapshot.session?.pending_confirmations ?? {}).map(([action_id, action]) => ({
        kind: "confirm", action_id, tool_name: action.tool_name, description: action.description, preview: action.preview,
      }));
      setLines([...mapSessionMessagesToLines(snapshot.session?.messages ?? []), ...pending].map((line) => ({ ...line, key: nextKey() })));
      setTaskSteps(null);
      setThinkingText(null);
      setCurrentFocus(null);
      setContextTokensEst(null);
      setContextLimit(null);
      setTurnUsage(null);
      void refreshContextMeter(id);
    } catch (error) {
      if (epoch === generation.current) latest.current.onErrorMsg?.(error instanceof Error ? error.message : i18n.t("agent:sessionLoadErr"));
    }
  }, [refreshContextMeter]);

  useEffect(() => () => {
    ++conversationEpochRef.current;
    ++generation.current;
    activeRun.current?.text.discard();
    activeRun.current?.controller.abort();
    activeRun.current = null;
  }, []);

  return {
    sessionId, setSessionId, sessionIdRef, conversationEpochRef, lines, setLines, busy, setBusy, taskSteps, setTaskSteps,
    thinkingText, contextTokensEst, contextLimit, contextMeterRefreshing, currentFocus, turnUsage,
    runStream, confirm, planAction, newChat, stopStream, loadHistorySession, refreshContextMeter,
  };
}
