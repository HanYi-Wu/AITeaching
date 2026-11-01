import { memo } from "react";
import { Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MarkdownProseImg, MarkdownProseLink } from "../../lib/markdownTauriUrls";
import { ASSISTANT_PROSE_CLASS, type ChatLine } from "./types";
import { AgentConfirmCard, AgentPlanCard, AgentToolCard } from "./AgentCards";
import "../../ui-redesign/g55/g55.css";

export interface AgentMessageItemProps {
  line: ChatLine;
  busy: boolean;
  onConfirm: (actionId: string, accepted: boolean) => Promise<void>;
  onPlanAction: (action: "execute" | "modify" | "cancel", planPath: string) => Promise<void>;
}

export const AgentMessageItem = memo(function AgentMessageItem({
  line,
  busy,
  onConfirm,
  onPlanAction,
}: AgentMessageItemProps) {
  if (line.kind === "user") {
    return (
      <div className="ml-8 flex justify-end">
        <div className="rounded-2xl bg-or-primary px-3.5 py-2 text-[15px] font-normal leading-relaxed text-or-on-primary shadow-sm">
          {line.text}
        </div>
      </div>
    );
  }

  if (line.kind === "assistant") {
    if (!line.text) return null;
    return (
      <div className="mr-4 flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-or-primary-container text-or-primary">
          <Bot className="h-4 w-4" />
        </div>
        <div className={ASSISTANT_PROSE_CLASS}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{ img: MarkdownProseImg, a: MarkdownProseLink }}
          >
            {line.text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (line.kind === "tool_pending") {
    return <AgentToolCard tool_name={line.tool_name} label={line.label} isPending />;
  }

  if (line.kind === "tool") {
    return (
      <AgentToolCard
        tool_name={line.tool_name}
        summary={line.summary}
        subagent={line.subagent}
        download_url={line.download_url}
        filename={line.filename}
      />
    );
  }

  if (line.kind === "confirm") {
    return (
      <AgentConfirmCard
        action_id={line.action_id}
        tool_name={line.tool_name}
        description={line.description}
        resolved={line.resolved}
        busy={busy}
        onConfirm={onConfirm}
      />
    );
  }

  if (line.kind === "plan_ready") {
    return (
      <AgentPlanCard
        plan_file_path={line.plan_file_path}
        content={line.content}
        resolved={line.resolved}
        busy={busy}
        onPlanAction={onPlanAction}
      />
    );
  }

  if (line.kind === "system") {
    return <div className="text-center text-xs text-[var(--or-muted)] ">{line.text}</div>;
  }

  return null;
});
