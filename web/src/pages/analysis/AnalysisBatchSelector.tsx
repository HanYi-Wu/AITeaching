import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { formatLocaleDate } from "../../lib/locale";
import { cn } from "../../lib/utils";
import { type ScoreBatch } from "./analysisTypes";

interface AnalysisBatchSelectorProps {
  batches: ScoreBatch[];
  selectedBatchId: string | null;
  onSelectBatch: (batchId: string) => void;
  onDeleteBatch: () => void;
}

export function AnalysisBatchSelector({
  batches,
  selectedBatchId,
  onSelectBatch,
  onDeleteBatch,
}: AnalysisBatchSelectorProps) {
  const { t } = useTranslation("analysis");
  if (batches.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">{t("batchLabel")}</span>
        <div className="flex gap-1">
          {batches.map((b) => (
            <button
              key={b.batch_id}
              onClick={() => onSelectBatch(b.batch_id)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                selectedBatchId === b.batch_id
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-200",
              )}
            >
              <FileSpreadsheet className="h-3 w-3" />
              {formatLocaleDate(b.imported_at)}
              <span className="opacity-70">({t("students", { n: b.student_count })})</span>
            </button>
          ))}
        </div>
        {selectedBatchId && (
          <button
            onClick={onDeleteBatch}
            className="ml-2 flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
            {t("deleteBatch")}
          </button>
        )}
      </div>
    </div>
  );
}
