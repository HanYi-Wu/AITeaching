import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Save } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../api/client";
import { TabPanel, type TabItem } from "../../components/layout/TabPanel";
import { ContentFolders } from "../../components/ContentFolders";
import { ContentTags, TagChips } from "../../components/ContentTags";
import {
  assignFolderItem,
  listContentFolders,
  listFolderItems,
  listTaggedItems,
  type ContentFolder,
  type ContentTag,
} from "../../platform/auth";
import { useAgentContext } from "../../contexts/AgentContext";
import { useToolBar } from "../../contexts/ToolBarContext";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { isImeCompositionActive } from "../../lib/ime";
import { confirmDialog } from "../../lib/confirmDialog";
import { cn } from "../../lib/utils";
import {
  type MetadataUiField,
  type TemplateListRow,
  type TemplateParsedResponse,
  draftFromParsed,
  type LatexBasesResponse,
  type Draft,
  templateIdFromSaveBody,
  desiredPathForTemplateId,
  createDefaultDraft,
  FALLBACK_LATEX_BASES,
  buildTemplateYaml,
} from "./templateModel";
import { TemplateLayoutForm } from "./TemplateLayoutForm";
import { TemplateSectionsEditor } from "./TemplateSectionsEditor";
import { TemplatePresetPanel, TemplateYamlEditor } from "./TemplatePresetPanel";
import { useTemplateRequestScope } from "./useTemplateRequestScope";

export type { TemplatePresetId } from "./templateModel";
export { applyTemplatePreset } from "./templateModel";

export function TemplateWorkspace({ onError }: { onError: (s: string | null) => void }) {
  const { t } = useTranslation("template");
  const { setPageContext } = useAgentContext();
  const { setToolBar, clearToolBar } = useToolBar();
  const [templates, setTemplates] = useState<TemplateListRow[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [folderItems, setFolderItems] = useState<Record<string, string>>({});
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const baselineYamlRef = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(() => createDefaultDraft());
  const [yamlTab, setYamlTab] = useState("");
  const [tab, setTab] = useState<"visual" | "yaml">("visual");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [latexBasesInfo, setLatexBasesInfo] = useState<LatexBasesResponse>(FALLBACK_LATEX_BASES);
  const [metadataUi, setMetadataUi] = useState<{
    fields: MetadataUiField[];
    source: string | null;
    warnings: string[];
  }>({ fields: [], source: null, warnings: [] });

  const [layoutBuiltinKeys, setLayoutBuiltinKeys] = useState<string[]>([]);
  const [editorDefaults, setEditorDefaults] = useState<Record<string, unknown> | null>(null);

  const { createScopeCheck, isCurrentPath } = useTemplateRequestScope(path);
  const currentDraftRef = useRef(draft);
  currentDraftRef.current = draft;
  const currentYamlTabRef = useRef(yamlTab);
  currentYamlTabRef.current = yamlTab;
  const skipNextPathEffectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!path) {
      setPageContext({ current_page: "template", summary: t("pageSummaryPick") });
    } else {
      const leaf = path.includes("/") ? path.split("/").pop() : path;
      setPageContext({
        current_page: "template",
        selected_resource_type: "template_file",
        selected_resource_id: path,
        summary: t("pageSummaryEdit", { path: leaf ?? path }),
      });
    }
    return () => setPageContext(null);
  }, [path, setPageContext, t]);

  const refreshList = useCallback(async () => {
    const [tplRes, bases] = await Promise.all([
      apiGet<{ templates: TemplateListRow[] }>("/api/templates"),
      apiGet<LatexBasesResponse>("/api/templates/latex-bases").catch(() => FALLBACK_LATEX_BASES),
    ]);
    setLatexBasesInfo(
      bases.choices.length > 0
        ? bases
        : { ...bases, choices: FALLBACK_LATEX_BASES.choices },
    );
    setTemplates(tplRes.templates);
    return tplRes.templates;
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      listContentFolders("template"),
      listFolderItems("template"),
      listTaggedItems("template"),
    ])
      .then(([folderData, itemData, tags]) => {
        if (active) {
          setFolders(folderData.folders);
          setFolderItems(itemData.items);
          setTaggedItems(tags.items);
        }
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onError(null);
    void refreshList()
      .then((list) => {
        const first = list[0]?.path ?? "";
        setPath((prev) => prev || first);
        if (first) {
          setOpenTabs((prev) => (prev.length ? prev : [first]));
        }
      })
      .catch((e: Error) => onError(e.message));
  }, [onError, refreshList]);

  useEffect(() => {
    void apiGet<{ metadata_defaults: Record<string, unknown> }>("/api/templates/editor-metadata-defaults")
      .then((r) => setEditorDefaults(r.metadata_defaults))
      .catch(() => setEditorDefaults(null));
  }, []);

  useEffect(() => {
    if (!path) {
      return;
    }
    if (skipNextPathEffectRef.current === path) {
      skipNextPathEffectRef.current = null;
      return;
    }
    const isCurrent = createScopeCheck();
    onError(null);
    const targetPath = path;
    const q = encodeURIComponent(targetPath);
    void Promise.all([
      apiGet<{ yaml: string }>(`/api/templates/raw?path=${q}`),
      apiGet<TemplateParsedResponse>(`/api/templates/parsed?path=${q}`),
    ])
      .then(([raw, parsed]) => {
        if (!isCurrent()) {
          return;
        }
        setYamlTab(raw.yaml);
        baselineYamlRef.current[targetPath] = raw.yaml;
        setLayoutBuiltinKeys(parsed.layout_builtin_keys);
        setDraft(draftFromParsed(parsed));
      })
      .catch((e: Error) => {
        if (isCurrent()) {
          onError(e.message);
        }
      });
  }, [path, onError, createScopeCheck]);

  useEffect(() => {
    if (!path || !draft.latex_base) {
      setMetadataUi({ fields: [], source: null, warnings: [] });
      return;
    }
    const isCurrent = createScopeCheck();
    const q = new URLSearchParams({ template_path: path, latex_base: draft.latex_base });
    let active = true;
    void apiGet<{ fields: MetadataUiField[]; source: string | null; warnings?: string[] }>(
      `/api/templates/latex-metadata-ui?${q}`,
    )
      .then((r) => {
        if (!active || !isCurrent()) {
          return;
        }
        setMetadataUi({
          fields: r.fields ?? [],
          source: r.source ?? null,
          warnings: r.warnings ?? [],
        });
      })
      .catch(() => {
        if (active && isCurrent()) {
          setMetadataUi({ fields: [], source: null, warnings: [] });
        }
      });
    return () => { active = false; };
  }, [path, draft.latex_base, createScopeCheck]);

  const yamlDump = useMemo(
    () =>
      buildTemplateYaml(draft, {
        fields: metadataUi.fields,
        editorDefaults,
        layoutBuiltinKeys,
      }),
    [draft, metadataUi.fields, editorDefaults, layoutBuiltinKeys],
  );

  const dirty = useMemo(() => {
    if (!path) return false;
    const base = baselineYamlRef.current[path];
    if (base === undefined) return false;
    const current = tab === "yaml" ? yamlTab : yamlDump;
    return current !== base;
  }, [path, tab, yamlTab, yamlDump]);

  const trySelectPath = useCallback(
    (next: string | null) => {
      if (next === path) return true;
      if (dirty && !window.confirm(t("switchDiscard"))) {
        return false;
      }
      setPath(next ?? "");
      return true;
    },
    [path, dirty, t],
  );

  const openOrFocusTemplate = useCallback(
    (p: string) => {
      if (!trySelectPath(p)) return;
      setOpenTabs((prev) => (prev.includes(p) ? prev : [...prev, p]));
    },
    [trySelectPath],
  );

  const closeTemplateTab = useCallback(
    (p: string) => {
      if (p === path && dirty && !window.confirm(t("closeTabConfirm"))) {
        return;
      }
      setOpenTabs((prev) => {
        const next = prev.filter((x) => x !== p);
        if (path === p) {
          const fb = next[next.length - 1] ?? "";
          setPath(fb);
        }
        return next;
      });
      delete baselineYamlRef.current[p];
    },
    [path, dirty, t],
  );

  async function save() {
    if (isImeCompositionActive()) return;
    if (!path) {
      return;
    }
    onError(null);
    setBusy(true);
    setMsg(null);

    const saveOldPath = path.replace(/\\/g, "/");
    const saveBody = tab === "yaml" ? yamlTab : yamlDump;
    const saveDraft = draft;
    const saveTab = tab;
    const tid = templateIdFromSaveBody(saveTab, saveTab === "yaml" ? saveBody : "", saveDraft);
    const desiredPath = desiredPathForTemplateId(saveOldPath, tid);
    const putBody: { path: string; yaml: string; rename_to?: string } = {
      path: saveOldPath,
      yaml: saveBody,
    };
    if (desiredPath !== saveOldPath) {
      putBody.rename_to = desiredPath;
    }

    try {
      const putRes = await apiPut<{ ok: boolean; path?: string }>("/api/templates/raw", putBody);
      const finalPath = (putRes.path ?? desiredPath ?? saveOldPath).replace(/\\/g, "/");

      if (desiredPath !== saveOldPath) {
        delete baselineYamlRef.current[saveOldPath];
        setOpenTabs((prev) => prev.map((p) => (p === saveOldPath ? finalPath : p)));
      }

      const q = encodeURIComponent(finalPath);
      const [raw, parsed] = await Promise.all([
        apiGet<{ yaml: string }>(`/api/templates/raw?path=${q}`),
        apiGet<TemplateParsedResponse>(`/api/templates/parsed?path=${q}`),
      ]);

      baselineYamlRef.current[finalPath] = raw.yaml;

      if (isCurrentPath(saveOldPath)) {
        if (finalPath !== saveOldPath) {
          skipNextPathEffectRef.current = finalPath;
          setPath(finalPath);
        }
        if (currentYamlTabRef.current === saveBody) {
          setYamlTab(raw.yaml);
        }
        if (currentDraftRef.current === saveDraft) {
          setLayoutBuiltinKeys(parsed.layout_builtin_keys);
          setDraft(draftFromParsed(parsed));
        }
      }

      await refreshList();
      notifyContentLibraryChanged("template");
      setMsg(t("saved"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onError(t("renameConflict"));
      } else {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!path) return;
    if (!(await confirmDialog(t("deleteConfirm", { path })))) return;
    onError(null);
    setBusy(true);
    try {
      const q = encodeURIComponent(path);
      await apiDelete<{ ok: boolean }>(`/api/templates/raw?path=${q}`);
      delete baselineYamlRef.current[path];
      setOpenTabs((prev) => {
        const next = prev.filter((x) => x !== path);
        const fb = next[next.length - 1] ?? "";
        setPath(fb);
        return next;
      });
      await refreshList();
      notifyContentLibraryChanged("template");
      setMsg(t("deleted"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const n = newName.trim() || t("newTemplateDefault");
    onError(null);
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; path: string }>(
        `/api/templates/create?name=${encodeURIComponent(n)}&auto_rename=true`,
        {},
      );
      if (selectedFolderId) {
        await assignFolderItem("template", r.path, selectedFolderId);
        setFolderItems((items) => ({ ...items, [r.path]: selectedFolderId }));
      }
      await refreshList();
      notifyContentLibraryChanged("template");
      setPath(r.path);
      setOpenTabs((prev) => (prev.includes(r.path) ? prev : [...prev, r.path]));
      setNewName("");
      setMsg(t("created"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tabItems: TabItem[] = useMemo(
    () =>
      openTabs.map((p) => {
        const short = p.includes("/") ? p.split("/").pop() ?? p : p;
        return { id: p, label: short, dirty: p === path && dirty, closable: true };
      }),
    [openTabs, path, dirty],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const left: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void createNew()}
        >
          <Plus className="mr-1 inline h-4 w-4" />
          {t("create")}
        </button>
        <button
          type="button"
          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
          disabled={busy || !path}
          onClick={() => void deleteCurrent()}
        >
          {t("deleteFile")}
        </button>
      </div>
    );
    const right: ReactNode = path ? (
      <div className="flex flex-wrap items-center gap-2">
        {dirty ? <span className="text-[11px] text-amber-700">{t("unsavedHint")}</span> : null}
        <button
          type="button"
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            tab === "visual" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white",
          )}
          onClick={() => setTab("visual")}
        >
          {t("visual")}
        </button>
        {advancedMode ? (
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              tab === "yaml" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white",
            )}
            onClick={() => {
              setYamlTab(yamlDump);
              setTab("yaml");
            }}
          >
            {t("editSource")}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
          onClick={() => {
            setAdvancedMode((value) => !value);
            setTab("visual");
          }}
        >
          {advancedMode ? "返回简单模式" : "高级版式"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          disabled={busy || !dirty}
          onClick={() => void saveRef.current()}
        >
          <Save className="h-3.5 w-3.5" />
          {t("save")}
        </button>
      </div>
    ) : null;
    setToolBar({ left, right });
    return () => clearToolBar();
  }, [t, busy, path, dirty, tab, yamlDump, advancedMode, setToolBar, clearToolBar]);

  useEffect(() => {
    const onSave = () => {
      if (!path || !dirty) return;
      void saveRef.current();
    };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, [path, dirty]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-row">
        <aside className="flex w-full max-w-[14rem] shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="p-2">
            <ContentFolders
              scope="template"
              folders={folders}
              selectedId={selectedFolderId}
              onSelect={setSelectedFolderId}
              onCreated={(folder) => setFolders((current) => [...current, folder])}
              onUpdated={(folder) =>
                setFolders((current) => current.map((item) => (item.id === folder.id ? folder : item)))
              }
              onDeleted={(result) => {
                setFolders(result.folders);
                setFolderItems(result.items);
              }}
              onDropItem={(id, folderId) =>
                void assignFolderItem("template", id, folderId)
                  .then(() => setFolderItems((items) => ({ ...items, [id]: folderId })))
                  .catch((error) => onError(error instanceof Error ? error.message : String(error)))
              }
              onError={onError}
            />
          </div>
          <div className="border-b border-slate-100 p-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("fileList")}
            </h2>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {templates
              .filter((tpl) => !selectedFolderId || folderItems[tpl.path] === selectedFolderId)
              .map((tpl) => (
                <li key={tpl.path}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-or-content-item",
                        JSON.stringify({ scope: "template", id: tpl.path }),
                      )
                    }
                    className={cn(
                      "mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs",
                      path === tpl.path ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
                    )}
                    onClick={() => openOrFocusTemplate(tpl.path)}
                  >
                    <span className="block font-medium">{tpl.id}</span>
                    {(taggedItems[tpl.path]?.length ?? 0) > 0 ? (
                      <TagChips tags={taggedItems[tpl.path]} />
                    ) : null}
                    {advancedMode ? (
                      <span className="block truncate font-mono text-[10px] opacity-80">{tpl.path}</span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
          <div className="border-t border-slate-100 p-2">
            <label className="block text-[10px] font-medium text-slate-600">
              {t("newFileName")}
              <input
                className="mt-0.5 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                placeholder={t("newFilePh")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="mt-2 w-full rounded-md border border-slate-300 bg-slate-50 py-1 text-xs font-medium disabled:opacity-50"
              disabled={busy}
              onClick={() => void createNew()}
            >
              <Plus className="mr-1 inline h-3.5 w-3.5" />
              {t("create")}
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabPanel
            tabs={tabItems}
            activeId={path || null}
            onSelect={(id) => {
              if (trySelectPath(id)) {
                /* path updated */
              }
            }}
            onClose={closeTemplateTab}
            onCloseOthers={() => {
              if (!path) return;
              setOpenTabs([path]);
            }}
          />
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {path ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded border bg-white p-2 text-xs">
                <span>模板归类</span>
                <select
                  aria-label="模板所在文件夹"
                  value={folderItems[path] ?? ""}
                  onChange={(event) => {
                    const folderId = event.target.value;
                    void assignFolderItem("template", path, folderId || null)
                      .then(() => setFolderItems((items) => ({ ...items, [path]: folderId })))
                      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
                  }}
                  className="rounded border px-2 py-1"
                >
                  <option value="">未归类</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <ContentTags
                  scope="template"
                  itemId={path}
                  onError={onError}
                  onChange={() => void listTaggedItems("template").then(({ items }) => setTaggedItems(items))}
                />
              </div>
            ) : null}
            {msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
            {tab === "yaml" ? (
              <TemplateYamlEditor value={yamlTab} onChange={setYamlTab} />
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                <TemplatePresetPanel
                  draft={draft}
                  busy={busy}
                  onApplyPreset={(next, message) => {
                    setDraft(next);
                    setMsg(message);
                  }}
                />
                <TemplateLayoutForm
                  draft={draft}
                  advancedMode={advancedMode}
                  latexBasesInfo={latexBasesInfo}
                  metadataUi={metadataUi}
                  onChangeDraft={setDraft}
                />
                <TemplateSectionsEditor
                  sections={draft.sections}
                  onChangeSections={(sections) => setDraft((d) => ({ ...d, sections }))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
