import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { deleteClass, updateClass, type ClassRecord } from "../../../../platform/auth";
import { confirmDialog } from "../../../../lib/confirmDialog";
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
import "../../../../ui-redesign/g53/g53.css";
import { useManagementCapability, useManagementDictionary } from "../../../../platform/useManagementOptions";

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
  const canWrite = useManagementCapability("school.classes.manage");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmingDeleteRef = useRef(false);
  const mountedRef = useRef(true);
  const deleteContextRef = useRef({ classes, run, busy, canWrite });
  deleteContextRef.current = { classes, run, busy, canWrite };

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirmDeleteClass = async (klass: ClassRecord) => {
    if (busy || !canWrite || confirmingDeleteRef.current) return;

    confirmingDeleteRef.current = true;
    setConfirmingDelete(true);
    try {
      const confirmed = await confirmDialog(
        `删除“${klass.name}”后，该班学生会失去当前班级归属，教师班级分配和面向该班的试卷发布关联会被清除。学生、教师、试卷以及已有考试记录和答卷会保留。此操作不可撤销，确定删除吗？`,
        "确认删除班级",
      );
      const current = deleteContextRef.current;
      if (!confirmed || !mountedRef.current || current.busy || !current.canWrite) return;
      if (!current.classes.some(({ id, name }) => id === klass.id && name === klass.name)) return;
      await current.run(async () => {
        await deleteClass(klass.id);
      });
    } finally {
      confirmingDeleteRef.current = false;
      if (mountedRef.current) setConfirmingDelete(false);
    }
  };

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
      <div className="or-g53-table-container">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="border-b border-or-outline bg-or-block text-xs font-semibold text-or-muted">
            <tr>
              <th className="px-3.5 py-2.5">班级</th>
              <th className="px-3.5 py-2.5">年级</th>
              <th className="px-3.5 py-2.5">学生</th>
              <th className="px-3.5 py-2.5">教师</th>
              <th className="px-3.5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--or-outline)]">
            {classes
              .filter((klass) => classDrafts[klass.id])
              .map((klass) => {
                const draft = classDrafts[klass.id] || { name: klass.name, grade: klass.grade || "" };
                return (
                  <tr key={klass.id} className="transition-colors hover:bg-or-block/50 align-middle">
                    <td className="px-3.5 py-2.5">
                      <input
                        className="or-g53-input w-52 py-1 text-sm font-medium"
                        value={draft.name}
                        readOnly={!canWrite}
                        onChange={(event) =>
                          setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, name: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <input
                        className="or-g53-input w-28 py-1 text-sm font-medium"
                        value={draft.grade}
                        readOnly={!canWrite}
                        onChange={(event) =>
                          setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, grade: event.target.value } }))
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5 font-medium text-or-muted">{klass.student_count ?? 0}</td>
                    <td className="px-3.5 py-2.5 font-medium text-or-muted">{klass.teacher_count ?? 0}</td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex justify-end gap-2">
                        <IconButton
                          label="保存班级"
                          disabled={busy || !canWrite}
                          onClick={() =>
                            void run(async () => {
                              await updateClass(klass.id, { name: draft.name, grade: draft.grade });
                            })
                          }
                          icon={<Save className="h-4 w-4" />}
                        />
                        <IconButton
                          label="删除班级"
                          disabled={busy || confirmingDelete || !canWrite}
                          onClick={() => void confirmDeleteClass(klass)}
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
  const dictionary = useManagementDictionary();
  const gradeListId = useId();
  return (
    <aside className="min-w-0 space-y-6">
      <section className="or-g53-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-or-text">创建班级</h2>
        <form className="mt-3 space-y-3" onSubmit={submitClass}>
          <input
            className="or-g53-input w-full text-sm"
            placeholder="班级名称，如 高一 1 班"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
          />
          <input
            className="or-g53-input w-full text-sm"
            placeholder="年级，如 高一"
            list={gradeListId}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
          <datalist id={gradeListId}>
            {dictionary?.grades.map((item) => <option key={item.id} value={item.value}>{item.label}</option>)}
          </datalist>
          <button
            type="submit"
            disabled={busy}
            className="or-g53-btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4 shrink-0" />
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
