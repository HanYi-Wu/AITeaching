import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, FolderInput, Loader2 } from "lucide-react";
import {
  apiAgentLlmSettingsGet,
  apiAgentSafetyModeGet,
  apiAgentSafetyModePut,
  apiPost,
  type AgentLlmSettingsResponse,
  type AgentSafetyModeOption,
} from "../../api/client";
import {
  AgentModelSettingsForm,
  type AgentModelSettingsFormHandle,
} from "../../components/settings/AgentModelSettingsForm";
import { ExtensionsPanel } from "../../components/ExtensionsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useAgentActions } from "../../contexts/AgentContext";
import { changeAppLanguage } from "../../i18n/changeLanguage";
import type { AppLang } from "../../i18n/tauriLocale";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import type { PlatformRole } from "../../platform/roles";
import {
  getAccountProfile,
  updateAccountCredentials,
  updateAccountProfile,
  type PlatformUser,
} from "../../platform/auth";
import { AppearanceFields } from "../../design-system/AppearanceFields";
import { applyAppearance, appearanceTheme, readAppearance, saveAppearance, saveLoginAppearance, type Appearance } from "../../design-system/appearance";
import { LogWorkspace } from "../log/LogWorkspace";
import { Select as AppSelect } from "../../components/ui/select";

type PersonalizationSaveOutcome =
  | { status: "saved"; stored: boolean; loginAppearanceStored: boolean }
  | { status: "failed"; stale: boolean }
  | { status: "stale" };

export function SettingsWorkspace({
  onError,
  onSwitchProject,
  userRole,
  onProfileUpdated,
}: {
  onError: (msg: string | null) => void;
  /** 可选：切换内容目录并回到入口页 */
  onSwitchProject?: () => void | Promise<void>;
  userRole?: PlatformRole;
  onProfileUpdated?: (profile: PlatformUser) => void;
}) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { setPageContext } = useAgentActions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AgentLlmSettingsResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [safetyMode, setSafetyMode] = useState("allegro");
  const [safetyOptions, setSafetyOptions] = useState<AgentSafetyModeOption[]>([]);
  const [settingsTab, setSettingsTab] = useState("model");
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [subjectsText, setSubjectsText] = useState("");
  const [appearance, setAppearance] = useState(() => readAppearance());
  const [density, setDensity] = useState("comfortable");
  const [fontScale, setFontScale] = useState(1);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const modelFormRef = useRef<AgentModelSettingsFormHandle>(null);
  const canManageModelSettings = userRole === "admin";

  const personalizationDirtyRef = useRef(false);
  const personalizationRevisionRef = useRef(0);
  const personalizationRequestRef = useRef<Promise<PersonalizationSaveOutcome> | null>(null);
  const personalizationMountedRef = useRef(true);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPersonalizationRef = useRef({
    profile,
    appearance,
    density,
    fontScale,
    avatarDataUrl,
    subjectsText,
    userRole,
    onProfileUpdated,
    onError,
  });
  latestPersonalizationRef.current = {
    profile,
    appearance,
    density,
    fontScale,
    avatarDataUrl,
    subjectsText,
    userRole,
    onProfileUpdated,
    onError,
  };

  useEffect(() => {
    void getAccountProfile().then(({ profile: value }) => {
      setProfile(value);
      setSubjectsText((value.subjects ?? []).join("、"));
      setAppearance(readAppearance(value));
      const loadedDensity = value.preferences?.density === "compact" ? "compact" : "comfortable";
      setDensity(loadedDensity);
      document.documentElement.dataset.ehDensity = loadedDensity;
      setFontScale(Number(value.preferences?.font_scale ?? 1));
      setAvatarDataUrl(value.avatar_data_url ?? null);
    }).catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [onError]);

  const persistPersonalization = useCallback(async (options?: { silent?: boolean; unmounting?: boolean }) => {
    const silent = options?.silent ?? false;
    const unmounting = options?.unmounting ?? false;
    const showStatus = !silent && !unmounting;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (showStatus && !personalizationMountedRef.current) return;
    if (showStatus && !personalizationDirtyRef.current) {
      // Keep the explicit Save button useful after an earlier autosave succeeded.
      personalizationDirtyRef.current = true;
    }
    if (showStatus) setSaving(true);
    let lastSaved: Extract<PersonalizationSaveOutcome, { status: "saved" }> | null = null;
    try {
      while (personalizationDirtyRef.current) {
        const activeRequest = personalizationRequestRef.current;
        if (activeRequest) {
          const outcome = await activeRequest;
          if (outcome.status === "saved") lastSaved = outcome;
          if (outcome.status === "failed" && !outcome.stale && !unmounting) return;
          continue;
        }

        const current = latestPersonalizationRef.current;
        if (!current.profile) return;
        const revision = personalizationRevisionRef.current;
        const request = (async (): Promise<PersonalizationSaveOutcome> => {
          try {
            const subjects = current.subjectsText.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);
            const result = await updateAccountProfile({
              avatar_data_url: current.avatarDataUrl,
              preferences: { theme: appearanceTheme(current.appearance), density: current.density, font_scale: current.fontScale },
              subjects: current.userRole === "teacher" ? subjects : null,
            });

            if (revision !== personalizationRevisionRef.current) {
              return { status: "stale" };
            }

            const stored = saveAppearance(result.profile.id, current.appearance);
            const loginAppearanceStored = saveLoginAppearance(current.appearance);
            personalizationDirtyRef.current = false;
            if (personalizationMountedRef.current) {
              setProfile(result.profile);
              current.onProfileUpdated?.(result.profile);
              applyAppearance(result.profile);
            }
            return { status: "saved", stored, loginAppearanceStored };
          } catch (error) {
            const stale = revision !== personalizationRevisionRef.current;
            if (!stale) {
              personalizationDirtyRef.current = true;
              current.onError(error instanceof Error ? error.message : String(error));
            }
            return { status: "failed", stale };
          }
        })();
        const trackedRequest = request.finally(() => {
          if (personalizationRequestRef.current === trackedRequest) {
            personalizationRequestRef.current = null;
          }
        });
        personalizationRequestRef.current = trackedRequest;

        const outcome = await trackedRequest;
        if (outcome.status === "saved") lastSaved = outcome;
        if (outcome.status === "failed" && !outcome.stale) return;
      }

      if (showStatus && personalizationMountedRef.current) {
        setMsg(lastSaved?.stored && lastSaved.loginAppearanceStored
          ? "个性化设置已保存"
          : "设置已保存，当前外观在本次会话中生效");
      }
    } finally {
      if (showStatus && personalizationMountedRef.current) setSaving(false);
    }
  }, []);

  const scheduleAutoSavePersonalization = useCallback((delayMs = 450) => {
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = true;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (personalizationDirtyRef.current && latestPersonalizationRef.current.profile) {
        void persistPersonalization({ silent: true });
      }
    }, delayMs);
  }, [persistPersonalization]);

  useEffect(() => {
    personalizationMountedRef.current = true;
    return () => {
      personalizationMountedRef.current = false;
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (personalizationDirtyRef.current && latestPersonalizationRef.current.profile) {
        void persistPersonalization({ silent: true, unmounting: true });
      }
    };
  }, [persistPersonalization]);

  const handleAppearanceChange = useCallback((nextAppearance: Appearance) => {
    setAppearance(nextAppearance);
    const current = latestPersonalizationRef.current;
    latestPersonalizationRef.current = { ...current, appearance: nextAppearance };
    if (current.profile?.id) {
      saveAppearance(current.profile.id, nextAppearance);
    }
    saveLoginAppearance(nextAppearance);
    applyAppearance({
      id: current.profile?.id ?? "preview",
      preferences: {
        ...current.profile?.preferences,
        theme: appearanceTheme(nextAppearance),
        density: current.density,
        font_scale: current.fontScale,
      },
    });
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  const handleDensityChange = useCallback((nextDensity: string) => {
    setDensity(nextDensity);
    latestPersonalizationRef.current = { ...latestPersonalizationRef.current, density: nextDensity };
    document.documentElement.dataset.ehDensity = nextDensity === "compact" ? "compact" : "comfortable";
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  const handleFontScaleChange = useCallback((nextScale: number) => {
    setFontScale(nextScale);
    latestPersonalizationRef.current = { ...latestPersonalizationRef.current, fontScale: nextScale };
    document.documentElement.style.setProperty("--or-font-scale", String(nextScale));
    document.documentElement.style.fontSize = `${nextScale * 100}%`;
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  async function savePassword() {
    if (newPassword.length < 6) {
      onError("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      onError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      const result = await updateAccountCredentials({ current_password: currentPassword, new_password: newPassword });
      onProfileUpdated?.(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg("密码已修改");
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function chooseAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1_500_000) {
      onError("请选择小于 1.5MB 的图片作为头像");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const nextUrl = String(reader.result || "");
      setAvatarDataUrl(nextUrl);
      latestPersonalizationRef.current = { ...latestPersonalizationRef.current, avatarDataUrl: nextUrl };
      scheduleAutoSavePersonalization(450);
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    if (!canManageModelSettings && settingsTab === "model") {
      setSettingsTab("language");
    }
  }, [canManageModelSettings, settingsTab]);

  useEffect(() => {
    setPageContext({
      current_page: "settings",
      summary: settingsTab === "extensions" ? t("ext.pageSummary") : t("pageSummary"),
    });
    return () => setPageContext(null);
  }, [setPageContext, t, settingsTab]);

  const load = useCallback(async () => {
    if (!canManageModelSettings) {
      setData(null);
      setSafetyOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMsg(null);
    onError(null);
    try {
      const [r, safety] = await Promise.all([apiAgentLlmSettingsGet(), apiAgentSafetyModeGet()]);
      setData(r);
      setSafetyMode(safety.mode);
      setSafetyOptions(safety.options ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canManageModelSettings, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSave = () => {
      if (!canManageModelSettings || settingsTab !== "model" || !data || loading) return;
      void modelFormRef.current?.save();
    };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, [canManageModelSettings, settingsTab, data, loading]);

  const handleSwitchProject = async () => {
    if (!onSwitchProject) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiPost("/api/project/close", {});
      await onSwitchProject();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSafetyMode = async () => {
    if (!canManageModelSettings || !data) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentSafetyModePut(safetyMode);
      setMsg(t("settings:updatedSafety"));
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const uiLang: AppLang = (i18n.language || "zh").startsWith("en") ? "en" : "zh";
  const languagePanel = (
    <div className="or-surface rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-4 sm:p-5 shadow-sm">
      <label className="block text-sm font-semibold text-[var(--or-text)]">{t("settings:uiLanguage")}</label>
      <AppSelect
        className="or-select or-field mt-2.5 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)]"
        value={uiLang}
        onValueChange={(value) => void changeAppLanguage(value as AppLang)}
      >
        <option value="zh">{t("settings:langZh")}</option>
        <option value="en">{t("settings:langEn")}</option>
      </AppSelect>
    </div>
  );

  const personalizationPanel = profile ? (
    <div className="or-surface rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-4 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--or-text)]">个性化与账号资料</h2>
        {userRole === 'teacher' ? (
          <button
            type="button"
            className="or-button or-button-tonal rounded-[8px] px-3 py-1.5 text-xs sm:text-sm font-medium"
            onClick={() => window.dispatchEvent(new Event('eh-replay-teacher-guide'))}
          >
            重新打开教师使用引导
          </button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-[var(--or-text)]">头像</label>
          <div className="mt-2.5 flex items-center gap-3.5">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-[var(--or-block)] text-lg font-bold text-[var(--or-text)] border border-[var(--or-outline)]">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="教师头像" className="h-full w-full object-cover" />
              ) : (
                profile.display_name?.slice(0, 1) || profile.username.slice(0, 1)
              )}
            </div>
            <label className="cursor-pointer inline-flex items-center justify-center rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] transition-colors">
              上传图片
              <input type="file" accept="image/*" className="hidden" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
            </label>
          </div>
        </div>

        <div className="sm:col-span-2"><AppearanceFields value={appearance} onChange={handleAppearanceChange} /></div>

        <label className="block text-sm font-medium text-[var(--or-text)]">
          界面密度
          <AppSelect
            aria-label="界面密度"
            value={density}
            onValueChange={(value) => handleDensityChange(value)}
            className="or-select or-field mt-2.5 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)]"
          >
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
          </AppSelect>
        </label>

        <label className="block text-sm font-medium text-[var(--or-text)]">
          字号比例
          <div className="mt-2.5 flex items-center gap-3">
            <input
              type="range"
              min="0.85"
              max="1.2"
              step="0.05"
              value={fontScale}
              onChange={(event) => handleFontScaleChange(Number(event.target.value))}
              className="w-full accent-[var(--or-primary)]"
            />
            <span className="w-12 text-right text-xs sm:text-sm font-semibold text-[var(--or-muted)]">
              {Math.round(fontScale * 100)}%
            </span>
          </div>
        </label>
      </div>

      {userRole === "teacher" ? (
        <label className="mt-5 block text-sm font-medium text-[var(--or-text)]">
          我的学科
          <textarea
            value={subjectsText}
            onChange={(event) => {
              const nextText = event.target.value;
              setSubjectsText(nextText);
              latestPersonalizationRef.current = { ...latestPersonalizationRef.current, subjectsText: nextText };
              scheduleAutoSavePersonalization(600);
            }}
            className="or-input or-field mt-2 min-h-20 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] p-3 text-sm text-[var(--or-text)]"
            placeholder="例如：数学、物理"
          />
        </label>
      ) : null}

      <div className="mt-6 border-t border-[var(--or-outline)] pt-5">
        <h3 className="text-base font-semibold text-[var(--or-text)]">修改登录密码</h3>
        <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
          <label className="text-sm font-medium text-[var(--or-text)]">
            当前密码
            <input
              aria-label="当前密码"
              type={showPasswords ? "text" : "password"}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="or-input or-field mt-1.5 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)]"
            />
          </label>
          <label className="text-sm font-medium text-[var(--or-text)]">
            新密码
            <input
              aria-label="新密码"
              type={showPasswords ? "text" : "password"}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="or-input or-field mt-1.5 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)]"
            />
          </label>
          <label className="text-sm font-medium text-[var(--or-text)]">
            确认新密码
            <input
              aria-label="确认新密码"
              type={showPasswords ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="or-input or-field mt-1.5 w-full rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)]"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || !currentPassword || !newPassword || !confirmPassword}
            onClick={() => void savePassword()}
            className="or-button or-button-primary w-full sm:w-auto rounded-[10px] px-4 py-2 text-sm font-semibold"
          >
            修改密码
          </button>
          <button
            type="button"
            onClick={() => setShowPasswords((value) => !value)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--or-muted)] hover:text-[var(--or-text)] transition-colors"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showPasswords ? "隐藏密码" : "显示密码"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="h-full overflow-auto bg-[var(--or-page)] p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--or-text)]">{t("title")}</h1>

          </div>
          {onSwitchProject && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSwitchProject()}
              className="or-button or-button-outline inline-flex w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm font-medium text-[var(--or-text)] shadow-sm hover:bg-[var(--or-block)]"
            >
              <FolderInput className="h-4 w-4" />
              {t("settings:switchProject")}
            </button>
          )}
        </div>

        {msg ? (
          <p
            role="status"
            className="rounded-[12px] border border-[var(--or-success)] bg-[var(--or-success-container)] dark:border-emerald-900/40 dark:bg-emerald-950/30 px-4 py-2.5 text-sm font-medium text-[var(--or-on-success)] dark:text-emerald-300"
          >
            {msg}
          </p>
        ) : null}

        {canManageModelSettings ? (
          <Tabs value={settingsTab} onValueChange={setSettingsTab}>
            <TabsList className="mb-2 w-full max-w-md sm:w-auto">
              <TabsTrigger value="model" className="flex-1 sm:flex-none">
                {t("settings:tabModel")}
              </TabsTrigger>
              <TabsTrigger value="extensions" className="flex-1 sm:flex-none">
                {t("settings:tabExtensions")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="extensions">
              <h2 className="sr-only">{t("ext.title")}</h2>
              <ExtensionsPanel onError={onError} />
            </TabsContent>

            <TabsContent value="model">
              {loading ? (
                <div className="mt-6 flex items-center justify-center gap-2.5 text-[var(--or-muted)]">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--or-primary)]" />
                  <span className="text-sm">{t("settings:loading")}</span>
                </div>
              ) : (
                <div className="space-y-5">
                  {languagePanel}
                  {personalizationPanel}

                  <AgentModelSettingsForm
                    ref={modelFormRef}
                    variant="settings"
                    data={data}
                    loading={false}
                    saving={saving}
                    onError={onError}
                    onReload={load}
                  />

                  <div className="or-surface rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-4 sm:p-6 shadow-sm">
                    <label className="block text-base font-semibold text-[var(--or-text)]">{t("settings:safetyTitle")}</label>
                    <div className="mt-3.5 space-y-2.5">
                      {safetyOptions.map((op) => {
                        const isSelected = safetyMode === op.id;
                        return (
                          <label
                            key={op.id}
                            className={`block cursor-pointer rounded-[12px] border p-3.5 transition-colors duration-150 ${
                              isSelected
                                ? "border-[var(--or-primary)] bg-[var(--or-primary-container)]/30 text-[var(--or-text)] ring-1 ring-[var(--or-primary)]/50"
                                : "border-[var(--or-outline)] bg-[var(--or-card)] hover:bg-[var(--or-block)]"
                            } ${loading || !data || saving ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="radio"
                                name="agent-safety-mode"
                                value={op.id}
                                checked={isSelected}
                                disabled={loading || !data || saving}
                                onChange={(e) => setSafetyMode(e.target.value)}
                                className="accent-[var(--or-primary)]"
                              />
                              <span className="font-medium text-sm sm:text-base text-[var(--or-text)]">
                                {t(`safetyOption.${op.id}.label`, { defaultValue: op.label })}
                              </span>
                            </div>
                            <div className="mt-1 pl-6 text-xs sm:text-sm text-[var(--or-muted)] leading-relaxed">
                              {t(`safetyOption.${op.id}.desc`, { defaultValue: op.description })}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        disabled={loading || !data || saving}
                        onClick={() => void handleSaveSafetyMode()}
                        className="or-button or-button-primary w-full sm:w-auto rounded-[10px] px-4 py-2 text-sm font-semibold"
                      >
                        {t("settings:saveSafety")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-5">
            {languagePanel}
            {personalizationPanel}
          </div>
        )}

        <div className="pt-2">
          <LogWorkspace embedded />
        </div>
      </div>
    </div>
  );
}
