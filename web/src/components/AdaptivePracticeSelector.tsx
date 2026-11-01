import { formatSubjectLabel } from "../lib/subjectLabels";
import type { PracticeHistoryRecord, PracticePublishMode } from "../platform/auth";

type Props = {
  mode: PracticePublishMode;
  history: PracticeHistoryRecord[];
  selectedIds: string[];
  maxQuestionsPerStudent: number;
  loading: boolean;
  disabled?: boolean;
  currentDisabled?: boolean;
  onModeChange: (mode: PracticePublishMode) => void;
  onSelectionChange: (ids: string[]) => void;
  onMaxQuestionsChange: (count: number) => void;
};

export function AdaptivePracticeSelector({
  mode,
  history,
  selectedIds,
  maxQuestionsPerStudent,
  loading,
  disabled,
  currentDisabled = false,
  onModeChange,
  onSelectionChange,
  onMaxQuestionsChange,
}: Props) {
  const remaining = Math.max(0, 3 - selectedIds.length);
  const select = (id: string) => {
    if (mode === "wrong_questions") {
      onSelectionChange([id]);
      return;
    }
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  return (
    <section className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-4" aria-label="试卷发布类型">
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["current", "当前试卷", "发布正在编辑的试卷"],
          ["wrong_questions", "历史错题卷", "按学生历史错题个性化发布"],
          ["reinforcement", "专项巩固卷", "基于至少 3 份历史卷生成举一反三题"],
        ] as const).map(([value, label, description]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-xl border p-3.5 text-sm transition-all duration-150 ${
              mode === value
                ? "border-[var(--or-primary)] bg-[var(--or-card)] ring-2 ring-[color-mix(in_srgb,var(--or-focus)_20%,transparent)] shadow-xs"
                : "border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] hover:border-[var(--or-outline)]"
            } ${(disabled && value !== "current") || (currentDisabled && value === "current") ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <span className="flex items-center gap-2.5 font-semibold text-[var(--or-text)]">
              <input
                type="radio"
                name="practice-publish-mode"
                aria-label={label}
                checked={mode === value}
                disabled={(disabled && value !== "current") || (currentDisabled && value === "current")}
                onChange={() => {
                  onModeChange(value);
                  onSelectionChange([]);
                }}
                className="h-4 w-4 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
              />
              {label}
            </span>
            <span className="mt-1.5 block text-[13px] leading-normal text-[var(--or-muted)]">{description}</span>
          </label>
        ))}
      </div>

      {mode !== "current" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-[var(--or-text)]">
              {mode === "wrong_questions" ? "选择 1 份历史发布" : `已选择 ${selectedIds.length} / 至少 3 份`}
            </span>
            {mode === "reinforcement" && remaining > 0 ? (
              <span className="or-g49-pill bg-[var(--or-warning-container)] text-[var(--or-on-warning)] font-medium">还需选择 {remaining} 份历史试卷</span>
            ) : null}
          </div>
          <label className="flex max-w-sm items-center justify-between gap-3 text-sm font-medium text-[var(--or-muted)]">
            <span>每名学生最多题数</span>
            <input
              type="number"
              aria-label="每名学生最多题数"
              min={1}
              max={mode === "reinforcement" ? 20 : 100}
              value={maxQuestionsPerStudent}
              onChange={(event) => {
                const ceiling = mode === "reinforcement" ? 20 : 100;
                const requested = Math.trunc(Number(event.target.value || 1));
                onMaxQuestionsChange(Math.max(1, Math.min(ceiling, Number.isFinite(requested) ? requested : 1)));
              }}
              className="or-g49-input w-24 text-right tabular-nums py-1"
            />
          </label>
          <div className="max-h-52 space-y-1.5 overflow-auto rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-2.5">
            {loading ? <p className="p-3 text-sm text-[var(--or-muted)]">正在读取班级历史…</p> : null}
            {!loading && history.length === 0 ? (
              <p className="p-3 text-sm text-[var(--or-muted)]">
                {disabled ? "请选择一个班级后读取该班级的历史发布记录。" : "该班级暂无可用历史发布记录。"}
              </p>
            ) : null}
            {!loading
              ? history.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--or-outline)] p-2.5 transition-colors hover:bg-[var(--or-page)]"
                  >
                    <input
                      className="mt-1 h-4 w-4 text-[var(--or-on-container)] focus:ring-[var(--or-focus)]"
                      type={mode === "wrong_questions" ? "radio" : "checkbox"}
                      aria-label={item.title}
                      name={mode === "wrong_questions" ? "wrong-question-source" : undefined}
                      checked={selectedIds.includes(item.id)}
                      onChange={() => select(item.id)}
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-semibold text-[var(--or-text)]">{item.title}</span>
                      <span className="mt-0.5 block text-xs text-[var(--or-muted)]">
                        {formatSubjectLabel(item.subject, "未分科")} · {item.submitted_student_count} 人已交 · {item.wrong_answer_count} 道错题
                      </span>
                    </span>
                  </label>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
