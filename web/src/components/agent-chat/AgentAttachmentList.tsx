import { FileText, X } from "lucide-react";
import "../../ui-redesign/g55/g55.css";

export interface AgentAttachmentListProps {
  files: File[];
  onRemove: (index: number) => void;
}

export function AgentAttachmentList({ files, onRemove }: AgentAttachmentListProps) {
  if (files.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="or-g55-pill inline-flex items-center gap-1.5 border border-[var(--or-outline)] bg-[var(--or-page)] px-2.5 py-1 text-xs text-[var(--or-muted)]   "
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--or-muted)]" />
          <span className="max-w-[140px] truncate font-medium">{f.name}</span>
          <button
            type="button"
            aria-label={`移除 ${f.name}`}
            onClick={() => onRemove(i)}
            className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--or-muted)] hover:bg-or-inset hover:text-or-error"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
