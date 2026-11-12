import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import "../../ui-redesign/g49/g49.css";
import { PanelLeftClose, PanelLeftOpen, Plus, Save } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../api/client";
import { TabPanel, type TabItem } from "../../components/layout/TabPanel";
import { ContentTags, TagChips } from "../../components/ContentTags";
import {
  listTaggedItems,
  type ContentTag,
} from "../../platform/auth";
import { useAgentActions } from "../../contexts/AgentContext";
import { useToolBarActions } from "../../contexts/ToolBarContext";
import { useCollapsedPanelInert } from "../../hooks/useCollapsedPanelInert";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { isImeComposingKeyboardEvent, isImeCompositionActive } from "../../lib/ime";
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
  const { setPageContext } = useAgentActions();
  const { setToolBar, clearToolBar } = useToolBarActions();
  const [templates, setTemplates] = useState<TemplateListRow[]>([]);
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [path, setPath] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const baselineYamlRef = useRef<Record<string, string>>({});
  const baselineDraftRef = useRef<Record<string, Draft>>({});
  const [draft, setDraft] = useState<Draft>(() => createDefaultDraft());
  const [yamlTab, setYamlTab] = useState("");
  const [tab, setTab] = useState<"visual" | "yaml">("visual");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [templateListCollapsed, setTemplateListCollapsed] = useState(false);
  const templateListInnerRef = useCollapsedPanelInert(templateListCollapsed, 768);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
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
    void listTaggedItems("template")
      .then((tags) => {
        if (active) {
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
        const loadedDraft = draftFromParsed(parsed);
        baselineDraftRef.current[targetPath] = loadedDraft;
        setDraft(loadedDraft);
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

  const dirty = (() => {
    if (!path) return false;
    if (tab === "yaml") {
      const base = baselineYamlRef.current[path];
      return base !== undefined && yamlTab !== base;
    }
    const baselineDraft = baselineDraftRef.current[path];
    if (!baselineDraft) return false;
    return yamlDump !== buildTemplateYaml(baselineDraft, {
      fields: metadataUi.fields,
      editorDefaults,
      layoutBuiltinKeys,
    });
  })();

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
      delete baselineDraftRef.current[p];
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
        delete baselineDraftRef.current[saveOldPath];
        setOpenTabs((prev) => prev.map((p) => (p === saveOldPath ? finalPath : p)));
      }

      const q = encodeURIComponent(finalPath);
      const [raw, parsed] = await Promise.all([
        apiGet<{ yaml: string }>(`/api/templates/raw?path=${q}`),
        apiGet<TemplateParsedResponse>(`/api/templates/parsed?path=${q}`),
      ]);

      baselineYamlRef.current[finalPath] = raw.yaml;
      const savedDraft = draftFromParsed(parsed);
      baselineDraftRef.current[finalPath] = savedDraft;

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
          setDraft(savedDraft);
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
      delete baselineDraftRef.current[path];
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

  async function createNew(name: string) {
    const n = name.trim() || t("newTemplateDefault");
    onError(null);
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; path: string }>(
        `/api/templates/create?name=${encodeURIComponent(n)}&auto_rename=true`,
        {},
      );
      await refreshList();
      notifyContentLibraryChanged("template");
      setPath(r.path);
      setOpenTabs((prev) => (prev.includes(r.path) ? prev : [...prev, r.path]));
      setNewTemplateName("");
      setCreateDialogOpen(false);
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
          className="or-g49-btn or-g49-btn-secondary"
          disabled={busy}
          onClick={() => {
            setNewTemplateName("");
            setCreateDialogOpen(true);
          }}
        >
          <Plus className="mr-1 inline h-4 w-4" />
          {t("create")}
        </button>
        <button
          type="button"
          className="or-g49-btn text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] border-[var(--or-error)]"
          disabled={busy || !path}
          onClick={() => void deleteCurrent()}
        >
          {t("deleteFile")}
        </button>
      </div>
    );
    const right: ReactNode = path ? (
      <div className="flex flex-wrap items-center gap-2">
        {dirty ? <span className="text-[13px] font-medium text-[var(--or-on-warning)]">{t("unsavedHint")}</span> : null}
        <button
          type="button"
          className={cn(
            "",
            tab === "visual" ? "or-g49-btn or-g49-btn-primary" : "or-g49-btn or-g49-btn-secondary",
          )}
          onClick={() => setTab("visual")}
        >
          {t("visual")}
        </button>
        {advancedMode ? (
          <button
            type="button"
            className={cn(
              "",
              tab === "yaml" ? "or-g49-btn or-g49-btn-primary" : "or-g49-btn or-g49-btn-secondary",
            )}
            onClick={() => {
            setYamlTab(
              dirty ? yamlDump : baselineYamlRef.current[path] ?? yamlDump,
            );
              setTab("yaml");
            }}
          >
            {t("editSource")}
          </button>
        ) : null}
        <button
          type="button"
          className="or-g49-btn or-g49-btn-secondary"
          onClick={() => {
            setAdvancedMode((value) => !value);
            setTab("visual");
          }}
        >
          {advancedMode ? "返回简单模式" : "高级版式"}
        </button>
        <button
          type="button"
          className="or-g49-btn bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
          disabled={busy || !dirty}
          onClick={() => void saveRef.current()}
        >
          <Save className="mr-1 h-4 w-4" />
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
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className={cn("or-g49-template-list-panel flex w-full shrink-0 flex-col border-b border-[var(--or-outline)] bg-[var(--or-card)] md:w-56 md:max-w-[14rem] md:border-b-0 md:border-r max-h-[35vh] md:max-h-none", templateListCollapsed && "is-collapsed")}>
          <div ref={templateListInnerRef} className="or-g49-template-list-inner flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[var(--or-outline)] p-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--or-muted)]">
              {t("fileList")}
            </h2>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {templates.map((tpl) => (
              <li key={tpl.path}>
                <button
                  type="button"
                  className={cn(
                    "mb-1 w-full rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors",
                    path === tpl.path ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm" : "text-[var(--or-muted)] hover:bg-[var(--or-block)]",
                  )}
                  onClick={() => openOrFocusTemplate(tpl.path)}
                >
                  <span className="block font-medium">{tpl.id}</span>
                  {(taggedItems[tpl.path]?.length ?? 0) > 0 ? (
                    <TagChips tags={taggedItems[tpl.path]} />
                  ) : null}
                  {advancedMode ? (
                    <span className="block truncate font-mono text-[13px] opacity-75 mt-0.5">{tpl.path}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          </div>
          <button
            type="button"
            className="or-sidebar-toggle or-g49-template-collapse-btn hidden md:inline-flex"
            aria-label={templateListCollapsed ? "展开模板文件" : "收起模板文件"}
            aria-expanded={!templateListCollapsed}
            title={templateListCollapsed ? "展开模板文件" : "收起模板文件"}
            onClick={() => setTemplateListCollapsed((prev) => !prev)}
          >
            {templateListCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
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
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] p-3 text-sm shadow-sm">
                <ContentTags
                  scope="template"
                  itemId={path}
                  onError={onError}
                  onChange={() => void listTaggedItems("template").then(({ items }) => setTaggedItems(items))}
                />
              </div>
            ) : null}
            {msg && <p className="mb-2 text-sm text-[var(--or-on-success)]">{msg}</p>}
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
      <Dialog.Root
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setCreateDialogOpen(open);
          if (!open) setNewTemplateName("");
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/40 p-4 backdrop-blur-[2px]" />
          <Dialog.Content
            className="or-g49-dialog-surface fixed left-1/2 top-1/2 z-[71] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 p-5 sm:p-6"
            aria-describedby={undefined}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void createNew(newTemplateName);
              }}
            >
              <Dialog.Title className="text-lg font-semibold text-[var(--or-text)]">
                {t("create")}
              </Dialog.Title>
              <label className="mt-4 block text-sm font-medium text-[var(--or-muted)]">
                {t("newFileName")}
                <input
                  autoFocus
                  className="or-g49-input mt-1.5 w-full"
                  placeholder={t("newFilePh")}
                  value={newTemplateName}
                  onChange={(event) => setNewTemplateName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && isImeComposingKeyboardEvent(event)) {
                      event.preventDefault();
                    }
                  }}
                />
              </label>
              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  type="button"
                  className="or-g49-btn or-g49-btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setCreateDialogOpen(false);
                    setNewTemplateName("");
                  }}
                >
                  {t("common:cancel")}
                </button>
                <button type="submit" className="or-g49-btn or-g49-btn-primary" disabled={busy}>
                  <Plus className="h-4 w-4" />
                  {t("create")}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
