import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CircleHelp, CornerDownLeft, Send, X } from "lucide-react";
import type { PlatformUser } from "../../../platform/authTypes";
import { loadSessionToken } from "../../../platform/session";
import { PlatformRequestError } from "../../../platform/platformRequest";
import {
  askManagementHelp,
  getManagementHelp,
  type ManagementHelpContext,
  type ManagementHelpIndex,
  type ManagementHelpLink,
  type ManagementHelpMessage,
} from "../../../platform/managementHelpApi";
import "./ManagementHelp.css";

type Props = {
  user: PlatformUser;
  context?: ManagementHelpContext;
  onNavigate?: (link: ManagementHelpLink) => void;
};
type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  links?: ManagementHelpLink[];
};

export function buildManagementHelpHistory(turns: ChatTurn[]): ManagementHelpMessage[] {
  const selected: ManagementHelpMessage[] = [];
  let remaining = 2400;
  for (const turn of turns.slice(-8).reverse()) {
    const content = turn.content.slice(0, 500);
    if (!content || content.length > remaining) break;
    selected.unshift({ role: turn.role, content });
    remaining -= content.length;
  }
  return selected;
}

const EXAMPLES: Record<"admin" | "school", string[]> = {
  admin: ["怎么创建学校？", "在哪里查看操作日志？", "怎样管理学校账号权限？"],
  school: ["如何查看自己的权限？", "总览里能看什么？"],
};

function hasAnotherOpenDialog(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'))
    .some((element) => !element.closest("[data-management-help-dialog]"));
}

function allowedSections(scope: "admin" | "school"): Set<ManagementHelpLink["section"]> {
  return scope === "admin"
    ? new Set(["schools", "ai", "extensions", "audit", "access", "settings", "activity"])
    : new Set(["overview", "teachers", "classes", "students", "assignments", "ai", "audit", "access", "settings", "activity"]);
}

function filterLinks(
  links: ManagementHelpLink[],
  scope: "admin" | "school",
  context: ManagementHelpContext | undefined,
  ownSchoolId: string | null | undefined,
): ManagementHelpLink[] {
  const sections = allowedSections(scope);
  return links.filter((link) => {
    if (!sections.has(link.section) || !(link.view === undefined || link.view === "trace" || link.view === "matrix" || link.view === "list")) return false;
    if (link.trace && (!link.trace.id || link.trace.id.length > 128 || !["user", "role", "menu", "permission"].includes(link.trace.kind))) return false;
    if (scope === "school" && link.school_id && link.school_id !== ownSchoolId) return false;
    if (scope === "admin" && link.school_id && link.school_id !== context?.school_id) return false;
    return true;
  });
}

export function ManagementHelp({ user, context, onNavigate }: Props) {
  const scope = user.role === "admin" || user.role === "school" ? user.role : null;
  const [, refreshSessionSnapshot] = useState(0);
  const sessionToken = loadSessionToken();
  const identity = JSON.stringify([
    user.id,
    user.role,
    user.school_id ?? "",
    user.school_access_mode ?? "",
    [...(user.management_permissions ?? [])].sort(),
    sessionToken ?? "",
    context?.school_id ?? "",
    context?.section ?? "",
  ]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const openRef = useRef(false);
  const requestId = useRef(0);
  const turnId = useRef(0);
  const indexAbort = useRef<AbortController | null>(null);
  const answerAbort = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [index, setIndex] = useState<ManagementHelpIndex | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMac, setIsMac] = useState(false);

  const setDialogOpen = useCallback((next: boolean) => {
    if (next && hasAnotherOpenDialog()) return;
    openRef.current = next;
    setOpen(next);
    if (!next) {
      requestId.current += 1;
      answerAbort.current?.abort();
      setPending(false);
    }
  }, []);

  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  useEffect(() => {
    const syncToken = () => refreshSessionSnapshot((version) => version + 1);
    window.addEventListener("storage", syncToken);
    window.addEventListener("focus", syncToken);
    document.addEventListener("visibilitychange", syncToken);
    return () => {
      window.removeEventListener("storage", syncToken);
      window.removeEventListener("focus", syncToken);
      document.removeEventListener("visibilitychange", syncToken);
    };
  }, []);

  useEffect(() => () => {
    requestId.current += 1;
    indexAbort.current?.abort();
    answerAbort.current?.abort();
  }, []);

  useEffect(() => {
    if (!scope) return;
    const currentIdentity = identity;
    const token = loadSessionToken();
    const controller = new AbortController();
    indexAbort.current?.abort();
    indexAbort.current = controller;
    setDialogOpen(false);
    setQuestion("");
    setMessages([]);
    setIndex(null);
    setError(null);
    setPending(false);
    void getManagementHelp(scope, controller.signal).then((data) => {
      if (
        controller.signal.aborted || identityRef.current !== currentIdentity ||
        loadSessionToken() !== token
      ) return;
      setIndex(data);
    }).catch(() => {
      // The local starter questions and local answers remain available offline.
    });
    return () => {
      controller.abort();
      if (indexAbort.current === controller) indexAbort.current = null;
    };
  }, [identity, scope, setDialogOpen]);

  useEffect(() => {
    if (!scope) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" ||
        event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented
      ) return;
      if (openRef.current) {
        event.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (hasAnotherOpenDialog()) return;
      event.preventDefault();
      setDialogOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scope, setDialogOpen]);

  const suggestions = useMemo(() => {
    if (!scope) return [];
    const serverSuggestions = index?.suggestions.filter((item) => item.trim()).slice(0, 4) ?? [];
    return serverSuggestions.length ? serverSuggestions : EXAMPLES[scope];
  }, [index, scope]);

  const submit = useCallback(async (rawQuestion = question) => {
    if (!scope || pending) return;
    const text = rawQuestion.trim().slice(0, 500);
    if (!text) return;
    const token = loadSessionToken();
    const currentIdentity = identityRef.current;
    const id = ++requestId.current;
    const controller = new AbortController();
    answerAbort.current?.abort();
    answerAbort.current = controller;
    setQuestion("");
    setError(null);
    setPending(true);
    const history = buildManagementHelpHistory(messages);
    const questionTurn: ChatTurn = { id: ++turnId.current, role: "user", content: text };
    setMessages((previous) => [...previous, questionTurn].slice(-16));
    try {
      const result = await askManagementHelp(scope, {
        question: text,
        messages: history,
        school_id: context?.school_id,
        section: context?.section,
      }, controller.signal);
      if (id !== requestId.current) return;
      setPending(false);
      if (identityRef.current !== currentIdentity || loadSessionToken() !== token) return;
      const assistantTurn: ChatTurn = {
        id: ++turnId.current,
        role: "assistant",
        content: result.answer,
        links: filterLinks(result.links ?? [], scope, context, user.school_id),
      };
      setMessages((previous) => [...previous, assistantTurn].slice(-16));
    } catch (caught) {
      if (id !== requestId.current) return;
      setPending(false);
      if (identityRef.current !== currentIdentity || loadSessionToken() !== token || controller.signal.aborted) return;
      if (caught instanceof PlatformRequestError && caught.status === 401) {
        setMessages([]);
        setError("登录状态已过期，请重新登录后再试。");
        return;
      }
      setError("暂时无法回答，请检查连接后重试。");
    }
  }, [context?.school_id, context?.section, messages, pending, question, scope]);

  if (!scope) return null;

  return (
    <div className="management-help">
      <Dialog.Root open={open} onOpenChange={setDialogOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="management-help__trigger"
            aria-label="不会用？问助手"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(event) => {
              if (hasAnotherOpenDialog()) event.preventDefault();
            }}
          >
            <CircleHelp aria-hidden="true" className="management-help__trigger-icon" />
            <span className="management-help__trigger-long">不会用？问助手</span>
            <span className="management-help__trigger-short">问助手</span>
            <kbd className="management-help__shortcut">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="management-help__overlay" />
          <Dialog.Content
            className="management-help__dialog"
            data-management-help-dialog="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              window.setTimeout(() => textareaRef.current?.focus(), 0);
            }}
          >
            <header className="management-help__header">
              <div className="management-help__heading-icon"><CircleHelp aria-hidden="true" /></div>
              <div className="management-help__heading-copy">
                <Dialog.Title className="management-help__title">管理助手</Dialog.Title>
                <Dialog.Description className="management-help__description">
                  功能怎么用，直接问
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="management-help__close" aria-label="关闭帮助">
                  <X aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>

            <div className="management-help__conversation" aria-live="polite" aria-relevant="additions text">
              {messages.length === 0 ? (
                <div className="management-help__welcome">
                  <p>常见问题</p>
                  <div className="management-help__suggestions">
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => void submit(suggestion)} disabled={pending}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="management-help__turns">
                  {messages.map((turn) => (
                    <article key={turn.id} className={`management-help__turn management-help__turn--${turn.role}`}>
                      <p>{turn.content}</p>
                      {turn.links?.length ? (
                        <div className="management-help__links">
                          {turn.links.map((link, indexValue) => (
                            <button
                              key={`${link.section}:${link.view ?? ""}:${indexValue}`}
                              type="button"
                              onClick={() => {
                                setDialogOpen(false);
                                onNavigate?.(link);
                              }}
                            >
                              {link.label} <CornerDownLeft aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {pending ? <p className="management-help__status" role="status">正在整理指引…</p> : null}
                </div>
              )}
              {error ? <p className="management-help__error" role="alert">{error}</p> : null}
            </div>

            <form
              className="management-help__form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="management-help__input-wrap">
                <span className="sr-only">询问管理助手</span>
                <textarea
                  ref={textareaRef}
                  rows={2}
                  maxLength={500}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="例如：权限链路怎么看？"
                  aria-label="询问管理助手"
                />
              </label>
              <button type="submit" className="management-help__send" disabled={pending || !question.trim()} aria-label="发送问题">
                <Send aria-hidden="true" /> <span>提问</span>
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
