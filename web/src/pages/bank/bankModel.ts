import { type QuestionGroupJson } from "../../components/bankEditorTypes";
import { isChoiceQuestionType } from "../../lib/questionTypes";

export type BankReadDiagnostic = {
  storage_path: string;
  code: string;
  message: string;
};

/** 新建题组时生成一条占位小题（与后端 QuestionGroupRecord 一致） */
export function defaultItemsForNewGroup(unifiedUi: string, subStem: string): QuestionGroupJson["items"] {
  if (unifiedUi === "mixed") {
    return [
      {
        type: "single_choice",
        content: subStem,
        options: { A: "", B: "", C: "", D: "" },
        answer: "A",
        analysis: "",
        metadata: {},
      },
    ];
  }
  if (isChoiceQuestionType(unifiedUi)) {
    return [{ content: subStem, options: { A: "", B: "", C: "", D: "" }, answer: "A", analysis: "", metadata: {} }];
  }
  if (unifiedUi === "fill") {
    return [{ content: subStem, answer: "", analysis: "", metadata: {} }];
  }
  if (unifiedUi === "judge") {
    return [{ content: subStem, answer: "T", analysis: "", metadata: {} }];
  }
  return [{ content: subStem, answer: "", analysis: "", metadata: {} }];
}

export type BankListItem = {
  id: string;
  qualified_id: string;
  collection: string;
  subject?: string;
  collection_name?: string;
  type: string;
  content_preview: string;
  answer_relation_needs_review?: boolean;
  metadata: Record<string, unknown>;
  storage_path: string;
  storage_kind: string;
  group_id?: string | null;
  group_member_qualified_ids?: string[];
  group_material?: string | null;
};

export type BankCollectionRow = {
  id: string;
  label: string;
  subject: string;
  collection: string;
};

export type BankFolders = {
  folders: string[];
  assignments: Record<string, string>;
};

export type BankFolderValidationResult = {
  ok: boolean;
  reason?: string;
};

/**
 * 校验题库虚拟文件夹路径：
 * - 允许根目录为空字符串（若 options.allowRoot 为 true）
 * - 最多 240 字符，最多 12 层
 * - 以 / 分隔，段名不能包含空段、.、..，首尾不可有空格
 * - 不包含 Windows/Linux 文件系统非法字符 (\:*?"<>| 以及控制字符)
 */
export function validateBankFolderPath(
  value: string,
  options?: { allowRoot?: boolean },
): BankFolderValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    if (options?.allowRoot) return { ok: true };
    return { ok: false, reason: "目录路径不能为空" };
  }
  if (trimmed.length > 240) {
    return { ok: false, reason: "目录路径长度不能超过 240 字符" };
  }
  const parts = trimmed.split("/");
  if (parts.length > 12) {
    return { ok: false, reason: "目录层级最多支持 12 层" };
  }
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      return { ok: false, reason: "目录路径无效：使用 / 分隔子目录，不允许空名称、.. 或特殊字符" };
    }
    if (part !== part.trim()) {
      return { ok: false, reason: "目录路径无效：子目录名称首尾不允许包含空格" };
    }
  }
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    const ch = trimmed[i];
    if (code < 32 || "\\:*?\"<>|".includes(ch)) {
      return { ok: false, reason: "目录路径无效：使用 / 分隔子目录，不允许空名称、.. 或特殊字符" };
    }
  }
  return { ok: true };
}

/** 判断 candidate 是否是 parent 自身或其子目录 */
export function isDescendantOrSelfFolder(candidate: string, parent: string): boolean {
  if (!parent) return false;
  return candidate === parent || candidate.startsWith(parent + "/");
}

/**
 * 校验文件夹移动合法性：
 * - 不能将自身移到自身或自身子目录中
 * - 目标父目录不能已失效（若非根目录，必须存在于已有的 folders 中）
 * - 路径格式必须合法
 */
export function canMoveBankFolder(
  sourceFolder: string,
  targetParent: string,
  existingFolders: readonly string[] | Set<string>,
): BankFolderValidationResult {
  const source = sourceFolder.trim();
  const parent = targetParent.trim();
  if (!source) {
    return { ok: false, reason: "请选择要移动的源目录" };
  }
  const folderSet = existingFolders instanceof Set ? existingFolders : new Set(existingFolders);
  if (!folderSet.has(source)) {
    return { ok: false, reason: "源目录不存在或已失效" };
  }
  const parentValid = validateBankFolderPath(parent, { allowRoot: true });
  if (!parentValid.ok) {
    return parentValid;
  }
  if (isDescendantOrSelfFolder(parent, source)) {
    return { ok: false, reason: "不能将目录移到自身或子目录中" };
  }
  if (parent && !folderSet.has(parent)) {
    return { ok: false, reason: "目标目录不存在" };
  }
  const folderName = source.includes("/") ? source.slice(source.lastIndexOf("/") + 1) : source;
  const newPath = parent ? `${parent}/${folderName}` : folderName;
  if (newPath !== source && folderSet.has(newPath)) {
    return { ok: false, reason: "目标目录下已存在同名目录，不允许合并覆盖" };
  }
  return { ok: true };
}

/**
 * 校验批量题目移动合法性：
 * - 题目列表非空，且不超过 500 题
 * - 目标目录合法且存在于已有 folders 中（或为根目录）
 */
export function canMoveBankQuestions(
  qualifiedIds: readonly string[],
  targetFolder: string,
  existingFolders: readonly string[] | Set<string>,
): BankFolderValidationResult {
  const ids = Array.from(new Set(qualifiedIds.filter(Boolean)));
  if (ids.length === 0) {
    return { ok: false, reason: "请选择 1 至 500 道题目" };
  }
  if (ids.length > 500) {
    return { ok: false, reason: "请选择 1 至 500 道题目" };
  }
  const target = targetFolder.trim();
  const targetValid = validateBankFolderPath(target, { allowRoot: true });
  if (!targetValid.ok) {
    return targetValid;
  }
  const folderSet = existingFolders instanceof Set ? existingFolders : new Set(existingFolders);
  if (target && !folderSet.has(target)) {
    return { ok: false, reason: "目标目录不存在" };
  }
  return { ok: true };
}

export type BankFolderIndex<T> = {
  children: Map<string, string[]>;
  questions: Map<string, T[]>;
  knownFolders: Set<string>;
};

/**
 * 构建文件夹树索引与题目归属映射：
 * - 排序语义：保持文件夹按稳定字典序排列
 * - 未归类题目或指向不存在文件夹的题目统一归于根目录 ""
 * - 保持题目输入顺序
 */
export function buildBankFolderIndex<T extends { qualified_id: string }>(
  data: BankFolders,
  items: readonly T[],
): BankFolderIndex<T> {
  const children = new Map<string, string[]>();
  const questions = new Map<string, T[]>();
  const knownFolders = new Set(data.folders);

  const sortedFolders = [...data.folders].sort((a, b) => a.localeCompare(b, "zh-CN"));
  for (const path of sortedFolders) {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const group = children.get(parent) ?? [];
    group.push(path);
    children.set(parent, group);
  }

  for (const item of items) {
    const assigned = data.assignments[item.qualified_id] ?? "";
    const path = knownFolders.has(assigned) ? assigned : "";
    const group = questions.get(path) ?? [];
    group.push(item);
    questions.set(path, group);
  }

  return { children, questions, knownFolders };
}
