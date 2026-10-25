import { useEffect, useRef, useState } from "react";
import { dispatchExamsChanged } from "../../lib/examEvents";
import {
  listTeacherAssignedClasses, listTeacherClassStudents, listClassPracticeHistory,
  publishPlatformPaper, publishReinforcementPractice, publishWrongQuestionPractice,
  syncPlatformPaperFromExam, listContentFolders, createContentFolder, updateContentFolder,
  type ContentFolder, type PracticeHistoryRecord, type PracticePublishMode,
  type PaperSubmissionMode, type TeacherClassRecord, type TeacherClassStudentRecord,
} from "../../platform/auth";
import type { ExamDoc } from "../../types/compose";
import type { PublishOnlineDialogProps } from "./PublishOnlineDialog";
import { useComposeRequestScope } from "./useComposeRequestScope";

export function useComposePublishing(params: {
  open: boolean; setOpen: (open: boolean) => void; ownerKey: string; exportLabel: string; countsOk: boolean;
  persistDraftForPublish: () => Promise<ExamDoc | null>; onError: (message: string | null) => void;
  setMsg: (message: string | null) => void;
}) {
  const { open: publishDialogOpen, setOpen: setPublishDialogOpen, ownerKey, exportLabel, countsOk, persistDraftForPublish, onError, setMsg } = params;
  const capture = useComposeRequestScope(ownerKey);
  const [publishClasses, setPublishClasses] = useState<TeacherClassRecord[]>([]);
  const [publishClassIds, setPublishClassIds] = useState<string[]>([]);
  const [publishFolders, setPublishFolders] = useState<ContentFolder[]>([]);
  const [publishFolderId, setPublishFolderId] = useState("");
  const [publishRecipientScope, setPublishRecipientScope] = useState<"class" | "student">("class");
  const [publishStudents, setPublishStudents] = useState<TeacherClassStudentRecord[]>([]);
  const [publishStudentIds, setPublishStudentIds] = useState<string[]>([]);
  const [publishStudentSearch, setPublishStudentSearch] = useState("");
  const [publishNewFolderName, setPublishNewFolderName] = useState("");
  const [publishSubmissionMode, setPublishSubmissionMode] = useState<PaperSubmissionMode>("online");
  const [publishMaxScreenSwitches, setPublishMaxScreenSwitches] = useState(0);
  const [publishStartAt, setPublishStartAt] = useState("");
  const [publishEndAt, setPublishEndAt] = useState("");
  const [publishTimeLimitMinutes, setPublishTimeLimitMinutes] = useState(0);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMode, setPublishMode] = useState<PracticePublishMode>("current");
  const [practiceHistory, setPracticeHistory] = useState<PracticeHistoryRecord[]>([]);
  const [practiceSourceIds, setPracticeSourceIds] = useState<string[]>([]);
  const [practiceMaxQuestionsPerStudent, setPracticeMaxQuestionsPerStudent] = useState(20);
  const [practiceHistoryLoading, setPracticeHistoryLoading] = useState(false);
  const previousOwner = useRef(ownerKey);
  useEffect(() => {
    if (previousOwner.current === ownerKey) return;
    previousOwner.current = ownerKey;
    setPublishDialogOpen(false); setPublishBusy(false); setPublishClassIds([]);
    setPublishClasses([]); setPublishFolders([]); setPublishStudents([]);
    setPublishStudentIds([]); setPracticeHistory([]); setPracticeSourceIds([]);
  }, [ownerKey, setPublishDialogOpen]);
  async function openPublishDialog() {
    const isCurrent = capture();
    setPublishBusy(true);
    onError(null);
    try {
      const [data, folderData] = await Promise.all([listTeacherAssignedClasses(), listContentFolders("paper")]);
      if (!isCurrent()) return;
      setPublishClasses(data.classes);
      setPublishFolders(folderData.folders);
      setPublishFolderId("");
      setPublishRecipientScope("class");
      setPublishStudentIds([]);
      setPublishClassIds([]);
      setPublishSubmissionMode("online");
      setPublishMaxScreenSwitches(0);
      setPublishStartAt("");
      setPublishEndAt("");
      setPublishTimeLimitMinutes(0);
      setPublishMode("current");
      setPracticeHistory([]);
      setPracticeSourceIds([]);
      setPracticeMaxQuestionsPerStudent(20);
      setPublishDialogOpen(true);
    } catch (e) {
      if (isCurrent()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setPublishBusy(false);
    }
  }

  useEffect(() => {
    if (!publishDialogOpen || publishClassIds.length !== 1) {
      setPracticeHistory([]);
      setPracticeSourceIds([]);
      if (publishClassIds.length > 1) setPublishMode("current");
      return;
    }
    let cancelled = false;
    setPracticeHistoryLoading(true);
    void listClassPracticeHistory(publishClassIds[0])
      .then((data) => {
        if (!cancelled) setPracticeHistory(data.publications);
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPracticeHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, publishClassIds, publishDialogOpen]);

  useEffect(() => {
    if (!publishDialogOpen || publishRecipientScope !== "student" || publishClassIds.length !== 1) { setPublishStudents([]); return; }
    let active = true;
    void listTeacherClassStudents(publishClassIds[0]).then(({ students }) => { if (active) setPublishStudents(students); }).catch((error) => { if (active) onError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [publishDialogOpen, publishRecipientScope, publishClassIds, onError]);

  function togglePublishClass(classId: string) {
    if (publishRecipientScope === "student") { setPublishClassIds([classId]); setPublishStudentIds([]); return; }
    setPublishClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  async function publishCurrentPaperOnline() {
    if (publishClassIds.length === 0) {
      onError("请先选择要发布的班级");
      return;
    }
    if (!publishFolderId) { onError("发布前请选择试卷文件夹或归类文件夹"); return; }
    if (publishRecipientScope === "student" && (publishStudentIds.length === 0 || publishFolders.find((folder) => folder.id === publishFolderId)?.kind !== "paper")) { onError("指定学生发布须选择学生和试卷文件夹"); return; }
    const isCurrent = capture();
    setPublishBusy(true);
    onError(null);
    try {
      const adaptiveSettings = {
        class_id: publishClassIds[0],
        title:
          exportLabel.trim() ||
          (publishMode === "wrong_questions" ? "历史错题巩固" : publishMode === "reinforcement" ? "专项巩固" : "在线试卷"),
        start_at: publishStartAt || null,
        end_at: publishEndAt || null,
        submission_mode: publishSubmissionMode,
        max_screen_switches: publishMaxScreenSwitches,
        time_limit_minutes: publishTimeLimitMinutes > 0 ? publishTimeLimitMinutes : null,
      };
      if (publishMode === "wrong_questions") {
        if (publishClassIds.length !== 1 || practiceSourceIds.length !== 1) {
          throw new Error("历史错题卷需要选择一个班级和一份历史试卷");
        }
        const result = await publishWrongQuestionPractice({
          ...adaptiveSettings,
          source_publication_id: practiceSourceIds[0],
          max_questions_per_student: practiceMaxQuestionsPerStudent,
        });
        if (!isCurrent()) return;
      setMsg(`历史错题卷已发布：${result.assigned_student_count} 人收到，${result.skipped_student_count} 人无错题`);
        setPublishDialogOpen(false);
        return;
      }
      if (publishMode === "reinforcement") {
        if (publishClassIds.length !== 1 || practiceSourceIds.length < 3) {
          throw new Error("专项巩固卷需要选择一个班级和至少 3 份历史试卷");
        }
        const result = await publishReinforcementPractice({
          ...adaptiveSettings,
          source_publication_ids: practiceSourceIds,
          questions_per_student: practiceMaxQuestionsPerStudent,
        });
        if (!isCurrent()) return;
      setMsg(
          `专项巩固卷已发布：${result.assigned_student_count} 人收到，AI 使用 ${result.generation.total_tokens} tokens`,
        );
        setPublishDialogOpen(false);
        return;
      }
      if (!countsOk) {
        throw new Error("当前试卷题量尚未满足模板要求；可改选历史错题卷或专项巩固卷");
      }
      const saved = await persistDraftForPublish();
      if (!isCurrent() || !saved) return;
      const examId = String(saved.exam_id ?? "").trim();
      if (!examId) {
        throw new Error("保存试卷失败，无法取得试卷编号");
      }
      const synced = await syncPlatformPaperFromExam(examId);
      if (!isCurrent()) return;
      await publishPlatformPaper(synced.paper.paper_id, {
        class_ids: publishClassIds,
        student_ids: publishRecipientScope === "student" ? publishStudentIds : [],
        folder_id: publishFolderId,
        title: exportLabel.trim() || synced.paper.title,
        start_at: publishStartAt || null,
        end_at: publishEndAt || null,
        submission_mode: publishSubmissionMode,
        max_screen_switches: publishMaxScreenSwitches,
        time_limit_minutes: publishTimeLimitMinutes > 0 ? publishTimeLimitMinutes : null,
      });
      if (!isCurrent()) return;
      setMsg("已发布为线上答题试卷");
      setPublishDialogOpen(false);
      setPublishClassIds([]);
      dispatchExamsChanged({ examId });
    } catch (e) {
      if (isCurrent()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setPublishBusy(false);
    }
  }

  const dialogProps: PublishOnlineDialogProps = {
    open: publishDialogOpen, busy: publishBusy, countsOk, recipientScope: publishRecipientScope,
    onRecipientScopeChange: (scope) => { setPublishRecipientScope(scope); if (scope === "class") setPublishStudentIds([]); else { setPublishClassIds([]); setPublishMode("current"); } },
    folders: publishFolders, folderId: publishFolderId, onFolderIdChange: setPublishFolderId,
    onConvertCategoryFolderToPaper: (folderId) => {
      const isCurrent = capture();
      void updateContentFolder(folderId, { kind: "paper" }).then(({ folder }) => { if (isCurrent()) setPublishFolders((current) => current.map((item) => item.id === folder.id ? folder : item)); }).catch((error) => { if (isCurrent()) onError(error instanceof Error ? error.message : String(error)); });
    },
    newFolderName: publishNewFolderName, onNewFolderNameChange: setPublishNewFolderName,
    onCreateAndSelectFolder: () => {
      if (!publishNewFolderName.trim()) return;
      const isCurrent = capture();
      const parent = publishFolders.find((folder) => folder.id === publishFolderId && folder.kind === "category") ?? publishFolders.find((folder) => folder.kind === "category" && !folder.parent_id);
      void createContentFolder({ scope: "paper", name: publishNewFolderName.trim(), kind: publishRecipientScope === "student" ? "paper" : "category", parent_id: parent?.id ?? null }).then(({ folder }) => { if (!isCurrent()) return; setPublishFolders((current) => [...current, folder]); setPublishFolderId(folder.id); setPublishNewFolderName(""); }).catch((error) => { if (isCurrent()) onError(error instanceof Error ? error.message : String(error)); });
    },
    classes: publishClasses, selectedClassIds: publishClassIds, onToggleClass: togglePublishClass,
    students: publishStudents, selectedStudentIds: publishStudentIds,
    onToggleStudent: (id) => setPublishStudentIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]),
    studentSearch: publishStudentSearch, onStudentSearchChange: setPublishStudentSearch,
    publishMode, onPublishModeChange: (mode) => { setPublishMode(mode); setPracticeMaxQuestionsPerStudent(mode === "reinforcement" ? 5 : 20); },
    practiceHistory, practiceSourceIds, onPracticeSourceIdsChange: setPracticeSourceIds,
    practiceMaxQuestionsPerStudent, onPracticeMaxQuestionsChange: setPracticeMaxQuestionsPerStudent,
    practiceHistoryLoading, submissionMode: publishSubmissionMode, onSubmissionModeChange: setPublishSubmissionMode,
    maxScreenSwitches: publishMaxScreenSwitches, onMaxScreenSwitchesChange: setPublishMaxScreenSwitches,
    startAt: publishStartAt, onStartAtChange: setPublishStartAt, endAt: publishEndAt, onEndAtChange: setPublishEndAt,
    timeLimitMinutes: publishTimeLimitMinutes, onTimeLimitMinutesChange: setPublishTimeLimitMinutes,
    onCancel: () => setPublishDialogOpen(false), onConfirm: () => void publishCurrentPaperOnline(),
  };
  return { dialogProps, openPublishDialog, publishBusy };
}
