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

function sourceLabel(source: ManagementDictionaryItem["source"]) {
  if (source === "builtin") return "内置默认";
  if (source === "platform") return "平台默认";
  return "本校设置";
}

function settingsSourceLabel(source: ManagementSettingsResponse["sources"]["default_page_size"]) {
  if (source === "builtin") return "系统内置默认";
  if (source === "platform") return "平台默认";
  return "本校设置";
}

export function ManagementSettingsPanel({ user, scope }: Props) {
  const allowed = scope === "admin" || canManage(user, "school.settings.read");
  const canEdit = scope === "admin" || canManage(user, "school.settings.manage");
  const [settings, setSettings] = useState<ManagementSettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>({ default_page_size: null, activity_default_days: null });
  const [category, setCategory] = useState<DictionaryCategory>("subjects");
  const [dictionary, setDictionary] = useState<ManagementDictionaryResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ManagementDictionaryItem | null>(null);
  const [itemForm, setItemForm] = useState<ManagementDictionaryPayload>(DEFAULT_ITEM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const settingsRequestRef = useRef(0);
  const dictionaryRequestRef = useRef(0);
  const scopeKey = `${user.id}:${user.school_id ?? ""}:${scope}:${loadSessionToken() ?? ""}`;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const dictionaryKey = `${scopeKey}:${category}`;
  const activeDictionaryKeyRef = useRef(dictionaryKey);
  activeDictionaryKeyRef.current = dictionaryKey;
  const visibleDictionary = dictionary?.category === category ? dictionary : null;
  const inheritedSettings = settings?.inherited_settings ?? (scope === "admin"
    ? { default_page_size: 10, activity_default_days: 30 }
    : settings?.settings);

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

  useEffect(() => {
    if (!allowed) return undefined;
    let current = true;
    const requestId = ++dictionaryRequestRef.current;
    const requestedSessionToken = loadSessionToken();
    setDictionaryLoading(true);
    setDictionary(null);
    listManagementDictionary(scope, category).then((result) => {
      if (current && dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === dictionaryKey && loadSessionToken() === requestedSessionToken) setDictionary(result);
    }).catch((reason: unknown) => {
      if (current && dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === dictionaryKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === dictionaryKey && loadSessionToken() === requestedSessionToken) setDictionaryLoading(false);
    });
    return () => { current = false; };
  }, [allowed, scope, scopeKey, category]);

  async function reloadCategory(nextCategory = category) {
    const requestedKey = `${scopeKey}:${nextCategory}`;
    const requestedSessionToken = loadSessionToken();
    const requestId = ++dictionaryRequestRef.current;
    try {
      const result = await listManagementDictionary(scope, nextCategory);
      if (dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === requestedKey && loadSessionToken() === requestedSessionToken) setDictionary(result);
    } catch (reason) {
      if (dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === requestedKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (dictionaryRequestRef.current === requestId && activeDictionaryKeyRef.current === requestedKey && loadSessionToken() === requestedSessionToken) setDictionaryLoading(false);
    }
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
    setEditingItem(item ?? null);
    setItemForm(item
      ? { category: item.category, value: item.value, label: item.label, sort_order: item.sort_order, status: item.status }
      : { ...DEFAULT_ITEM, category, value: "", label: "", sort_order: (visibleDictionary?.items.length ?? 0) * 10 });
    setDialogError(null);
    setDialogOpen(true);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = itemForm.value.trim();
    const label = itemForm.label.trim();
    if (!value || !label) { setDialogError("请填写参数值和显示名称。"); return; }
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setBusy(true);
    setDialogError(null);
    try {
      if (editingItem) {
        const inheritedValue = scope === "admin" ? editingItem.source === "builtin" : editingItem.source !== "school";
        await updateManagementDictionaryItem(scope, editingItem.id, { category: itemForm.category, ...(inheritedValue ? {} : { value }), label, sort_order: Number(itemForm.sort_order ?? 0), status: itemForm.status ?? "active" });
      } else {
        await createManagementDictionaryItem(scope, { ...itemForm, value, label, sort_order: Number(itemForm.sort_order ?? 0), status: itemForm.status ?? "active" });
      }
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setDialogOpen(false);
      setNotice(editingItem ? "参数已更新。" : "参数已添加。");
      await reloadCategory(itemForm.category);
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

  return (
    <div className="space-y-5">
      <section className="management-panel or-g53-card p-4 sm:p-5">
        <div className="management-panel-header mb-4"><div><h2 className="text-base font-semibold text-or-text">参数设置</h2></div></div>
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
        <div className="management-panel-header mb-4"><div><h2 className="text-base font-semibold text-or-text">字典参数</h2></div>{canEdit ? <button type="button" className="or-g53-btn-primary px-3.5 py-2 text-sm" onClick={() => openItemDialog()}>添加{CATEGORY_LABELS[category]}</button> : null}</div>
        <div className="management-toolbar mb-4">
          <label className="management-field"><span>字典类型</span><select aria-label="字典类型" value={category} onChange={(event) => setCategory(event.target.value as DictionaryCategory)} className="or-g53-select text-sm"><option value="subjects">学科</option><option value="grades">年级</option></select></label>
        </div>
        <div className="management-table-wrap overflow-x-auto" aria-busy={dictionaryLoading}>
          <table className="management-table w-full text-left text-sm"><thead><tr><th>参数值</th><th>显示名称</th><th>排序</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {(visibleDictionary?.items ?? []).map((item) => (
              <tr key={`${item.id}:${item.source}`}><td className="font-mono text-xs">{item.value}</td><td className="font-medium">{item.label}</td><td>{item.sort_order}</td><td>{sourceLabel(item.source)}</td><td><span className={`or-g53-pill ${item.status === "active" ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>{item.status === "active" ? "启用" : "停用"}</span></td><td>{canEdit ? <button type="button" className="or-g53-btn-tonal px-3 py-1.5 text-xs" onClick={() => openItemDialog(item)}>{item.source === "school" || scope === "admin" ? "编辑" : "覆盖"}</button> : <span className="text-xs text-or-muted">只读</span>}</td></tr>
            ))}
            {(visibleDictionary?.items.length ?? 0) === 0 ? <tr><td colSpan={6}><div className="management-empty" role={dictionaryLoading ? "status" : undefined}>{dictionaryLoading ? "正在加载字典…" : "暂无字典项。"}</div></td></tr> : null}
          </tbody></table>
        </div>
        <p className="mt-3 text-xs text-or-muted">有效选项：{(visibleDictionary?.effective_items ?? []).length} 项</p>
      </section>

      {dialogOpen ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) { setDialogOpen(false); setDialogError(null); } }}>
          <Dialog.Portal><Dialog.Overlay className="management-dialog-overlay" /><Dialog.Content className="management-dialog">
            <header className="management-dialog-header"><div><Dialog.Title>{editingItem ? `编辑${CATEGORY_LABELS[editingItem.category]}` : `添加${CATEGORY_LABELS[category]}`}</Dialog.Title><Dialog.Description>{scope === "admin" ? "平台生效" : "仅本校生效"}</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="关闭字典条目编辑" disabled={busy}>×</button></Dialog.Close></header>
            {dialogError ? <p className="management-notice mb-4" role="alert">{dialogError}</p> : null}
            <form onSubmit={(event) => void saveItem(event)}>
              <div className="management-form-grid">
                {!editingItem ? <label className="management-field"><span>字典类型</span><select value={itemForm.category} onChange={(event) => setItemForm((previous) => ({ ...previous, category: event.target.value as DictionaryCategory }))} className="or-g53-select text-sm"><option value="subjects">学科</option><option value="grades">年级</option></select></label> : null}
                <label className="management-field"><span>参数值</span><input required value={itemForm.value} readOnly={Boolean(editingItem && (scope === "admin" ? editingItem.source === "builtin" : editingItem.source !== "school"))} onChange={(event) => setItemForm((previous) => ({ ...previous, value: event.target.value }))} className="or-g53-input text-sm read-only:opacity-70" />{editingItem && (scope === "admin" ? editingItem.source === "builtin" : editingItem.source !== "school") ? <small className="text-xs text-or-muted">继承值不可改</small> : null}</label>
                <label className="management-field"><span>显示名称</span><input required value={itemForm.label} onChange={(event) => { setItemForm((previous) => ({ ...previous, label: event.target.value })); setDialogError(null); }} className="or-g53-input text-sm" /></label>
                <label className="management-field"><span>排序值</span><input type="number" value={itemForm.sort_order ?? 0} onChange={(event) => setItemForm((previous) => ({ ...previous, sort_order: Number(event.target.value) }))} className="or-g53-input text-sm" /></label>
                <label className="management-field"><span>状态</span><select value={itemForm.status ?? "active"} onChange={(event) => setItemForm((previous) => ({ ...previous, status: event.target.value as "active" | "disabled" }))} className="or-g53-select text-sm"><option value="active">启用</option><option value="disabled">停用</option></select></label>
              </div>
              <footer className="management-dialog-footer"><button type="button" disabled={busy} onClick={() => setDialogOpen(false)} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button><button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold">{busy ? "正在保存…" : "保存"}</button></footer>
            </form>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
