export type ContentItemScope = "compose" | "paper";

export const CONTENT_ITEM_MIME = "application/x-or-content-item";
export const CONTENT_ITEMS_MIME = "application/x-or-content-items";

export function setContentItemDragData(
  dataTransfer: Pick<DataTransfer, "setData">,
  scope: ContentItemScope,
  itemId: string,
  selectedIds: string[],
) {
  const ids = selectedIds.includes(itemId)
    ? [...new Set(selectedIds)]
    : [itemId];
  dataTransfer.setData(CONTENT_ITEMS_MIME, JSON.stringify({ scope, ids }));
  // Keep the old single-item contract available to older drop targets.
  dataTransfer.setData(CONTENT_ITEM_MIME, JSON.stringify({ scope, id: itemId }));
}

export function parseContentItemsDragData(raw: string, scope: ContentItemScope): string[] {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("无法识别拖动的内容");
  const payload = value as { scope?: unknown; ids?: unknown };
  if (payload.scope !== scope || !Array.isArray(payload.ids) || payload.ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("无法识别拖动的内容");
  }
  const ids = [...new Set(payload.ids as string[])];
  if (ids.length === 0) throw new Error("无法识别拖动的内容");
  return ids;
}
