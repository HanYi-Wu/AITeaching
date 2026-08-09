import type { PracticeHistoryRecord, PracticePublishMode } from "../platform/auth";

type Props = {
  mode: PracticePublishMode;
  history: PracticeHistoryRecord[];
  selectedIds: string[];
  loading: boolean;
  disabled?: boolean;
  onModeChange: (mode: PracticePublishMode) => void;
  onSelectionChange: (ids: string[]) => void;
};

export function AdaptivePracticeSelector({
  mode,
  history,
  selectedIds,
  loading,
  disabled,
  onModeChange,
  onSelectionChange,
}: Props) {
  const remaining = Math.max(0, 10 - selectedIds.length);
  const select = (id: string) => {
    if (mode === "wrong_questions") {
      onSelectionChange([id]);
      return;
    }
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="试卷发布类型">
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          ["current", "当前试卷", "发布正在编辑的试卷"],
          ["wrong_questions", "历史错题卷", "按学生历史错题个性化发布"],
          ["reinforcement", "专项巩固卷", "基于至少 10 份历史卷生成举一反三题"],
        ] as const).map(([value, label, description]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-md border p-3 text-sm ${
              mode === value ? "border-emerald-700 bg-white ring-1 ring-emerald-700" : "border-slate-200 bg-white"
            } ${disabled && value !== "current" ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <input
                type="radio"
                name="practice-publish-mode"
                aria-label={label}
                checked={mode === value}
                disabled={disabled && value !== "current"}
                onChange={() => {
                  onModeChange(value);
                  onSelectionChange([]);
                }}
              />
              {label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
          </label>
        ))}
      </div>

      {mode !== "current" ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800">
              {mode === "wrong_questions" ? "选择 1 份历史发布" : `已选择 ${selectedIds.length} / 至少 10 份`}
            </span>
            {mode === "reinforcement" && remaining > 0 ? (
              <span className="text-amber-700">还需选择 {remaining} 份历史试卷</span>
            ) : null}
          </div>
          <div className="mt-2 max-h-44 space-y-2 overflow-auto rounded-md border border-slate-200 bg-white p-2">
            {loading ? <p className="p-3 text-sm text-slate-500">正在读取班级历史…</p> : null}
            {!loading && history.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">该班级暂无可用历史发布记录。</p>
            ) : null}
            {!loading
              ? history.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-100 p-2 hover:bg-slate-50">
                    <input
                      className="mt-1 h-4 w-4"
                      type={mode === "wrong_questions" ? "radio" : "checkbox"}
                      aria-label={item.title}
                      name={mode === "wrong_questions" ? "wrong-question-source" : undefined}
                      checked={selectedIds.includes(item.id)}
                      onChange={() => select(item.id)}
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-medium text-slate-900">{item.title}</span>
                      <span className="block text-xs text-slate-500">
                        {item.subject || "未分科"} · {item.submitted_student_count} 人已交 · {item.wrong_answer_count} 道错题
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
