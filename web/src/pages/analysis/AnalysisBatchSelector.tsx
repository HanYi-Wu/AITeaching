import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { formatLocaleDate } from "../../lib/locale";
import { cn } from "../../lib/utils";
import { type ScoreBatch } from "./analysisTypes";
import "../../ui-redesign/g52/g52-design-tokens.css";

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
    <div className="shrink-0 border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] px-4 sm:px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--or-muted)]">{t("batchLabel")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {batches.map((b) => {
            const isSelected = selectedBatchId === b.batch_id;
            return (
              <button
                key={b.batch_id}
                type="button"
                onClick={() => onSelectBatch(b.batch_id)}
                className={cn(
                  "or-g52-batch-pill",
                  isSelected
                    ? "or-g52-batch-pill-active"
                    : "or-g52-batch-pill-inactive",
                )}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span>{formatLocaleDate(b.imported_at)}</span>
                <span className={isSelected ? "text-white/80" : "text-[var(--or-muted)]"}>
                  ({t("students", { n: b.student_count })})
                </span>
              </button>
            );
          })}
        </div>
        {selectedBatchId && (
          <button
            type="button"
            onClick={onDeleteBatch}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--or-error)] bg-[var(--or-card)] px-2.5 py-1 text-xs font-medium text-[var(--or-on-error)] transition-colors hover:bg-[var(--or-error-container)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("deleteBatch")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
