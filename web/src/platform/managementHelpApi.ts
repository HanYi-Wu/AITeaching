import { platformRequest } from "./platformRequest";
import type { ManagementScope } from "./managementApi";

export type ManagementHelpSection =
  | "schools" | "ai" | "extensions" | "audit" | "access" | "settings" | "activity"
  | "overview" | "teachers" | "classes" | "students" | "assignments";
export type ManagementHelpLink = {
  label: string;
  section: ManagementHelpSection;
  view?: "trace" | "matrix" | "list";
  school_id?: string;
  trace?: { kind: "user" | "role" | "menu" | "permission"; id: string };
};
export type ManagementHelpItem = {
  id: string;
  title: string;
  description: string;
  link: ManagementHelpLink;
};
export type ManagementHelpIndex = {
  sections: { section: ManagementHelpSection; title: string; items: ManagementHelpItem[] }[];
  suggestions: string[];
};
export type ManagementHelpMessage = { role: "user" | "assistant"; content: string };
export type ManagementHelpContext = { section?: string; school_id?: string };
export type ManagementHelpAnswer = {
  answer: string;
  links: ManagementHelpLink[];
  source: "local" | "llm";
};

function base(scope: ManagementScope) { return `/api/${scope}/management/help`; }

export function getManagementHelp(scope: ManagementScope, signal?: AbortSignal): Promise<ManagementHelpIndex> {
  return platformRequest(base(scope), { signal });
}

export function askManagementHelp(
  scope: ManagementScope,
  payload: {
    question: string;
    messages: ManagementHelpMessage[];
    school_id?: string;
    section?: string;
  },
  signal?: AbortSignal,
): Promise<ManagementHelpAnswer> {
  return platformRequest(`${base(scope)}/ask`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}
