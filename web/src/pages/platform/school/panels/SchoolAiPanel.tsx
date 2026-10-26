import { Dispatch, FormEvent, SetStateAction } from "react";
import { Bot, CheckCircle2, Download, FileUp, Send, Sparkles, Upload } from "lucide-react";
import type { ClassRecord, SchoolAiSettings, SchoolImportKind } from "../../../../platform/auth";
import type {
  PendingSchoolAiImport,
  SchoolAiMessage,
} from "../hooks/useSchoolWorkspaceData";

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
      className="grid h-[calc(100vh-9rem)] min-h-[34rem] max-h-[52rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="flex min-h-0 flex-col">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">学校 AI 助手</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              直接读取本校教师、学生、班级和分配数据，也可以审核导入 JSON/Excel 文件。
            </p>
          </div>
        </div>
        <div data-testid="school-ai-messages" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {schoolAiMessages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm leading-6 text-slate-500">
              可以直接问“有哪些教师名字”“哪些班级没有老师”“导入学生模板字段是什么”。AI 会基于当前学校数据回答。
            </div>
          ) : (
            schoolAiMessages.map((item, index) => (
              <div
                key={`${item.role}:${index}`}
                className={`flex gap-3 ${item.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {item.role !== "user" ? (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                    <Bot className="h-4 w-4" />
                  </div>
                ) : null}
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-6 shadow-sm ${
                    item.role === "user"
                      ? "bg-slate-900 text-white"
                      : item.role === "system"
                        ? "border border-amber-200 bg-amber-50 text-amber-900"
                        : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {item.content}
                  {item.source ? <div className="mt-2 text-xs opacity-60">source: {item.source}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
        <form onSubmit={(event) => void submitSchoolAi(event)} className="border-t border-slate-200 bg-white p-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="询问教师导入、学生账号、班级管理或教师分配"
              value={schoolAiInput}
              onChange={(event) => setSchoolAiInput(event.target.value)}
              disabled={!aiSettings?.ai_available || !aiSettings?.ai_enabled || schoolAiBusy}
            />
            <button
              type="submit"
              disabled={!schoolAiInput.trim() || !aiSettings?.ai_available || !aiSettings?.ai_enabled || schoolAiBusy}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              发送
            </button>
          </div>
        </form>
      </div>
      <aside className="space-y-4 border-t border-slate-200 bg-white p-4 xl:border-l xl:border-t-0">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">AI 开关</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
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
              className="h-4 w-4"
              checked={Boolean(aiSettings?.ai_enabled)}
              disabled={busy || !aiSettings || (!aiSettings.ai_available && !aiSettings.ai_enabled)}
              onChange={(event) => void setSchoolAiEnabled(event.target.checked)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileUp className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-950">AI 文件导入审核</h3>
          </div>
          <div className="space-y-3">
            <select
              data-testid="school-ai-import-kind"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={schoolAiImportKind}
              onChange={(event) => {
                setSchoolAiImportKind(event.target.value as SchoolImportKind);
                setPendingSchoolAiImport(null);
              }}
            >
              <option value="all">一次导入全部学校数据</option>
              <option value="students">导入学生</option>
              <option value="teachers">导入教师</option>
              <option value="classes">导入班级</option>
              <option value="assignments">导入教师班级分配</option>
            </select>
            {schoolAiImportKind === "students" ? (
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={studentClassId}
                onChange={(event) => setStudentClassId(event.target.value)}
              >
                <option value="">不指定班级</option>
                {classChoices.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Upload className="h-4 w-4" />
              {schoolAiImportFile ? schoolAiImportFile.name : "选择 JSON / Excel"}
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
            <div className="rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              {schoolAiImportKind === "all"
                ? "完整模板包含 classes、teachers、students、assignments 四个工作表；AI 审核后一次确认即可全部导入。"
                : "上传后会按对应模板字段审核，确认后写入当前学校数据。"}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadTemplate(schoolAiImportKind)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              下载当前导入模板
            </button>
            {pendingSchoolAiImport ? (
              <div
                data-testid="school-ai-import-confirm-card"
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold">AI import review</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{pendingSchoolAiImport.review.review}</p>
                    <p className="mt-2 text-xs text-amber-800">
                      {pendingSchoolAiImport.file.name} / {pendingSchoolAiImport.review.row_count} rows
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="school-ai-import-cancel"
                    disabled={schoolAiBusy}
                    onClick={() => void confirmSchoolAiImport(false)}
                    className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    data-testid="school-ai-import-confirm"
                    disabled={schoolAiBusy}
                    onClick={() => void confirmSchoolAiImport(true)}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              审核并导入
            </button>
          </div>
        </div>
      </aside>
    </section>
  );
}
