import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff, LoaderCircle, X } from "lucide-react";

import { AppearanceFields } from "../../design-system/AppearanceFields";
import {
  applyAppearance,
  appearanceTheme,
  readAppearance,
  saveAppearance,
  saveLoginAppearance,
  type Appearance,
} from "../../design-system/appearance";
import { loadSessionToken } from "../../platform/session";
import type { PlatformUser } from "../../platform/authTypes";
import { getAccountProfile, updateAccountCredentials, updateAccountProfile } from "../../platform/paperApi";

type Identity = {
  userId: string;
  sessionToken: string | null;
  generation: number;
};

type Personalization = {
  profile: PlatformUser | null;
  identity: Identity;
  appearance: Appearance;
  density: "comfortable" | "compact";
  fontScale: number;
};

type PersonalizationSaveOutcome =
  | { status: "complete" | "stale" }
  | { status: "failed"; identity: Identity; revision: number };

type Props = {
  accountUser: PlatformUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileUpdated?: (user: PlatformUser) => void;
  trigger: ReactNode;
};

function readDensity(user: PlatformUser): "comfortable" | "compact" {
  return user.preferences?.density === "compact" ? "compact" : "comfortable";
}

function readFontScale(user: PlatformUser): number {
  const scale = Number(user.preferences?.font_scale ?? 1);
  return Number.isFinite(scale) ? Math.min(1.2, Math.max(0.85, scale)) : 1;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PlatformAccountDialog({ accountUser, open, onOpenChange, onProfileUpdated, trigger }: Props) {
  const accountId = accountUser.id;
  const sessionToken = loadSessionToken();
  const identityKey = JSON.stringify([accountId, sessionToken]);
  const identityRef = useRef<Identity>({ userId: accountId, sessionToken, generation: 0 });
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [appearance, setAppearance] = useState(() => readAppearance(accountUser));
  const [density, setDensity] = useState<"comfortable" | "compact">(() => readDensity(accountUser));
  const [fontScale, setFontScale] = useState(() => readFontScale(accountUser));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const openRef = useRef(open);
  const dialogEpochRef = useRef(0);
  const loadRequestRef = useRef(0);
  const loadedIdentityRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personalizationDirtyRef = useRef(false);
  const personalizationRevisionRef = useRef(0);
  const personalizationWorkerRef = useRef<Promise<PersonalizationSaveOutcome> | null>(null);
  const onProfileUpdatedRef = useRef(onProfileUpdated);
  const latestPersonalizationRef = useRef<Personalization>({
    profile: null,
    identity: identityRef.current,
    appearance: readAppearance(accountUser),
    density: readDensity(accountUser),
    fontScale: readFontScale(accountUser),
  });
  openRef.current = open;
  onProfileUpdatedRef.current = onProfileUpdated;

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  if (identityRef.current.userId !== accountId || identityRef.current.sessionToken !== sessionToken) {
    const nextIdentity = {
      userId: accountId,
      sessionToken,
      generation: identityRef.current.generation + 1,
    };
    identityRef.current = nextIdentity;
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = false;
    loadedIdentityRef.current = null;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    latestPersonalizationRef.current = {
      profile: null,
      identity: nextIdentity,
      appearance: readAppearance(accountUser),
      density: readDensity(accountUser),
      fontScale: readFontScale(accountUser),
    };
  }

  const isCurrentIdentity = useCallback((identity: Identity) => {
    const current = identityRef.current;
    return current.userId === identity.userId &&
      current.sessionToken === identity.sessionToken &&
      current.generation === identity.generation &&
      loadSessionToken() === identity.sessionToken;
  }, []);

  const persistPersonalization = useCallback(async (): Promise<void> => {
    while (true) {
      const activeWorker = personalizationWorkerRef.current;
      if (activeWorker) {
        const outcome = await activeWorker;
        if (outcome.status === "failed" &&
          isCurrentIdentity(outcome.identity) &&
          personalizationRevisionRef.current === outcome.revision) return;
        if (!isCurrentIdentity(latestPersonalizationRef.current.identity)) return;
        continue;
      }
      if (!personalizationDirtyRef.current) return;

      const current = latestPersonalizationRef.current;
      const revision = personalizationRevisionRef.current;
      if (!isCurrentIdentity(current.identity)) return;
      if (!current.profile || current.profile.id !== current.identity.userId) {
        setSaveState("error");
        setSaveError("个人资料尚未加载完成，请稍后重试。");
        return;
      }

      const worker = (async (): Promise<PersonalizationSaveOutcome> => {
        personalizationDirtyRef.current = false;
        setSaveState("saving");
        setSaveError(null);

        try {
          const result = await updateAccountProfile({
            preferences: {
              theme: appearanceTheme(current.appearance),
              density: current.density,
              font_scale: current.fontScale,
            },
          });

          if (!isCurrentIdentity(current.identity)) return { status: "stale" };
          if (result.profile.id !== current.identity.userId) {
            personalizationDirtyRef.current = true;
            setSaveState("error");
            setSaveError("返回的账号资料与当前登录账号不匹配。");
            return { status: "failed", identity: current.identity, revision };
          }
          if (revision !== personalizationRevisionRef.current) return { status: "stale" };

          const stored = saveAppearance(result.profile.id, current.appearance);
          const loginAppearanceStored = saveLoginAppearance(current.appearance);
          latestPersonalizationRef.current = { ...current, profile: result.profile };
          setProfile(result.profile);
          applyAppearance(result.profile);
          onProfileUpdatedRef.current?.(result.profile);
          setSaveState("saved");
          setSaveError(stored && loginAppearanceStored ? null : "偏好已同步；外观会在本次会话中生效。请检查浏览器存储设置。");
          return { status: "complete" };
        } catch (error) {
          if (!isCurrentIdentity(current.identity)) return { status: "stale" };
          if (revision !== personalizationRevisionRef.current) return { status: "stale" };
          personalizationDirtyRef.current = true;
          setSaveState("error");
          setSaveError(messageFor(error));
          return { status: "failed", identity: current.identity, revision };
        }
      })();

      const trackedWorker = worker.finally(() => {
        if (personalizationWorkerRef.current === trackedWorker) personalizationWorkerRef.current = null;
      });
      personalizationWorkerRef.current = trackedWorker;
      const outcome = await trackedWorker;
      if (outcome.status === "failed" &&
        isCurrentIdentity(outcome.identity) &&
        personalizationRevisionRef.current === outcome.revision) return;
      if (!isCurrentIdentity(latestPersonalizationRef.current.identity)) return;
    }
  }, [isCurrentIdentity]);

  const schedulePersonalizationSave = useCallback((delayMs = 450) => {
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    if (autoSaveTimerRef.current !== null) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistPersonalization();
    }, delayMs);
  }, [persistPersonalization]);

  useEffect(() => {
    const current = identityRef.current;
    loadedIdentityRef.current = null;
    loadRequestRef.current += 1;
    setProfile(null);
    setLoadingProfile(false);
    setProfileError(null);
    setLoadAttempt(0);
    setAppearance(readAppearance(accountUser));
    setDensity(readDensity(accountUser));
    setFontScale(readFontScale(accountUser));
    applyAppearance(accountUser);
    setSaveState("idle");
    setSaveError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage(null);
    setPasswordError(null);
    setPasswordSaving(false);
    latestPersonalizationRef.current = {
      profile: null,
      identity: current,
      appearance: readAppearance(accountUser),
      density: readDensity(accountUser),
      fontScale: readFontScale(accountUser),
    };
  }, [identityKey]);

  useEffect(() => {
    if (!open) {
      loadRequestRef.current += 1;
      return;
    }
    const identity = identityRef.current;
    if (loadedIdentityRef.current === identityKey && latestPersonalizationRef.current.profile?.id === identity.userId) return;

    const requestId = ++loadRequestRef.current;
    setLoadingProfile(true);
    setProfileError(null);
    void getAccountProfile().then(({ profile: loadedProfile }) => {
      if (requestId !== loadRequestRef.current || !openRef.current || !isCurrentIdentity(identity)) return;
      if (loadedProfile.id !== identity.userId) throw new Error("返回的账号资料与当前登录账号不匹配");
      loadedIdentityRef.current = identityKey;
      const loadedAppearance = readAppearance(loadedProfile);
      const loadedDensity = readDensity(loadedProfile);
      const loadedFontScale = readFontScale(loadedProfile);
      latestPersonalizationRef.current = {
        profile: loadedProfile,
        identity,
        appearance: loadedAppearance,
        density: loadedDensity,
        fontScale: loadedFontScale,
      };
      setProfile(loadedProfile);
      setAppearance(loadedAppearance);
      setDensity(loadedDensity);
      setFontScale(loadedFontScale);
      applyAppearance(loadedProfile);
    }).catch((error: unknown) => {
      if (requestId !== loadRequestRef.current || !openRef.current || !isCurrentIdentity(identity)) return;
      setProfileError(messageFor(error));
    }).finally(() => {
      if (requestId === loadRequestRef.current && openRef.current && isCurrentIdentity(identity)) setLoadingProfile(false);
    });

    return () => {
      if (loadRequestRef.current === requestId) loadRequestRef.current += 1;
    };
  }, [identityKey, isCurrentIdentity, loadAttempt, open]);

  const updatePersonalization = useCallback((next: Personalization) => {
    if (!isCurrentIdentity(next.identity) || next.identity.userId !== accountId) return;
    latestPersonalizationRef.current = next;
    setAppearance(next.appearance);
    setDensity(next.density);
    setFontScale(next.fontScale);
    if (next.profile) {
      saveAppearance(next.identity.userId, next.appearance);
      saveLoginAppearance(next.appearance);
      applyAppearance({
        ...next.profile,
        preferences: {
          ...next.profile.preferences,
          theme: appearanceTheme(next.appearance),
          density: next.density,
          font_scale: next.fontScale,
        },
      });
    }
    schedulePersonalizationSave();
  }, [accountId, isCurrentIdentity, schedulePersonalizationSave]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      dialogEpochRef.current += 1;
      setPasswordMessage(null);
      setPasswordError(null);
    } else {
      dialogEpochRef.current += 1;
      loadRequestRef.current += 1;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordVisible(false);
      setPasswordSaving(false);
      setPasswordMessage(null);
      setPasswordError(null);
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (personalizationDirtyRef.current) void persistPersonalization();
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, persistPersonalization]);

  const submitPassword = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError("新密码至少需要 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    if (!currentPassword) {
      setPasswordError("请先输入当前密码");
      return;
    }

    const identity = identityRef.current;
    const dialogEpoch = dialogEpochRef.current;
    setPasswordSaving(true);
    try {
      const result = await updateAccountCredentials({ current_password: currentPassword, new_password: newPassword });
      if (!isCurrentIdentity(identity) || result.user.id !== identity.userId) return;
      const latest = latestPersonalizationRef.current;
      const updatedUser = latest.identity.userId === identity.userId && latest.profile?.id === identity.userId
        ? {
            ...result.user,
            preferences: {
              ...result.user.preferences,
              theme: appearanceTheme(latest.appearance),
              density: latest.density,
              font_scale: latest.fontScale,
            },
          }
        : result.user;
      if (updatedUser.id === identity.userId && latest.identity.userId === identity.userId) {
        latestPersonalizationRef.current = { ...latest, profile: updatedUser };
        setProfile(updatedUser);
      }
      onProfileUpdatedRef.current?.(updatedUser);
      if (openRef.current && dialogEpoch === dialogEpochRef.current) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordMessage("登录密码已修改");
      }
    } catch (error) {
      if (isCurrentIdentity(identity) && openRef.current && dialogEpoch === dialogEpochRef.current) setPasswordError(messageFor(error));
    } finally {
      if (isCurrentIdentity(identity) && openRef.current && dialogEpoch === dialogEpochRef.current) setPasswordSaving(false);
    }
  }, [confirmPassword, currentPassword, isCurrentIdentity, newPassword]);

  const profileReady = Boolean(profile && profile.id === accountId && loadedIdentityRef.current === identityKey);
  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="management-dialog-overlay" />
        <Dialog.Content className="management-dialog" aria-describedby="platform-account-description">
          <div className="management-dialog-header">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-[var(--or-text)]">个人设置</Dialog.Title>
              <Dialog.Description id="platform-account-description" className="sr-only">
                {accountUser.display_name || accountUser.username}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭个人设置" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {loadingProfile ? (
            <div className="management-notice mt-5 flex items-center gap-2" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" />正在加载个人设置…
            </div>
          ) : null}
          {profileError ? (
            <div className="management-notice mt-5 flex flex-wrap items-center justify-between gap-3" role="alert">
              <span>无法加载个人设置：{profileError}</span>
              <button type="button" className="or-button or-button-outline rounded-lg border px-3 py-1.5 text-sm" onClick={() => setLoadAttempt((value) => value + 1)}>
                重新加载
              </button>
            </div>
          ) : null}

          {profileReady ? (
            <div className="management-dialog-body space-y-5">
              <section className="management-panel">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--or-text)]">个人外观</h3>
                  </div>
                  <div className="flex items-center gap-2 text-sm" aria-live="polite">
                    {saveState === "saving" && <><LoaderCircle className="h-4 w-4 animate-spin" /><span>正在保存…</span></>}
                    {saveState === "saved" && !saveError && <span>已保存</span>}
                    {saveState === "error" && <span>保存失败</span>}
                  </div>
                </div>

                <div className="space-y-5">
                  <AppearanceFields
                    value={appearance}
                    onChange={(nextAppearance) => updatePersonalization({ ...latestPersonalizationRef.current, appearance: nextAppearance })}
                  />
                  <div className="management-form-grid">
                    <label className="management-field">
                      <span>表格密度</span>
                      <select
                        aria-label="表格密度"
                        value={density}
                        onChange={(event) => updatePersonalization({ ...latestPersonalizationRef.current, density: event.target.value === "compact" ? "compact" : "comfortable" })}
                      >
                        <option value="comfortable">舒适</option>
                        <option value="compact">紧凑</option>
                      </select>
                    </label>
                    <label className="management-field">
                      <span>字号比例</span>
                      <div className="flex items-center gap-3">
                        <input
                          aria-label="字号比例"
                          type="range"
                          min="0.85"
                          max="1.2"
                          step="0.05"
                          value={fontScale}
                          onChange={(event) => updatePersonalization({ ...latestPersonalizationRef.current, fontScale: Number(event.target.value) })}
                        />
                        <span className="w-12 text-right text-sm font-semibold text-[var(--or-muted)]">{Math.round(fontScale * 100)}%</span>
                      </div>
                    </label>
                  </div>
                </div>
                {saveError ? (
                  <div className="management-notice mt-4 flex flex-wrap items-center justify-between gap-3" role="alert">
                    <span>{saveError}</span>
                    <button
                      type="button"
                      className="or-button or-button-outline rounded-lg border px-3 py-1.5 text-sm"
                      onClick={() => {
                        setSaveError(null);
                        if (autoSaveTimerRef.current !== null) {
                          clearTimeout(autoSaveTimerRef.current);
                          autoSaveTimerRef.current = null;
                        }
                        void persistPersonalization();
                      }}
                    >
                      重试保存
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="management-panel">
                <div>
                  <h3 className="text-base font-semibold text-[var(--or-text)]">修改登录密码</h3>
                </div>
                <form className="mt-4 space-y-4" onSubmit={(event) => void submitPassword(event)}>
                  <div className="management-form-grid">
                    <label className="management-field">
                      <span>当前密码</span>
                      <input autoComplete="current-password" aria-label="当前密码" type={passwordVisible ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                    </label>
                    <label className="management-field">
                      <span>新密码</span>
                      <input autoComplete="new-password" aria-label="新密码" type={passwordVisible ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    </label>
                    <label className="management-field">
                      <span>确认新密码</span>
                      <input autoComplete="new-password" aria-label="确认新密码" type={passwordVisible ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword} className="or-button or-button-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                      {passwordSaving ? "正在修改…" : "修改密码"}
                    </button>
                    <button type="button" onClick={() => setPasswordVisible((value) => !value)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]">
                      {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {passwordVisible ? "隐藏密码" : "显示密码"}
                    </button>
                    {passwordMessage ? <span className="text-sm font-medium text-[var(--or-success)]" role="status">{passwordMessage}</span> : null}
                  </div>
                  {passwordError ? <p className="management-notice" role="alert">{passwordError}</p> : null}
                </form>
              </section>
            </div>
          ) : null}

          <div className="management-dialog-footer">
            <Dialog.Close asChild>
              <button type="button" className="or-button or-button-outline rounded-lg border px-4 py-2 text-sm font-semibold">完成</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
