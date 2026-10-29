export type FileAttachment = {
  path: string;
  mime_type: string | null;
  original_name: string;
};

type ChatLineContent =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      tool_name: string;
      summary: string;
      tool_call_id?: string;
      subagent?: boolean;
      download_url?: string;
      filename?: string;
    }
  | { kind: "tool_pending"; tool_call_id?: string; tool_name: string; label: string; key: string }
  | {
      kind: "confirm";
      action_id: string;
      tool_name: string;
      description: string;
      resolved?: "accepted" | "rejected";
    }
  | {
      kind: "plan_ready";
      plan_file_path: string;
      content: string;
      resolved?: "execute" | "modify" | "cancel";
    }
  | { kind: "system"; text: string };

export type ChatLine = ChatLineContent & { key?: string };

export type TaskStep = { title: string; status: string };

export const ASSISTANT_PROSE_CLASS =
  "prose prose-sm min-w-0 max-w-full break-words text-slate-800 prose-p:my-1 prose-headings:my-2 prose-pre:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:max-w-full prose-table:overflow-x-auto";
