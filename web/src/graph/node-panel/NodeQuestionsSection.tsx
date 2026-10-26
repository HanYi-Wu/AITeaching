import { useTranslation } from "react-i18next";
import { KatexPlainPreview } from "../../components/KatexText";
import { QUESTION_TYPE_OPTIONS } from "../../lib/questionTypes";
import { localeCompareStrings } from "../../lib/locale";
import type { BankItemPreview, BoundQuestion } from "./types";

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
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-slate-700">{t("boundQuestions")}</h3>
      <button
        type="button"
        className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white"
        onClick={() => void openBank()}
      >
        {t("pickFromBank")}
      </button>
      {boundQuestions.length > 0 ? (
        <button
          type="button"
          className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50"
          disabled={busy || boundSel.size === 0}
          onClick={() => void unbindSelectedBound()}
        >
          {t("batchUnbind", { n: boundSel.size })}
        </button>
      ) : null}
      <ul className="space-y-1 text-xs">
        {boundQuestions.map((q) => (
          <li
            key={q.qualified_id}
            className="flex items-start gap-2 rounded border border-slate-200 bg-white p-1.5"
          >
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
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
              <div className="font-mono text-[11px]">{q.qualified_id}</div>
              {q.content_preview ? (
                <div className="mt-0.5 block w-full min-w-0">
                  <KatexPlainPreview
                    text={q.content_preview}
                    className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 text-red-600"
              onClick={() => void unbindQ(q.qualified_id)}
            >
              {t("unbind")}
            </button>
          </li>
        ))}
        {boundQuestions.length === 0 ? (
          <li className="text-slate-400">{t("noBoundQuestions")}</li>
        ) : null}
      </ul>

      {/* Bank picker modal */}
      {bankOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("pickQuestionTitle")}</h3>
              <button
                type="button"
                className="text-sm text-slate-600"
                onClick={() => setBankOpen(false)}
              >
                {t("close")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-slate-600">
                {t("collectionFilter")}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={bankNs}
                  onChange={(e) => setBankNs(e.target.value)}
                  placeholder={t("collectionPh")}
                />
              </label>
              <label className="text-[11px] font-medium text-slate-600">
                {t("subject")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  value={bankSubject}
                  onChange={(e) => setBankSubject(e.target.value)}
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
                </select>
              </label>
              <label className="text-[11px] font-medium text-slate-600">
                {t("questionType")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  value={bankType}
                  onChange={(e) => setBankType(e.target.value)}
                >
                  <option value="">{t("all")}</option>
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-medium text-slate-600">
                {t("keyword")}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={bankQ}
                  onChange={(e) => setBankQ(e.target.value)}
                  placeholder={t("keywordPh")}
                />
              </label>
            </div>
            <div className="mt-3 max-h-[40vh] overflow-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="p-2">{t("thPick")}</th>
                    <th className="p-2">{t("thQid")}</th>
                    <th className="p-2">{t("thType")}</th>
                    <th className="p-2">{t("thPreview")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBank.map((it) => (
                    <tr key={it.qualified_id} className="border-t border-slate-100">
                      <td className="p-2">
                        <input
                          type="checkbox"
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
                      <td className="p-2 font-mono">{it.qualified_id}</td>
                      <td className="p-2">{it.type}</td>
                      <td className="max-w-xs p-2 align-top text-slate-600">
                        <KatexPlainPreview
                          text={String(it.content_preview ?? "")}
                          className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setBankOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                onClick={() => void bindSelectedQuestions()}
              >
                {t("bindToNode")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
