import type {
  BoundQuestion,
  GraphNodeNoteRow,
  GraphNodeRow,
  GraphRelationRow,
  NodeFileLink,
  PanelTab,
} from "../useGraphStore";

export type {
  BoundQuestion,
  GraphNodeNoteRow,
  GraphNodeRow,
  GraphRelationRow,
  NodeFileLink,
  PanelTab,
};

export const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;

export const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

export function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface BankItemPreview {
  qualified_id: string;
  namespace?: string | null;
  subject?: string | null;
  type?: string | null;
  content_preview?: string | null;
  [key: string]: unknown;
}

export interface ResourceFileEntry {
  path: string;
  size: number;
}
