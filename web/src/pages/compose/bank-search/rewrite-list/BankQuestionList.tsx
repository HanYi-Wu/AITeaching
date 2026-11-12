import { memo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { QuestionRow } from "../../../../types/compose";
import { BankSelectionStore } from "./BankSelectionStore";
import { BankQuestionRow } from "./BankQuestionRow";

export type BankQuestionListProps = {
  contentSyncing: boolean;
  totalQuestionCount: number;
  filteredQuestions: QuestionRow[];
  store: BankSelectionStore;
  onLeftBankClick: (q: QuestionRow, index: number, e: MouseEvent<HTMLButtonElement>) => void;
  onRender?: (qid: string) => void;
};

export const BankQuestionList = memo(function BankQuestionList({
  contentSyncing,
  totalQuestionCount,
  filteredQuestions,
  store,
  onLeftBankClick,
  onRender,
}: BankQuestionListProps) {
  const { t } = useTranslation(["compose", "common", "lib"]);

  return (
    <ul className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2.5">
      {contentSyncing ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_80%,transparent)] p-4 text-sm font-medium text-[var(--or-on-container)]">
          正在更新内容库...
        </div>
      ) : totalQuestionCount === 0 ? (
        <li className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-8 text-center text-sm text-[var(--or-muted)]">
          <p className="font-semibold text-[var(--or-text)] text-[15px]">{t("compose:emptyBank")}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--or-muted)]">
            {t("compose:emptyBankHint")}
          </p>
        </li>
      ) : filteredQuestions.length === 0 ? (
        <li className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-8 text-center text-sm text-[var(--or-muted)]">
          <p className="font-semibold text-[var(--or-text)] text-[15px]">{t("compose:emptyFilter")}</p>
          <p className="mt-2 text-sm text-[var(--or-muted)]">{t("compose:emptyFilterHint")}</p>
        </li>
      ) : (
        filteredQuestions.map((q, index) => (
          <BankQuestionRow
            key={q.qualified_id}
            question={q}
            index={index}
            store={store}
            onRowClick={onLeftBankClick}
            onRender={onRender}
          />
        ))
      )}
    </ul>
  );
});
