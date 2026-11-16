import { useEffect, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { PlatformUser } from "../../../platform/authTypes";
import {
  createManagementDictionaryItem,
  getManagementSettings,
  listManagementDictionary,
  updateManagementDictionaryItem,
  updateManagementSettings,
  type DictionaryCategory,
  type ManagementDictionaryItem,
  type ManagementDictionaryPayload,
  type ManagementDictionaryResponse,
  type ManagementSettingsResponse,
  type ManagementScope,
} from "../../../platform/managementApi";
import { canManage } from "../../../platform/managementAccess";
import { notifyManagementOptionsChanged } from "../../../platform/useManagementOptions";
import { loadSessionToken } from "../../../platform/session";

type Props = { user: PlatformUser; scope: ManagementScope };
type SettingsForm = { default_page_size: number | null; activity_default_days: number | null };
const CATEGORY_LABELS: Record<DictionaryCategory, string> = { subjects: "学科", grades: "年级" };
const DEFAULT_ITEM: ManagementDictionaryPayload = { category: "subjects", value: "", label: "", sort_order: 0, status: "active" };

function settingsSourceLabel(source: ManagementSettingsResponse["sources"]["default_page_size"]) {
  if (source === "builtin") return "系统内置默认";
  if (source === "platform") return "平台默认";
  return "本校设置";
}

type DictionaryCache = {
  scopeKey: string;
  byCategory: Partial<Record<DictionaryCategory, ManagementDictionaryResponse>>;
};

export function ManagementSettingsPanel({ user, scope }: Props) {
  const allowed = scope === "admin" || canManage(user, "school.settings.read");
  const canEdit = scope === "admin" || canManage(user, "school.settings.manage");
  const [settings, setSettings] = useState<ManagementSettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>({ default_page_size: null, activity_default_days: null });
  const [category, setCategory] = useState<DictionaryCategory>("subjects");
  const [dictionaryCache, setDictionaryCache] = useState<DictionaryCache>({ scopeKey: "", byCategory: {} });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  const [dictionaryNotice, setDictionaryNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ManagementDictionaryItem | null>(null);
  const [itemForm, setItemForm] = useState<ManagementDictionaryPayload>(DEFAULT_ITEM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const settingsRequestRef = useRef(0);
  const dictionaryRequestRef = useRef<Record<DictionaryCategory, number>>({ subjects: 0, grades: 0 });
  const dictionaryGenRef = useRef<Record<DictionaryCategory, number>>({ subjects: 0, grades: 0 });
  const inFlightDictionaryRef = useRef<Partial<Record<DictionaryCategory, { key: string; promise: Promise<ManagementDictionaryResponse> }>>>({});
  const scopeKey = `${user.id}:${user.school_id ?? ""}:${scope}:${loadSessionToken() ?? ""}`;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const activeCategoryRef = useRef(category);
  activeCategoryRef.current = category;
  const dictionaryKey = `${scopeKey}:${category}`;
  const activeDictionaryKeyRef = useRef(dictionaryKey);
  activeDictionaryKeyRef.current = dictionaryKey;
  const cachedDictionaries = dictionaryCache.scopeKey === scopeKey ? dictionaryCache.byCategory : {};
  const visibleDictionary = cachedDictionaries[category] ?? null;
  const inheritedSettings = settings?.inherited_settings ?? (scope === "admin"
    ? { default_page_size: 10, activity_default_days: 30 }
    : settings?.settings);

  const fetchDictionaryCategory = async (
    targetCategory: DictionaryCategory,
    options?: { silentError?: boolean; showLoading?: boolean; force?: boolean },
  ) => {
    const requestedScope = scopeKey;
    const requestedKey = `${requestedScope}:${targetCategory}`;
    const requestedSessionToken = loadSessionToken();
    const requestId = ++dictionaryRequestRef.current[targetCategory];
    if (options?.force) {
      dictionaryGenRef.current[targetCategory] += 1;
    }
    const gen = dictionaryGenRef.current[targetCategory];
    const inflightKey = `${requestedKey}:${gen}`;
    if (options?.showLoading) {
      setDictionaryLoading(true);
    }
    try {
      let pending = options?.force ? undefined : inFlightDictionaryRef.current[targetCategory];
      if (!pending || pending.key !== inflightKey) {
        const fetchPromise = listManagementDictionary(scope, targetCategory).finally(() => {
          if (inFlightDictionaryRef.current[targetCategory]?.promise === fetchPromise) {
            delete inFlightDictionaryRef.current[targetCategory];
          }
        });
        pending = { key: inflightKey, promise: fetchPromise };
        inFlightDictionaryRef.current[targetCategory] = pending;
      }
      const result = await pending.promise;
      if (
        dictionaryRequestRef.current[targetCategory] === requestId &&
        dictionaryGenRef.current[targetCategory] === gen &&
        activeScopeRef.current === requestedScope &&
        loadSessionToken() === requestedSessionToken
      ) {
        setDictionaryCache((prev) => ({
          scopeKey: requestedScope,
          byCategory: prev.scopeKey === requestedScope
            ? { ...prev.byCategory, [targetCategory]: result }
            : { [targetCategory]: result },
        }));
      }
    } catch (reason) {
      if (
        !options?.silentError &&
        dictionaryRequestRef.current[targetCategory] === requestId &&
        activeDictionaryKeyRef.current === requestedKey &&
        loadSessionToken() === requestedSessionToken
      ) {
        setDictionaryError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (
        dictionaryRequestRef.current[targetCategory] === requestId &&
        activeDictionaryKeyRef.current === requestedKey &&
        loadSessionToken() === requestedSessionToken
      ) {
        setDictionaryLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!allowed) return undefined;
    let current = true;
    const requestId = ++settingsRequestRef.current;
    const requestedSessionToken = loadSessionToken();
    setSettingsLoading(true);
    setError(null);
    getManagementSettings(scope).then((nextSettings) => {
      if (!current || settingsRequestRef.current !== requestId || activeScopeRef.current !== scopeKey || loadSessionToken() !== requestedSessionToken) return;
      setSettings(nextSettings);
      setForm({ ...nextSettings.overrides });
    }).catch((reason: unknown) => {
      if (current && settingsRequestRef.current === requestId && activeScopeRef.current === scopeKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && settingsRequestRef.current === requestId && activeScopeRef.current === scopeKey && loadSessionToken() === requestedSessionToken) setSettingsLoading(false);
    });
    return () => { current = false; };
  }, [allowed, scope, scopeKey]);

  // Prefetch the secondary category per scope so switching between 学科名称 and 年级名称 never collapses to a loading placeholder.
  useEffect(() => {
    if (!allowed) return undefined;
    const otherCategory: DictionaryCategory = activeCategoryRef.current === "subjects" ? "grades" : "subjects";
    void fetchDictionaryCategory(otherCategory, { silentError: true, showLoading: false });
    return undefined;
  }, [allowed, scope, scopeKey]);

  useEffect(() => {
    if (!allowed) return undefined;
    setDictionaryError(null);
    void fetchDictionaryCategory(category, { showLoading: visibleDictionary === null });
    return undefined;
  }, [allowed, scope, scopeKey, category]);

  async function reloadCategory(nextCategory = category) {
    await fetchDictionaryCategory(nextCategory, { showLoading: false, force: true });
  }

  async function saveSettings() {
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateManagementSettings(scope, form);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setSettings(result);
      setForm({ ...result.overrides });
      setNotice("参数已保存。");
      notifyManagementOptionsChanged();
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setBusy(false);
    }
  }

  function openItemDialog(item?: ManagementDictionaryItem) {
    const items = visibleDictionary?.items ?? [];
    const nextSortOrder = items.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;
    setEditingItem(item ?? null);
    setItemForm(item
      ? { category: item.category, value: item.value, label: item.label, sort_order: item.sort_order, status: item.status }
      : { ...DEFAULT_ITEM, category, value: "", label: "", sort_order: nextSortOrder });
    setDialogError(null);
    setDialogOpen(true);
  }

  async function toggleItemStatus(item: ManagementDictionaryItem) {
    const nextStatus = item.status === "active" ? "disabled" : "active";
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setBusy(true);
    setDictionaryError(null);
    setDictionaryNotice(null);
    try {
      await updateManagementDictionaryItem(scope, item.id, {
        category: item.category,
        label: item.label,
        sort_order: item.sort_order,
        status: nextStatus,
      });
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setDictionaryNotice(nextStatus === "active" ? `已启用“${item.label}”。` : `已停用“${item.label}”。`);
      await reloadCategory(item.category);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      notifyManagementOptionsChanged();
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) {
        setDictionaryError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setBusy(false);
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetCategory = editingItem?.category ?? category;
    const categoryLabel = CATEGORY_LABELS[targetCategory];
    const label = itemForm.label.trim();
    if (!label) { setDialogError(`请输入${categoryLabel}名称。`); return; }
    const existingItems = cachedDictionaries[targetCategory]?.items ?? visibleDictionary?.items ?? [];
    const conflictingItem = existingItems.find(
      (item) => item.id !== editingItem?.id && (item.value === label || item.label === label),
    );
    if (conflictingItem) {
      setDialogError(editingItem
        ? `“${label}”已存在，请使用其他名称。`
        : `“${label}”已存在，请直接在列表中点击“修改名称”。`);
      return;
    }
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setBusy(true);
    setDialogError(null);
    setDictionaryError(null);
    setDictionaryNotice(null);
    try {
      if (editingItem) {
        await updateManagementDictionaryItem(scope, editingItem.id, {
          category: editingItem.category,
          label,
          sort_order: Number(editingItem.sort_order ?? 0),
          status: itemForm.status ?? editingItem.status,
        });
      } else {
        await createManagementDictionaryItem(scope, {
          category: targetCategory,
          value: label,
          label,
          sort_order: Number(itemForm.sort_order ?? 0),
          status: "active",
        });
      }
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setDialogOpen(false);
      setDictionaryNotice(editingItem ? `${categoryLabel}名称已更新。` : `已添加${categoryLabel}“${label}”。`);
      await reloadCategory(targetCategory);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      notifyManagementOptionsChanged();
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setDialogError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setBusy(false);
    }
  }

  if (!allowed) {
    return <section className="management-panel or-g53-card p-5"><p className="management-empty">当前账号没有查看管理参数的权限。</p></section>;
  }

  const items = visibleDictionary?.items ?? [];
  const activeCount = visibleDictionary?.effective_items.length ?? 0;
  const disabledCount = Math.max(0, items.length - activeCount);
  const currentCategoryLabel = CATEGORY_LABELS[category];
  const dialogCategory = editingItem?.category ?? category;
  const dialogCategoryLabel = CATEGORY_LABELS[dialogCategory];

  return (
    <div className="space-y-5">
      <section className="management-panel or-g53-card p-4 sm:p-5">
        <div className="management-panel-header mb-4">
          <div>
            <h2 className="text-base font-semibold text-or-text">参数设置</h2>
            <p className="mt-1 text-xs text-or-muted">设置列表每页默认显示条数，以及管理活动记录的默认统计天数。</p>
          </div>
        </div>
        {error ? <p className="management-notice mb-4" role="alert">{error}</p> : null}
        {notice ? <p className="management-notice mb-4" role="status">{notice}</p> : null}
        {settingsLoading && !settings ? <p className="management-empty" role="status">正在加载参数…</p> : null}
        {settings ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="management-field"><span>列表默认每页数量</span><select aria-label="列表默认每页数量" value={form.default_page_size == null ? "inherit" : String(form.default_page_size)} onChange={(event) => setForm((previous) => ({ ...previous, default_page_size: event.target.value === "inherit" ? null : Number(event.target.value) }))} className="or-g53-select text-sm" disabled={!canEdit || busy}><option value="inherit">{scope === "admin" ? "沿用系统默认" : "沿用上级默认"}（{inheritedSettings?.default_page_size ?? settings.settings.default_page_size} 条）</option><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option></select><small className="text-xs text-or-muted">当前来源：{settingsSourceLabel(settings.sources.default_page_size)}</small></label>
            <label className="management-field"><span>管理活动默认时间范围</span><select aria-label="管理活动默认时间范围" value={form.activity_default_days == null ? "inherit" : String(form.activity_default_days)} onChange={(event) => setForm((previous) => ({ ...previous, activity_default_days: event.target.value === "inherit" ? null : Number(event.target.value) }))} className="or-g53-select text-sm" disabled={!canEdit || busy}><option value="inherit">{scope === "admin" ? "沿用系统默认" : "沿用上级默认"}（{inheritedSettings?.activity_default_days ?? settings.settings.activity_default_days} 天）</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select><small className="text-xs text-or-muted">当前来源：{settingsSourceLabel(settings.sources.activity_default_days)}</small></label>
            <div className="md:col-span-2"><button type="button" className="or-g53-btn-primary px-4 py-2 text-sm" disabled={!canEdit || busy || settingsLoading} onClick={() => void saveSettings()}>{busy ? "正在保存…" : "保存参数"}</button></div>
          </div>
        ) : null}
      </section>

      <section className="management-panel or-g53-card min-w-0 p-4 sm:p-5">
        <div className="management-panel-header mb-4">
          <div>
            <h2 className="text-base font-semibold text-or-text">学科与年级名称</h2>
            <p className="mt-1 text-xs text-or-muted">
              {category === "subjects"
                ? "可在此修改学科名称、添加新学科或停用不需要的学科，创建教师账号时可直接使用这些名称。"
                : "可在此修改年级名称、添加新年级或停用不需要的年级，创建班级时可直接使用这些名称。"}
            </p>
          </div>
          {canEdit ? <button type="button" className="or-g53-btn-primary px-3.5 py-2 text-sm" onClick={() => openItemDialog()}>添加{currentCategoryLabel}</button> : null}
        </div>
        {dictionaryError ? <p className="management-notice mb-4" role="alert">{dictionaryError}</p> : null}
        {dictionaryNotice ? <p className="management-notice mb-4" role="status">{dictionaryNotice}</p> : null}
        <div role="tablist" aria-label="名称管理分类" className="or-g53-tablist management-section-nav mb-4 max-w-xs">
          <button
            type="button"
            role="tab"
            aria-selected={category === "subjects"}
            className="or-g53-tab !transition-none"
            onClick={() => { setCategory("subjects"); setDictionaryNotice(null); }}
          >
            学科名称
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={category === "grades"}
            className="or-g53-tab !transition-none"
            onClick={() => { setCategory("grades"); setDictionaryNotice(null); }}
          >
            年级名称
          </button>
        </div>
        <div className="management-table-wrap overflow-x-auto" aria-busy={dictionaryLoading}>
          <table className="management-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>{currentCategoryLabel}名称</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.id}:${item.source}`}>
                  <td className="font-medium text-or-text">
                    <span>{item.label}</span>
                    {item.label !== item.value ? <span className="ml-2 text-xs font-normal text-or-muted">原默认：{item.value}</span> : null}
                  </td>
                  <td>
                    <span className={`or-g53-pill ${item.status === "active" ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>
                      {item.status === "active" ? "启用" : "已停用"}
                    </span>
                  </td>
                  <td>
                    {canEdit ? (
                      <div className="management-row-actions flex flex-wrap items-center gap-2">
                        <button type="button" disabled={busy} className="or-g53-btn-tonal px-3 py-1.5 text-xs" onClick={() => openItemDialog(item)}>
                          修改名称
                        </button>
                        <button type="button" disabled={busy} className="or-g53-btn-tonal px-3 py-1.5 text-xs" onClick={() => void toggleItemStatus(item)}>
                          {item.status === "active" ? "停用" : "启用"}
                        </button>
                      </div>
                    ) : <span className="text-xs text-or-muted">仅可查看</span>}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="management-empty" role={dictionaryLoading ? "status" : undefined}>
                      {dictionaryLoading ? "正在加载…" : `暂无${currentCategoryLabel}名称。`}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-or-muted">
          {visibleDictionary ? (
            <>
              当前启用 {activeCount} 个{currentCategoryLabel}
              {disabledCount > 0 ? `，已停用 ${disabledCount} 个` : ""}
            </>
          ) : dictionaryLoading ? (
            `正在加载${currentCategoryLabel}…`
          ) : null}
        </p>
      </section>

      {dialogOpen ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) { setDialogOpen(false); setDialogError(null); } }}>
          <Dialog.Portal><Dialog.Overlay className="management-dialog-overlay" /><Dialog.Content className="management-dialog">
            <header className="management-dialog-header">
              <div>
                <Dialog.Title>{editingItem ? `修改${dialogCategoryLabel}名称` : `添加${dialogCategoryLabel}`}</Dialog.Title>
                <Dialog.Description>{scope === "admin" ? "保存后全平台生效" : "保存后仅对本校生效"}</Dialog.Description>
              </div>
              <Dialog.Close asChild><button type="button" aria-label={`关闭${dialogCategoryLabel}名称编辑`} disabled={busy}>×</button></Dialog.Close>
            </header>
            {dialogError ? <p className="management-notice mb-4" role="alert">{dialogError}</p> : null}
            <form onSubmit={(event) => void saveItem(event)}>
              <div className="management-form-grid">
                <label className="management-field">
                  <span>{dialogCategoryLabel}名称</span>
                  <input
                    required
                    aria-label={`${dialogCategoryLabel}名称`}
                    value={itemForm.label}
                    placeholder={!editingItem ? (dialogCategory === "subjects" ? "例如：人工智能、劳动教育" : "例如：高三复读班") : undefined}
                    onChange={(event) => { setItemForm((previous) => ({ ...previous, label: event.target.value })); setDialogError(null); }}
                    className="or-g53-input text-sm"
                  />
                  {editingItem ? <small className="text-xs text-or-muted">修改后仅更新展示名称，不影响已关联的历史数据。</small> : null}
                </label>
                {editingItem ? (
                  <label className="management-field">
                    <span>状态</span>
                    <select value={itemForm.status ?? "active"} onChange={(event) => setItemForm((previous) => ({ ...previous, status: event.target.value as "active" | "disabled" }))} className="or-g53-select text-sm">
                      <option value="active">启用</option>
                      <option value="disabled">已停用</option>
                    </select>
                  </label>
                ) : null}
              </div>
              <footer className="management-dialog-footer">
                <button type="button" disabled={busy} onClick={() => setDialogOpen(false)} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button>
                <button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold">{busy ? "正在保存…" : "保存"}</button>
              </footer>
            </form>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
