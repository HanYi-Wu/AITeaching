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

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
const CN_DIGIT_VALUES: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Converts positive integers (1-999+) to standard Chinese ordinal text without English characters. */
export function formatChineseQuestionNumber(n: number): string {
  const num = Math.max(1, Math.floor(n));
  if (num < 10) {
    return `第${CN_DIGITS[num]}题`;
  }
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    const tensText = tens === 1 ? "十" : `${CN_DIGITS[tens]}十`;
    return ones === 0 ? `第${tensText}题` : `第${tensText}${CN_DIGITS[ones]}题`;
  }
  if (num < 1000) {
    const hundreds = Math.floor(num / 100);
    const rem = num % 100;
    if (rem === 0) {
      return `第${CN_DIGITS[hundreds]}百题`;
    }
    if (rem < 10) {
      return `第${CN_DIGITS[hundreds]}百零${CN_DIGITS[rem]}题`;
    }
    const tens = Math.floor(rem / 10);
    const ones = rem % 10;
    const mid = `${CN_DIGITS[hundreds]}百${CN_DIGITS[tens]}十${ones === 0 ? "" : CN_DIGITS[ones]}`;
    return `第${mid}题`;
  }
  return `第${num}题`;
}

function parseChinesePositiveInt(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const parsed = Number.parseInt(s, 10);
    return parsed > 0 ? parsed : null;
  }
  if (!/^[一二三四五六七八九十百零两]+$/.test(s)) return null;
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT_VALUES) {
      current = CN_DIGIT_VALUES[ch]!;
    } else if (ch === "十") {
      total += (current === 0 ? 1 : current) * 10;
      current = 0;
    } else if (ch === "百") {
      if (current === 0) return null;
      total += current * 100;
      current = 0;
    }
  }
  const value = total + current;
  return value > 0 ? value : null;
}

export function parseQuestionSequenceNumber(id: string): number | null {
  const trimmed = id.trim();
  const wrapped = trimmed.match(/^第(.+)题$/);
  if (wrapped) {
    return parseChinesePositiveInt(wrapped[1]!);
  }
  return /^\d+$/.test(trimmed) ? parseChinesePositiveInt(trimmed) : null;
}

export function extractQuestionNamespace(qualifiedId: string): string {
  const slashIdx = qualifiedId.lastIndexOf("/");
  return slashIdx >= 0 ? qualifiedId.slice(0, slashIdx) : "";
}

export function itemMatchesNamespace(
  item: Pick<BankListItem, "qualified_id" | "subject" | "collection">,
  namespaceOrSubject: string,
  collection?: string,
): boolean {
  const subj = namespaceOrSubject.trim();
  const coll = collection?.trim() ?? "";
  const ns = collection !== undefined ? (subj && coll ? `${subj}/${coll}` : subj) : subj;
  if (!ns) return true;
  if (item.qualified_id.startsWith(`${ns}/`) || item.collection === ns) {
    return true;
  }
  if (collection !== undefined) {
    return (item.subject ?? "") === subj && (item.collection === coll || item.collection === ns);
  }
  return false;
}

export function validateQuestionIdFormat(rawId: string): string | null {
  const qid = rawId.trim();
  if (!qid) return "题号不能为空";
  if (qid.includes("/") || qid.includes("\\")) return "题号不能包含斜杠（/ 或 \\）";
  return null;
}

export function findDuplicateQuestionItem(
  items: readonly Pick<BankListItem, "id" | "qualified_id" | "subject" | "collection" | "group_member_qualified_ids">[],
  namespaceOrSubject: string,
  collectionOrUndefined: string | undefined,
  rawQid: string,
  excludeQualifiedId?: string | null,
): Pick<BankListItem, "id" | "qualified_id" | "subject" | "collection" | "group_member_qualified_ids"> | null {
  const qid = rawQid.trim();
  if (!qid) return null;
  const qidFold = qid.toLocaleLowerCase();
  const subj = namespaceOrSubject.trim();
  const coll = collectionOrUndefined?.trim() ?? "";
  const ns = collectionOrUndefined !== undefined ? (subj && coll ? `${subj}/${coll}` : subj) : subj;
  const fullFold = (ns ? `${ns}/${qid}` : qid).toLocaleLowerCase();

  for (const item of items) {
    if (excludeQualifiedId && item.qualified_id === excludeQualifiedId) {
      continue;
    }
    const inSameScope = itemMatchesNamespace(item, namespaceOrSubject, collectionOrUndefined);
    if (!inSameScope && item.qualified_id.toLocaleLowerCase() !== fullFold) {
      continue;
    }
    if (
      item.id.trim().toLocaleLowerCase() === qidFold ||
      item.qualified_id.toLocaleLowerCase() === fullFold
    ) {
      return item;
    }
    if (
      item.group_member_qualified_ids?.some(
        (memberQid) => memberQid.split("/").at(-1)?.trim().toLocaleLowerCase() === qidFold,
      )
    ) {
      return item;
    }
  }
  return null;
}

export function validateQuestionIdInCollection(params: {
  items: readonly Pick<BankListItem, "id" | "qualified_id" | "subject" | "collection" | "group_member_qualified_ids">[];
  subject: string;
  collection?: string;
  rawId: string;
  excludeQualifiedId?: string | null;
  groupMemberCount?: number;
}): string | null {
  const formatError = validateQuestionIdFormat(params.rawId);
  if (formatError) return formatError;
  const qid = params.rawId.trim();
  const dup = findDuplicateQuestionItem(
    params.items,
    params.subject,
    params.collection,
    qid,
    params.excludeQualifiedId,
  );
  if (dup) {
    return `题号“${qid}”已存在，请使用其他题号`;
  }
  if ((params.groupMemberCount ?? 0) > 0) {
    for (let idx = 1; idx <= (params.groupMemberCount ?? 0); idx += 1) {
      const memberId = `${qid}__${String(idx).padStart(2, "0")}`;
      if (
        findDuplicateQuestionItem(
          params.items,
          params.subject,
          params.collection,
          memberId,
          params.excludeQualifiedId,
        )
      ) {
        return `题组编号“${qid}”的小题标识“${memberId}”与现有题号冲突`;
      }
    }
  }
  return null;
}

/**
 * Generates the next sequential Chinese question ID (第一题, 第二题, ...)
 * within the target subject + collection scope without colliding with existing items.
 */
export function nextSequentialQuestionId(
  items: readonly Pick<BankListItem, "id" | "qualified_id" | "subject" | "collection">[],
  subject: string,
  collection: string,
): string {
  const subj = subject.trim();
  const coll = collection.trim();
  const targetNs = subj && coll ? `${subj}/${coll}` : "";

  const scoped = targetNs ? items.filter((item) => itemMatchesNamespace(item, subj, coll)) : items;

  const usedIds = new Set(scoped.map((item) => item.id.trim().toLocaleLowerCase()));
  let maxNumber = 0;
  for (const item of scoped) {
    const n = parseQuestionSequenceNumber(item.id);
    if (n !== null && n > maxNumber) {
      maxNumber = n;
    }
  }

  let candidateIndex = Math.max(maxNumber, scoped.length) + 1;
  while (candidateIndex < 100_000) {
    const candidate = formatChineseQuestionNumber(candidateIndex);
    const fullTarget = (targetNs ? `${targetNs}/${candidate}` : candidate).toLocaleLowerCase();
    if (
      !usedIds.has(candidate.toLocaleLowerCase()) &&
      !items.some((item) => item.qualified_id.toLocaleLowerCase() === fullTarget)
    ) {
      return candidate;
    }
    candidateIndex += 1;
  }
  return formatChineseQuestionNumber(scoped.length + 1);
}
