import { memo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { KatexPlainPreview } from "../../../../components/KatexText";
import { QuestionHoverDetails } from "../../../../components/QuestionHoverDetails";
import { cn } from "../../../../lib/utils";
import type { QuestionRow } from "../../../../types/compose";
import { BankSelectionStore } from "./BankSelectionStore";
import { useRowSelection } from "./useBankSelectionStore";

export type BankQuestionRowProps = {
  question: QuestionRow;
  index: number;
  store: BankSelectionStore;
  onRowClick: (q: QuestionRow, index: number, e: MouseEvent<HTMLButtonElement>) => void;
  onRender?: (qid: string) => void;
};

export const BankQuestionRow = memo(function BankQuestionRow({
  question,
  index,
  store,
  onRowClick,
  onRender,
}: BankQuestionRowProps) {
  onRender?.(question.qualified_id);
  const { t } = useTranslation(["compose", "common", "lib"]);
  const isSelected = useRowSelection(store, question.qualified_id);
  const isBundle = question.type === "group";

  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData(
            "application/x-originreach-bank-qids",
            JSON.stringify(
              store.isSelected(question.qualified_id)
                ? Array.from(store.getOrderedIds())
                : [question.qualified_id],
            ),
          )
        }
        onClick={(e) => onRowClick(question, index, e)}
        className={cn(
          "w-full rounded-xl border p-2.5 text-left text-sm transition-all duration-150",
          isSelected
            ? "border-[var(--or-primary)] bg-[var(--or-block)] shadow-sm"
            : "border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="or-g49-pill bg-[var(--or-block)] text-[var(--or-muted)] font-medium">
            {t(`lib:questionTypes.${question.type}`, { defaultValue: question.type })}
          </span>
          {isBundle ? (
            <span className="or-g49-pill bg-[var(--or-success-container)] text-[var(--or-on-success)] font-medium">
              {t("compose:bundleBadge")}
            </span>
          ) : null}
          <span
            data-question-id={question.qualified_id}
            className="min-w-0 font-mono text-[13px] text-[var(--or-muted)] [overflow-wrap:anywhere]"
          >
            {question.qualified_id}
          </span>
        </div>
        <QuestionHoverDetails id={question.qualified_id}>
          <KatexPlainPreview
            text={question.content_preview}
            className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[var(--or-muted)] [&_.katex]:text-[0.95em]"
          />
        </QuestionHoverDetails>
        {Object.keys(question.metadata ?? {}).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(question.metadata ?? {}).map(([k, v]) => (
              <span
                key={k}
                className="or-g49-pill bg-[var(--or-block)] text-[var(--or-muted)] text-[13px] px-2 py-0.5"
              >
                {k}:{String(v)}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
});
