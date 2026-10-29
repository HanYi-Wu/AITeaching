import { describe, expect, it, vi } from "vitest";
import { matchesMetadataFilters, type MetadataFilters } from "../../../lib/metadataFilters";
import type { BankListItem } from "../bankModel";
import {
  filterBankList,
  filterMetadataScopeItems,
} from "./bankFilterPipeline";

function makeItem(overrides: Partial<BankListItem> = {}): BankListItem {
  const id = overrides.id ?? "q1";
  return {
    id,
    qualified_id: `数学/代数/${id}`,
    collection: "数学/代数",
    subject: "数学",
    type: "fill",
    content_preview: `内容 ${id}`,
    metadata: {},
    storage_path: `resource/数学/代数/${id}.yaml`,
    storage_kind: "single",
    ...overrides,
  };
}

function baselineFilter(
  items: BankListItem[],
  search: string,
  category: string,
  metadataFilters: MetadataFilters | null,
) {
  const query = search.trim().toLowerCase();
  return items
    .map((item) => ({
      item,
      searchText: [
        item.qualified_id,
        item.content_preview,
        item.group_id ?? "",
        item.group_material ?? "",
        JSON.stringify(item.metadata ?? {}),
      ]
        .join("\n")
        .toLowerCase(),
    }))
    .filter(({ item, searchText }) => {
      if (category !== "__all__" && String(item.metadata?.category || "未分类") !== category) {
        return false;
      }
      if (metadataFilters && !matchesMetadataFilters(item.metadata, metadataFilters)) {
        return false;
      }
      return !query || searchText.includes(query);
    })
    .map(({ item }) => item);
}

describe("bank filter pipeline", () => {
  const items = [
    makeItem({ id: "q1", type: "single_choice", content_preview: "代数练习", metadata: { category: "代数", difficulty: "高" } }),
    makeItem({ id: "q2", type: "fill", content_preview: "几何练习", metadata: { category: "几何", difficulty: "低" } }),
    makeItem({ id: "q3", type: "group", content_preview: "阅读题", group_id: "group-a", group_material: "数学阅读材料", metadata: { category: "代数", difficulty: "高" } }),
  ];

  it("keeps scope filters ordered and returns an independently mutable array", () => {
    const scope = filterMetadataScopeItems(items, "数学", "数学/代数", "group");
    expect(scope).toEqual([items[2]]);
    expect(scope[0]).toBe(items[2]);

    const allScope = filterMetadataScopeItems(items, "__all__", "__all__", "__all__");
    expect(allScope).toEqual(items);
    expect(allScope).not.toBe(items);
  });

  it("matches the existing query, category, metadata, and ordering semantics", () => {
    const cache = new WeakMap<BankListItem, string>();
    const metadataFilters: MetadataFilters = {
      difficulty: { kind: "enum", selected: ["高"] },
    };
    const cases = [
      { query: "  数学  ", category: "__all__", filters: null },
      { query: "GROUP-A", category: "代数", filters: null },
      { query: "高", category: "__all__", filters: null },
      { query: "代数", category: "代数", filters: metadataFilters },
      { query: "", category: "未分类", filters: null },
    ];

    for (const current of cases) {
      expect(
        filterBankList(items, current.query, current.category, current.filters, cache),
      ).toEqual(baselineFilter(items, current.query, current.category, current.filters));
    }
  });

  it("does not build search text until a query is present and reuses it per item", () => {
    const cache = new WeakMap<BankListItem, string>();
    const stringify = vi.spyOn(JSON, "stringify");

    expect(filterBankList(items, "", "__all__", null, cache)).toEqual(items);
    expect(stringify).not.toHaveBeenCalled();

    filterBankList(items, "代数", "__all__", null, cache);
    const callsAfterFirstSearch = stringify.mock.calls.length;
    expect(callsAfterFirstSearch).toBe(items.length);

    filterBankList(items, "数学", "__all__", null, cache);
    expect(stringify).toHaveBeenCalledTimes(callsAfterFirstSearch);
    stringify.mockRestore();
  });

  it("keeps filtered results separate from the exposed scope array", () => {
    const scope = filterMetadataScopeItems(items, "__all__", "__all__", "__all__");
    const filtered = filterBankList(scope, "", "__all__", null, new WeakMap());
    expect(filtered).toEqual(scope);
    expect(filtered).not.toBe(scope);
  });
});
