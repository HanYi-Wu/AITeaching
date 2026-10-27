import { FileText, X } from "lucide-react";

export interface AgentAttachmentListProps {
  files: File[];
  onRemove: (index: number) => void;
}

export function AgentAttachmentList({ files, onRemove }: AgentAttachmentListProps) {
  if (files.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700"
        >
          <FileText className="h-3 w-3 text-slate-400" />
          <span className="max-w-[120px] truncate">{f.name}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 text-slate-400 hover:text-red-500"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
