import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { deleteClass, updateClass, type ClassRecord } from "../../../../platform/auth";
import {
  IconButton,
  ImportActions,
  ManagementSection,
  Pager,
  Toolbar,
  type PageMeta,
  type PageQuery,
} from "../SchoolControls";
import type { ClassDraft } from "../hooks/useSchoolWorkspaceData";

type ClassesMainProps = {
  classes: ClassRecord[];
  classMeta: PageMeta;
  classQuery: PageQuery;
  setClassQuery: Dispatch<SetStateAction<PageQuery>>;
  classDrafts: Record<string, ClassDraft>;
  setClassDrafts: Dispatch<SetStateAction<Record<string, ClassDraft>>>;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function ClassesMainPanel({
  classes,
  classMeta,
  classQuery,
  setClassQuery,
  classDrafts,
  setClassDrafts,
  busy,
  run,
}: ClassesMainProps) {
  return (
    <ManagementSection
      title="班级管理"
      count={classMeta.total}
      controls={
        <Toolbar
          query={classQuery}
          onQueryChange={(patch) => setClassQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-2">班级</th>
              <th className="px-3 py-2">年级</th>
              <th className="px-3 py-2">学生</th>
              <th className="px-3 py-2">教师</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {classes
              .filter((klass) => classDrafts[klass.id])
              .map((klass) => {
                const draft = classDrafts[klass.id] || { name: klass.name, grade: klass.grade || "" };
                return (
                  <tr key={klass.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <input
                        className="w-52 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        value={draft.name}
                        onChange={(event) =>
                          setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, name: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        value={draft.grade}
                        onChange={(event) =>
                          setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, grade: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-600">{klass.student_count ?? 0}</td>
                    <td className="px-3 py-2 text-slate-600">{klass.teacher_count ?? 0}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <IconButton
                          label="保存班级"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await updateClass(klass.id, { name: draft.name, grade: draft.grade });
                            })
                          }
                          icon={<Save className="h-4 w-4" />}
                        />
                        <IconButton
                          label="删除班级"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await deleteClass(klass.id);
                            })
                          }
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <Pager meta={classMeta} onPage={(page) => setClassQuery((current) => ({ ...current, page }))} />
    </ManagementSection>
  );
}

type ClassesAsideProps = {
  busy: boolean;
  submitClass: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  className: string;
  setClassName: Dispatch<SetStateAction<string>>;
  grade: string;
  setGrade: Dispatch<SetStateAction<string>>;
  downloadTemplate: (kind: "classes") => Promise<void>;
  handleFile: (event: ChangeEvent<HTMLInputElement>, kind: "classes") => Promise<void>;
};

export function ClassesAsidePanel({
  busy,
  submitClass,
  className,
  setClassName,
  grade,
  setGrade,
  downloadTemplate,
  handleFile,
}: ClassesAsideProps) {
  return (
    <aside className="min-w-0 space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">创建班级</h2>
        <p className="mt-1 text-sm text-slate-500">创建班级后可以继续导入学生或分配任课教师。</p>
        <form className="mt-4 space-y-3" onSubmit={submitClass}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="班级名称，如 高一 1 班"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="年级，如 高一"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            创建班级
          </button>
        </form>
      </section>
      <ImportActions
        kind="classes"
        label="导入班级 JSON / Excel"
        testId="classes-import-file"
        onTemplate={() => void downloadTemplate("classes")}
        onChange={(event) => void handleFile(event, "classes")}
      />
    </aside>
  );
}
