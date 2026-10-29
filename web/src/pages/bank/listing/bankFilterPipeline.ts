import type { MetadataFilters } from "../../../lib/metadataFilters";
import { matchesMetadataFilters } from "../../../lib/metadataFilters";
import type { BankListItem } from "../bankModel";

export function getSearchText(
  item: BankListItem,
  cache: WeakMap<BankListItem, string>,
): string {
  let text = cache.get(item);
  if (text === undefined) {
    text = [
      item.qualified_id,
      item.content_preview,
      item.group_id ?? "",
      item.group_material ?? "",
      JSON.stringify(item.metadata ?? {}),
    ]
      .join("\n")
      .toLowerCase();
    cache.set(item, text);
  }
  return text;
}

export function filterMetadataScopeItems(
  items: readonly BankListItem[],
  filterSubject: string,
  filterCollection: string,
  filterType: string,
): BankListItem[] {
  if (
    filterSubject === "__all__" &&
    filterCollection === "__all__" &&
    filterType === "__all__"
  ) {
    return items.slice();
  }

  const result: BankListItem[] = [];
  for (const item of items) {
    if (filterSubject !== "__all__" && (item.subject ?? "") !== filterSubject) {
      continue;
    }
    if (filterCollection !== "__all__" && item.collection !== filterCollection) {
      continue;
    }
    if (filterType !== "__all__" && item.type !== filterType) {
      continue;
    }
    result.push(item);
  }
  return result;
}

export function filterBankList(
  metadataScopeItems: readonly BankListItem[],
  deferredSearch: string,
  filterCategory: string,
  activeMetadataFilters: MetadataFilters | null,
  cache: WeakMap<BankListItem, string>,
): BankListItem[] {
  const query = deferredSearch.trim().toLowerCase();
  const hasCategory = filterCategory !== "__all__";
  const hasQuery = query.length > 0;

  if (!hasCategory && !activeMetadataFilters && !hasQuery) {
    return metadataScopeItems.slice();
  }

  const result: BankListItem[] = [];
  for (const item of metadataScopeItems) {
    if (
      hasCategory &&
      String(item.metadata?.category || "未分类") !== filterCategory
    ) {
      continue;
    }
    if (
      activeMetadataFilters &&
      !matchesMetadataFilters(item.metadata, activeMetadataFilters)
    ) {
      continue;
    }
    if (hasQuery && !getSearchText(item, cache).includes(query)) {
      continue;
    }
    result.push(item);
  }
  return result;
}
