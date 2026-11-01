import { Dispatch, FormEvent, SetStateAction } from "react";
import { Bot, CheckCircle2, Download, FileUp, Send, Sparkles, Upload } from "lucide-react";
import type { ClassRecord, SchoolAiSettings, SchoolImportKind } from "../../../../platform/auth";
import type {
  PendingSchoolAiImport,
  SchoolAiMessage,
} from "../hooks/useSchoolWorkspaceData";
import "../../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../../components/ui/select";

type SchoolAiPanelProps = {
  aiSettings: SchoolAiSettings | null;
  schoolAiMessages: SchoolAiMessage[];
  schoolAiInput: string;
  setSchoolAiInput: Dispatch<SetStateAction<string>>;
  schoolAiBusy: boolean;
  submitSchoolAi: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  setSchoolAiEnabled: (enabled: boolean) => Promise<void>;
  schoolAiImportKind: SchoolImportKind;
  setSchoolAiImportKind: Dispatch<SetStateAction<SchoolImportKind>>;
  studentClassId: string;
  setStudentClassId: Dispatch<SetStateAction<string>>;
  classChoices: ClassRecord[];
  schoolAiImportFile: File | null;
  setSchoolAiImportFile: Dispatch<SetStateAction<File | null>>;
  pendingSchoolAiImport: PendingSchoolAiImport | null;
  setPendingSchoolAiImport: Dispatch<SetStateAction<PendingSchoolAiImport | null>>;
  downloadTemplate: (kind: SchoolImportKind) => Promise<void>;
  confirmSchoolAiImport: (accepted: boolean) => Promise<void>;
  runSchoolAiImport: () => Promise<void>;
};

export function SchoolAiPanel({
  aiSettings,
  schoolAiMessages,
  schoolAiInput,
  setSchoolAiInput,
  schoolAiBusy,
  submitSchoolAi,
  busy,
  setSchoolAiEnabled,
  schoolAiImportKind,
  setSchoolAiImportKind,
  studentClassId,
  setStudentClassId,
  classChoices,
  schoolAiImportFile,
  setSchoolAiImportFile,
  pendingSchoolAiImport,
  setPendingSchoolAiImport,
  downloadTemplate,
  confirmSchoolAiImport,
  runSchoolAiImport,
}: SchoolAiPanelProps) {
  return (
    <section
      data-testid="school-ai-panel"
      className="or-g53-card grid h-[calc(100vh-9rem)] min-h-[34rem] max-h-[52rem] overflow-hidden grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)] xl:grid-rows-none xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="flex min-h-0 flex-col">
        <div className="flex items-start gap-3 border-b border-or-outline bg-or-block/50 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-or-primary text-or-on-primary shadow-sm">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-or-text sm:text-base">学校 AI 助手</h2>
            <p className="mt-0.5 text-xs sm:text-sm leading-5 sm:leading-6 text-or-muted">
              直接读取本校教师、学生、班级和分配数据，亦可协助审核导入文件。
            </p>
          </div>
        </div>
        <div data-testid="school-ai-messages" className="min-h-0 flex-1 space-y-3 sm:space-y-3.5 overflow-y-auto bg-or-block p-3.5 sm:p-5">
          {schoolAiMessages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-or-outline bg-or-card p-4 sm:p-6 text-xs sm:text-sm leading-5 sm:leading-6 text-or-muted">
              可以直接提问：“有哪些教师名字”、“哪些班级没有老师”、“导入学生模板字段是什么”。AI 将基于当前学校数据为您解答。
            </div>
          ) : (
            schoolAiMessages.map((item, index) => (
              <div
                key={`${item.role}:${index}`}
                className={`flex gap-2.5 sm:gap-3 ${item.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {item.role !== "user" ? (
                  <div className="mt-1 flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-xl bg-or-primary text-or-on-primary shadow-sm">
                    <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                ) : null}
                <div
                  className={`max-w-[88%] sm:max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm leading-5 sm:leading-6 shadow-sm ${
                    item.role === "user"
                      ? "bg-or-primary text-or-on-primary"
                      : item.role === "system"
                        ? "or-g53-warning-surface"
                        : "border border-or-outline/90 bg-or-card text-or-text"
                  }`}
                >
                  {item.content}
                  {item.source ? <div className="mt-1.5 text-[11px] font-mono opacity-60">source: {item.source}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
        <form onSubmit={(event) => void submitSchoolAi(event)} className="border-t border-or-outline bg-or-card p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              className="or-g53-input min-h-[4.25rem] sm:min-h-20 text-xs sm:text-sm"
              placeholder="询问教师导入、学生账号、班级管理或教师分配"
              value={schoolAiInput}
              onChange={(event) => setSchoolAiInput(event.target.value)}
              disabled={!aiSettings?.ai_available || !aiSettings?.ai_enabled || schoolAiBusy}
            />
            <button
              type="submit"
              disabled={!schoolAiInput.trim() || !aiSettings?.ai_available || !aiSettings?.ai_enabled || schoolAiBusy}
              className="or-g53-btn-primary w-full sm:w-auto self-end px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4 shrink-0" />
              发送
            </button>
          </div>
        </form>
      </div>
      <aside className="space-y-3.5 sm:space-y-4 border-t border-or-outline bg-or-card p-3.5 sm:p-5 overflow-y-auto xl:border-l xl:border-t-0">
        <div className="rounded-2xl border border-or-outline bg-or-block/80 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs sm:text-sm font-semibold text-or-text">AI 开关</h3>
              <p className="mt-0.5 text-xs leading-5 text-or-muted">
                {!aiSettings
                  ? "正在读取状态"
                  : !aiSettings.ai_available
                    ? "管理员尚未配置 AI API"
                    : aiSettings.ai_enabled
                      ? "学校与教师端可使用 AI"
                      : "当前学校已关闭 AI"}
              </p>
            </div>
            <input
              data-testid="school-ai-toggle"
              type="checkbox"
              className="h-4 w-4 rounded accent-or-primary focus:ring-or-focus"
              checked={Boolean(aiSettings?.ai_enabled)}
              disabled={busy || !aiSettings || (!aiSettings.ai_available && !aiSettings.ai_enabled)}
              onChange={(event) => void setSchoolAiEnabled(event.target.checked)}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-or-outline p-3.5 sm:p-4">
          <div className="mb-3 sm:mb-3.5 flex items-center gap-2">
            <FileUp className="h-4 w-4 text-or-muted" />
            <h3 className="text-xs sm:text-sm font-semibold text-or-text">AI 文件导入审核</h3>
          </div>
          <div className="space-y-2.5 sm:space-y-3">
            <AppSelect
              data-testid="school-ai-import-kind"
              className="or-g53-select w-full text-xs sm:text-sm"
              value={schoolAiImportKind}
              onValueChange={(value) => {
                setSchoolAiImportKind(value as SchoolImportKind);
                setPendingSchoolAiImport(null);
              }}
            >
              <option value="all">一次导入全部学校数据</option>
              <option value="students">导入学生</option>
              <option value="teachers">导入教师</option>
              <option value="classes">导入班级</option>
              <option value="assignments">导入教师班级分配</option>
            </AppSelect>
            {schoolAiImportKind === "students" ? (
              <AppSelect
                className="or-g53-select w-full text-xs sm:text-sm"
                value={studentClassId}
                onValueChange={(value) => setStudentClassId(value)}
              >
                <option value="">不指定班级</option>
                {classChoices.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </AppSelect>
            ) : null}
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-or-outline bg-or-card px-3 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-or-text transition hover:border-or-outline hover:bg-or-block">
              <Upload className="h-4 w-4 shrink-0 text-or-muted" />
              <span className="truncate">{schoolAiImportFile ? schoolAiImportFile.name : "选择 JSON / Excel"}</span>
              <input
                data-testid="school-ai-import-file"
                className="sr-only"
                type="file"
                accept=".json,.xlsx"
                onChange={(event) => {
                  setSchoolAiImportFile(event.target.files?.[0] ?? null);
                  setPendingSchoolAiImport(null);
                }}
              />
            </label>
            <div className="rounded-xl bg-or-block/80 p-2.5 sm:p-3 text-xs leading-5 text-or-muted">
              {schoolAiImportKind === "all"
                ? "完整模板包含 classes、teachers、students、assignments 四个工作表；AI 审核后一次确认即可全部导入。"
                : "上传后会按对应模板字段审核，确认后写入当前学校数据。"}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadTemplate(schoolAiImportKind)}
              className="or-g53-btn-tonal w-full py-2 text-xs font-semibold"
            >
              <Download className="h-4 w-4 shrink-0" />
              下载当前导入模板
            </button>
            {pendingSchoolAiImport ? (
              <div
                data-testid="school-ai-import-confirm-card"
                className="or-g53-warning-surface rounded-2xl p-3 sm:p-3.5 text-xs sm:text-sm"
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-or-success" />
                  <div className="min-w-0">
                    <p className="font-semibold text-or-text">AI import review</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-or-text">{pendingSchoolAiImport.review.review}</p>
                    <p className="mt-2 text-xs font-medium text-or-muted">
                      {pendingSchoolAiImport.file.name} / {pendingSchoolAiImport.review.row_count} rows
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5">
                  <button
                    type="button"
                    data-testid="school-ai-import-cancel"
                    disabled={schoolAiBusy}
                    onClick={() => void confirmSchoolAiImport(false)}
                    className="or-g53-btn-tonal py-1.5 text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    data-testid="school-ai-import-confirm"
                    disabled={schoolAiBusy}
                    onClick={() => void confirmSchoolAiImport(true)}
                    className="or-g53-btn-primary py-1.5 text-xs font-semibold"
                  >
                    确认导入
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              data-testid="school-ai-import-run"
              disabled={!schoolAiImportFile || schoolAiBusy}
              onClick={() => void runSchoolAiImport()}
              className="or-g53-btn-primary w-full py-2 sm:py-2.5 text-xs sm:text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              审核并导入
            </button>
          </div>
        </div>
      </aside>
    </section>
  );
}
