import i18n from "../../i18n/i18n";
import type { ChatLine } from "./types";

export function formatToolLineLabel(raw: string): string {
  const p = (k: string) => i18n.t(`agent:toolPrefix.${k}`);
  return raw
    .replace(/^analysis\./, p("analysis"))
    .replace(/^exam\./, p("exam"))
    .replace(/^graph\./, p("graph"))
    .replace(/^bank\./, p("bank"))
    .replace(/^memory\./, p("memory"))
    .replace(/^file\./, p("file"))
    .replace(/^doc\./, p("doc"))
    .replace(/^agent\./, p("agent"));
}

export function mapSessionMessagesToLines(
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: unknown;
    name?: string | null;
  }>,
): ChatLine[] {
  const out: ChatLine[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const t = (m.content || "").trim();
      if (t) out.push({ kind: "user", text: t });
    } else if (m.role === "assistant") {
      const c = (m.content || "").trim();
      if (c) out.push({ kind: "assistant", text: c });
    } else if (m.role === "tool") {
      const name = formatToolLineLabel(m.name || i18n.t("agent:toolOp"));
      const raw = (m.content || "").trim();
      const summary =
        raw.length > 180 ? `${raw.slice(0, 177)}…` : raw || i18n.t("agent:toolDone");
      out.push({ kind: "tool", tool_name: name, summary });
    }
  }
  return out;
}
