/**
 * 纯选择集合模型与工具函数：
 * - 保持真实 qualified_id
 * - 保留单题与题组在列表中的真实身份
 * - 稳定顺序并去重
 * - 支持单选切换、全选/反选当前范围、Shift连续范围多选、框选汇合
 */

/** 保留初次出现顺序去重 */
export function dedupeSelection(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** 单选切换：已选中则移除，未选中则追加到末尾 */
export function toggleSingleSelection(currentSelection: readonly string[], id: string): string[] {
  if (!id) return [...currentSelection];
  if (currentSelection.includes(id)) {
    return currentSelection.filter((x) => x !== id);
  }
  return [...currentSelection, id];
}

export { rangeSelection } from "../../lib/rangeSelection";

/**
 * 针对当前可见或目标集合进行全选/反选：
 * - 若 targetIds 全部已在当前选择中：从选择集中剔除 targetIds（保留其余已选项，支持跨目录/跨筛选累积）
 * - 否则：保留已有选择，并将尚未选中的 targetIds 追加到选择集中
 */
export function toggleFolderOrFilteredSelection(
  currentSelection: readonly string[],
  targetIds: readonly string[],
): string[] {
  if (!targetIds.length) return [...currentSelection];
  const currentSet = new Set(currentSelection);
  const allSelected = targetIds.every((id) => currentSet.has(id));
  if (allSelected) {
    const targetSet = new Set(targetIds);
    return currentSelection.filter((id) => !targetSet.has(id));
  }
  const added = targetIds.filter((id) => !currentSet.has(id));
  return [...currentSelection, ...added];
}

/**
 * 框选汇合：
 * - 将框选命中的 hitIds 追加合并到 baseSelection 中，保持顺序并去重
 */
export function boxSelection(baseSelection: readonly string[], hitIds: readonly string[]): string[] {
  return dedupeSelection([...baseSelection, ...hitIds]);
}

/**
 * 筛选校验选择集：剔除已不存在于 validIds 中的过期题目，保留尚有效项目
 */
export function pruneStaleSelection(
  currentSelection: readonly string[],
  validIds: Set<string> | readonly string[],
): { valid: string[]; stale: string[] } {
  const validSet = validIds instanceof Set ? validIds : new Set(validIds);
  const valid: string[] = [];
  const stale: string[] = [];
  for (const id of currentSelection) {
    if (validSet.has(id)) {
      valid.push(id);
    } else {
      stale.push(id);
    }
  }
  return { valid, stale };
}

export type BankOperationTargetSnapshot = {
  target: string;
  qualified_ids: string[];
};

/** 捕获操作目标快照，防止等待确认或网络延迟期间被篡改 */
export function snapshotOperationTarget(
  target: string,
  qualified_ids: readonly string[],
): BankOperationTargetSnapshot {
  return {
    target,
    qualified_ids: [...qualified_ids],
  };
}

