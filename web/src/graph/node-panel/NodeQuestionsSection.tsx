import { useTranslation } from "react-i18next";
import { BookOpen, Trash2, X, Plus } from "lucide-react";
import { KatexPlainPreview } from "../../components/KatexText";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import { localeCompareStrings } from "../../lib/locale";
import type { BankItemPreview, BoundQuestion } from "./types";
import { Select as AppSelect } from "../../components/ui/select";

export interface NodeQuestionsSectionProps {
  busy: boolean;
  boundQuestions: BoundQuestion[];
  boundSel: Set<string>;
  setBoundSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  bankOpen: boolean;
  setBankOpen: (v: boolean) => void;
  bankItems: BankItemPreview[];
  bankNs: string;
  setBankNs: (v: string) => void;
  bankQ: string;
  setBankQ: (v: string) => void;
  bankSubject: string;
  setBankSubject: (v: string) => void;
  bankType: string;
  setBankType: (v: string) => void;
  bankSel: Set<string>;
  setBankSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  openBank: () => Promise<void>;
  bindSelectedQuestions: () => Promise<void>;
  unbindQ: (qid: string) => Promise<void>;
  unbindSelectedBound: () => Promise<void>;
}

export function NodeQuestionsSection({
  busy,
  boundQuestions,
  boundSel,
  setBoundSel,
  bankOpen,
  setBankOpen,
  bankItems,
  bankNs,
  setBankNs,
  bankQ,
  setBankQ,
  bankSubject,
  setBankSubject,
  bankType,
  setBankType,
  bankSel,
  setBankSel,
  openBank,
  bindSelectedQuestions,
  unbindQ,
  unbindSelectedBound,
}: NodeQuestionsSectionProps) {
  const { t } = useTranslation("graph");

  const filteredBank = (() => {
    let xs = bankItems;
    if (bankNs.trim()) {
      const s = bankNs.trim().toLowerCase();
      xs = xs.filter((it) => String(it.namespace ?? "").toLowerCase().includes(s));
    }
    if (bankSubject.trim()) {
      const s = bankSubject.trim();
      xs = xs.filter((it) => String(it.subject ?? "") === s);
    }
    if (bankType.trim()) {
      const s = bankType.trim();
      xs = xs.filter((it) => String(it.type ?? "") === s);
    }
    if (bankQ.trim()) {
      const s = bankQ.trim().toLowerCase();
      xs = xs.filter(
        (it) =>
          String(it.qualified_id ?? "").toLowerCase().includes(s) ||
          String(it.content_preview ?? "").toLowerCase().includes(s),
      );
    }
    return xs;
  })();

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--or-text)] ">
          {t("boundQuestions")}
        </h3>
        {boundQuestions.length > 0 && boundSel.size > 0 ? (
          <button
            type="button"
            className="or-g50-btn or-g50-btn-danger !h-7 !px-2.5 !text-xs font-medium"
            disabled={busy}
            onClick={() => void unbindSelectedBound()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("batchUnbind", { n: boundSel.size })}</span>
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="or-g50-btn or-g50-btn-primary w-full"
        onClick={() => void openBank()}
      >
        <BookOpen className="h-4 w-4" />
        <span>{t("pickFromBank")}</span>
      </button>

      <ul className="space-y-2">
        {boundQuestions.map((q) => (
          <li
            key={q.qualified_id}
            className="flex items-start gap-2.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 shadow-sm  "
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)] shrink-0  "
              checked={boundSel.has(q.qualified_id)}
              onChange={() => {
                setBoundSel((prev) => {
                  const n = new Set(prev);
                  if (n.has(q.qualified_id)) n.delete(q.qualified_id);
                  else n.add(q.qualified_id);
                  return n;
                });
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-semibold text-[var(--or-text)] ">
                {q.qualified_id}
              </div>
              {q.content_preview ? (
                <div className="mt-1 block w-full min-w-0">
                  <KatexPlainPreview
                    text={q.content_preview}
                    className="line-clamp-3 text-xs leading-relaxed text-[var(--or-muted)]  [&_.katex]:text-[0.95em]"
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="or-g50-btn or-g50-btn-danger !h-7 !px-2 !text-xs font-medium shrink-0"
              onClick={() => void unbindQ(q.qualified_id)}
            >
              {t("unbind")}
            </button>
          </li>
        ))}
        {boundQuestions.length === 0 ? (
          <li className="py-4 text-center text-sm text-[var(--or-muted)] ">
            {t("noBoundQuestions")}
          </li>
        ) : null}
      </ul>

      {/* Bank picker modal */}
      {bankOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden flex flex-col rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl  ">
            <div className="flex items-center justify-between border-b border-[var(--or-outline)] px-4 py-3.5 sm:px-5 sm:py-4 ">
              <h3 className="text-base font-semibold text-[var(--or-text)] ">
                {t("pickQuestionTitle")}
              </h3>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-muted)] dark:hover:bg-[var(--or-primary)] dark:hover:text-[var(--or-on-primary)]"
                onClick={() => setBankOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 p-3.5 sm:p-4 bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] border-b border-[var(--or-outline)]  ">
              <label className="text-xs font-medium text-[var(--or-muted)] ">
                <span>{t("collectionFilter")}</span>
                <input
                  className="or-g50-input mt-1 w-full"
                  value={bankNs}
                  onChange={(e) => setBankNs(e.target.value)}
                  placeholder={t("collectionPh")}
                />
              </label>

              <label className="text-xs font-medium text-[var(--or-muted)] ">
                <span>{t("subject")}</span>
                <AppSelect
                  className="or-g50-input mt-1 w-full"
                  value={bankSubject}
                  onValueChange={(value) => setBankSubject(value)}
                >
                  <option value="">{t("all")}</option>
                  {[
                    ...new Set(
                      bankItems
                        .map((it) => String(it.subject ?? "").trim())
                        .filter(Boolean),
                    ),
                  ]
                    .sort((a, b) => localeCompareStrings(a, b))
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </AppSelect>
              </label>

              <label className="text-xs font-medium text-[var(--or-muted)] ">
                <span>{t("questionType")}</span>
                <AppSelect
                  className="or-g50-input mt-1 w-full"
                  value={bankType}
                  onValueChange={(value) => setBankType(value)}
                >
                  <option value="">{t("all")}</option>
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </AppSelect>
              </label>

              <label className="text-xs font-medium text-[var(--or-muted)] ">
                <span>{t("keyword")}</span>
                <input
                  className="or-g50-input mt-1 w-full"
                  value={bankQ}
                  onChange={(e) => setBankQ(e.target.value)}
                  placeholder={t("keywordPh")}
                />
              </label>
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[45vh] p-3 sm:p-4 min-w-full">
              <table className="w-full text-left text-xs border-collapse min-w-[500px]">
                <thead className="sticky top-0 bg-[var(--or-block)]  text-[var(--or-muted)] ">
                  <tr>
                    <th className="p-2.5 rounded-l-lg">{t("thPick")}</th>
                    <th className="p-2.5">{t("thQid")}</th>
                    <th className="p-2.5">{t("thType")}</th>
                    <th className="p-2.5 rounded-r-lg">{t("thPreview")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--or-outline)] ">
                  {filteredBank.map((it) => (
                    <tr
                      key={it.qualified_id}
                      className="hover:bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--or-primary)_50%,transparent)]"
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-[var(--or-focus)]  "
                          checked={bankSel.has(it.qualified_id)}
                          onChange={() => {
                            setBankSel((prev) => {
                              const n = new Set(prev);
                              if (n.has(it.qualified_id)) n.delete(it.qualified_id);
                              else n.add(it.qualified_id);
                              return n;
                            });
                          }}
                        />
                      </td>
                      <td className="p-2.5 font-mono text-[var(--or-text)]  font-medium">
                        {it.qualified_id}
                      </td>
                      <td className="p-2.5 text-[var(--or-muted)] ">
                        {it.type}
                      </td>
                      <td className="p-2.5 text-[var(--or-muted)]  max-w-sm">
                        <KatexPlainPreview
                          text={String(it.content_preview ?? "")}
                          className="line-clamp-3 text-xs leading-snug [&_.katex]:text-[0.92em]"
                        />
                      </td>
                    </tr>
                  ))}
                  {filteredBank.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-[var(--or-muted)]">
                        {t("noBoundQuestions")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-[var(--or-outline)] px-4 py-3 sm:px-5 sm:py-3.5 ">
              <button
                type="button"
                className="or-g50-btn or-g50-btn-secondary"
                onClick={() => setBankOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="or-g50-btn or-g50-btn-primary"
                onClick={() => void bindSelectedQuestions()}
              >
                <Plus className="h-4 w-4" />
                <span>{t("bindToNode")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
