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
import { useAgentContext } from "../../contexts/AgentContext";
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
import { LogWorkspace } from "../log/LogWorkspace";

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
  const { setPageContext } = useAgentContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AgentLlmSettingsResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [safetyMode, setSafetyMode] = useState("allegro");
  const [safetyOptions, setSafetyOptions] = useState<AgentSafetyModeOption[]>([]);
  const [settingsTab, setSettingsTab] = useState("model");
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [subjectsText, setSubjectsText] = useState("");
  const [theme, setTheme] = useState("classic");
  const [density, setDensity] = useState("comfortable");
  const [fontScale, setFontScale] = useState(1);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const modelFormRef = useRef<AgentModelSettingsFormHandle>(null);
  const canManageModelSettings = userRole === "admin";

  useEffect(() => {
    void getAccountProfile().then(({ profile: value }) => {
      setProfile(value);
      setSubjectsText((value.subjects ?? []).join("、"));
      setTheme(value.preferences?.theme ?? "classic");
      setDensity(value.preferences?.density ?? "comfortable");
      setFontScale(Number(value.preferences?.font_scale ?? 1));
      setAvatarDataUrl(value.avatar_data_url ?? null);
    }).catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [onError]);

  async function savePersonalization() {
    setSaving(true);
    try {
      const subjects = subjectsText.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);
      const result = await updateAccountProfile({
        avatar_data_url: avatarDataUrl,
        preferences: { theme, density, font_scale: fontScale },
        subjects: userRole === "teacher" ? subjects : null,
      });
      setProfile(result.profile);
      onProfileUpdated?.(result.profile);
      document.documentElement.dataset.ehTheme = theme;
      document.documentElement.style.fontSize = `${fontScale * 100}%`;
      localStorage.setItem("eh-theme", theme);
      localStorage.setItem("eh-density", density);
      setMsg("个性化设置已保存");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

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
    reader.onload = () => setAvatarDataUrl(String(reader.result || ""));
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-sm font-medium text-slate-700">{t("settings:uiLanguage")}</label>
      <select
        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        value={uiLang}
        onChange={(e) => void changeAppLanguage(e.target.value as AppLang)}
      >
        <option value="zh">{t("settings:langZh")}</option>
        <option value="en">{t("settings:langEn")}</option>
      </select>
    </div>
  );
  const personalizationPanel = profile ? (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">个性化与账号资料</h2>
      {userRole === 'teacher' ? <button type="button" className="mt-2 rounded border px-3 py-1 text-xs" onClick={() => window.dispatchEvent(new Event('eh-replay-teacher-guide'))}>重新打开教师使用引导</button> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-slate-700">头像</label>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-lg font-bold">{avatarDataUrl ? <img src={avatarDataUrl} alt="教师头像" className="h-full w-full object-cover" /> : profile.display_name?.slice(0, 1)}</div>
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-sm">上传图片<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseAvatar(event.target.files?.[0])} /></label>
          </div>
        </div>
        <label className="text-sm font-medium text-slate-700">界面皮肤<select value={theme} onChange={(event) => setTheme(event.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="classic">经典明亮</option><option value="ocean">海洋蓝</option><option value="forest">森林绿</option><option value="warm">暖阳橙</option><option value="night">深色夜间</option></select></label>
        <label className="text-sm font-medium text-slate-700">界面密度<select value={density} onChange={(event) => setDensity(event.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
        <label className="text-sm font-medium text-slate-700">字号比例<input type="range" min="0.85" max="1.2" step="0.05" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} className="mt-3 w-full" /><span className="text-xs text-slate-500">{Math.round(fontScale * 100)}%</span></label>
      </div>
      {userRole === "teacher" ? <label className="mt-4 block text-sm font-medium text-slate-700">我的学科（可设置多个，用顿号或逗号分隔）<textarea value={subjectsText} onChange={(event) => setSubjectsText(event.target.value)} className="mt-2 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="例如：数学、物理" /></label> : null}
      <button type="button" disabled={saving} onClick={() => void savePersonalization()} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">保存个性化设置</button>
      <div className="mt-6 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">修改登录密码</h3>
        <p className="mt-1 text-xs text-slate-500">密码至少 6 位，建议同时包含字母和数字。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-700">当前密码<input aria-label="当前密码" type={showPasswords ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-700">新密码<input aria-label="新密码" type={showPasswords ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-700">确认新密码<input aria-label="确认新密码" type={showPasswords ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={saving || !currentPassword || !newPassword || !confirmPassword} onClick={() => void savePassword()} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">修改密码</button>
          <button type="button" onClick={() => setShowPasswords((value) => !value)} className="inline-flex items-center gap-2 px-2 text-sm text-slate-600">{showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showPasswords ? "隐藏密码" : "显示密码"}</button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {canManageModelSettings ? t("intro") : "管理界面语言和运行日志。"}
          </p>
        </div>
        {onSwitchProject && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSwitchProject()}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <FolderInput className="h-4 w-4" />
            {t("settings:switchProject")}
          </button>
        )}
      </div>

      {canManageModelSettings ? (
      <Tabs value={settingsTab} onValueChange={setSettingsTab} className="mt-6">
        <TabsList className="mb-1 w-full max-w-lg sm:w-auto">
          <TabsTrigger value="model" className="flex-1 sm:flex-none">
            {t("settings:tabModel")}
          </TabsTrigger>
          <TabsTrigger value="extensions" className="flex-1 sm:flex-none">
            {t("settings:tabExtensions")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extensions" className="mx-auto max-w-2xl">
          <h2 className="sr-only">{t("ext.title")}</h2>
          <ExtensionsPanel onError={onError} />
        </TabsContent>

        <TabsContent value="model" className="mx-auto max-w-lg">
          {loading ? (
            <div className="mt-4 flex items-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("settings:loading")}
            </div>
          ) : (
            <div className="space-y-4">
              {languagePanel}
              {personalizationPanel}

              {data ? (
                data.persist_scope === "global" ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {t("settings:saveScopeGlobalHint")}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {t("settings:saveScopeProjectHint")}
                  </div>
                )
              ) : null}

              <AgentModelSettingsForm
                ref={modelFormRef}
                variant="settings"
                data={data}
                loading={false}
                saving={saving}
                onError={onError}
                onReload={load}
              />

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <label className="block text-sm font-medium text-slate-700">{t("settings:safetyTitle")}</label>
                <p className="mt-0.5 text-xs text-slate-500">{t("settings:safetyHint")}</p>
                <div className="mt-2 space-y-2">
                  {safetyOptions.map((op) => (
                    <label
                      key={op.id}
                      className={`block cursor-pointer rounded-md border px-3 py-2 text-sm ${
                        safetyMode === op.id ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white"
                      } ${loading || !data || saving ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="agent-safety-mode"
                          value={op.id}
                          checked={safetyMode === op.id}
                          disabled={loading || !data || saving}
                          onChange={(e) => setSafetyMode(e.target.value)}
                        />
                        <span className="font-medium text-slate-800">
                          {t(`safetyOption.${op.id}.label`, { defaultValue: op.label })}
                        </span>
                      </div>
                      <div className="mt-1 pl-6 text-xs text-slate-600">
                        {t(`safetyOption.${op.id}.desc`, { defaultValue: op.description })}
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={loading || !data || saving}
                    onClick={() => void handleSaveSafetyMode()}
                    className="inline-flex items-center gap-2 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  >
                    {t("settings:saveSafety")}
                  </button>
                </div>
              </div>

              {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
            </div>
          )}
        </TabsContent>
      </Tabs>
      ) : (
        <div className="mx-auto mt-6 max-w-2xl space-y-4">
          {languagePanel}
          {personalizationPanel}
        </div>
      )}

      <div className="mx-auto mt-6 max-w-5xl">
        <LogWorkspace embedded />
      </div>
    </div>
  );
}
