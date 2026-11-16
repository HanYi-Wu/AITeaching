import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { LoginLoadingDots } from "./LoginLoadingDots";
import { DesktopLoginBackdrop } from "./DesktopLoginBackdrop";
import "./PlatformLogin.css";
import {
  bootstrapAdmin,
  loginPlatform,
  saveSessionToken,
  type PlatformAuthResponse,
  type PlatformUser,
} from "../../../platform/auth";
import { useLoginMotion } from "./useLoginMotion";

type Props = {
  mode: "bootstrap" | "login";
  onAuthenticated: (user: PlatformUser) => void;
  onError: (message: string | null) => void;
};

export function PlatformLogin({ mode, onAuthenticated, onError }: Props) {
  const [username, setUsername] = useState(mode === "bootstrap" ? "admin" : "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(mode === "bootstrap" ? "管理员" : "");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const isBootstrap = mode === "bootstrap";
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const { phase, sceneRef, mobilePathRef, desktopSvgRef, sceneHeight, beginSubmitting, cancelSubmitting, finish } = useLoginMotion();
  const [chromeBottomPaper, setChromeBottomPaper] = useState(() => phase !== "splash" && phase !== "brand-exit");

  useEffect(() => {
    delete document.documentElement.dataset.orBootLogin;
    if (phase === "splash") {
      setChromeBottomPaper(false);
      return;
    }
    if (phase === "brand-exit") {
      // 在黑色幕布即将从底部上收前 120ms 提前将 html/body 切为纸色 #f2f2f2，
      // 顶部状态栏由 .or-login-chrome-top 固定条保持黑色，底部地址栏则在幕布抬起第一帧即为白色。
      const timer = window.setTimeout(() => setChromeBottomPaper(true), 170);
      return () => window.clearTimeout(timer);
    }
    setChromeBottomPaper(true);
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function showError(message: string) {
    setFormError(message);
    onError(message);
  }

  function clearError() {
    if (formError) {
      setFormError(null);
      onError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const cleanUsername = username.trim();
    const cleanDisplayName = displayName.trim();

    if (!cleanUsername) {
      showError("请输入用户名");
      return;
    }
    if (isBootstrap && !cleanDisplayName) {
      showError("请输入显示名称");
      return;
    }
    if (password.length < 6) {
      showError("密码至少 6 位");
      return;
    }

    inFlightRef.current = true;
    const submittedAt = beginSubmitting();
    setBusy(true);
    setFormError(null);
    onError(null);
    try {
      let result: PlatformAuthResponse;
      if (mode === "bootstrap") {
        result = await bootstrapAdmin({ username: cleanUsername, password, display_name: cleanDisplayName });
      } else {
        result = await loginPlatform({ username: cleanUsername, password });
      }
      saveSessionToken(result.token);
      await finish(submittedAt);
      if (mountedRef.current) onAuthenticated(result.user);
    } catch (e) {
      cancelSubmitting();
      const message = e instanceof Error ? e.message : String(e);
      showError(
        /Invalid username or password/i.test(message)
          ? "用户名或密码错误"
          : /Authentication required/i.test(message)
            ? "登录状态已失效，请重新登录"
            : /Bad Gateway|Failed to fetch|NetworkError/i.test(message)
              ? "暂时无法连接平台服务，请稍后重试或联系系统维护人员"
              : message,
      );
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <div
      className="or-login"
      data-phase={phase}
      data-mode={mode}
      data-chrome-bottom={chromeBottomPaper || (phase !== "splash" && phase !== "brand-exit") ? "paper" : "accent"}
    >
      {/* iOS Safari：顶部 60px 固定色条（位于黑色弧形幕布内部），让灵动岛状态栏始终保持品牌黑 */}
      <div className="or-login-chrome-top" aria-hidden="true" />
      <div ref={sceneRef} className="or-login-scene">
        <svg
          className="or-login-mobile-canopy"
          viewBox={`0 0 390 ${sceneHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path ref={mobilePathRef} d="M0 0 L390 0 L390 66 Q185 330 0 176 Z" />
        </svg>
        <DesktopLoginBackdrop svgRef={desktopSvgRef} />

        <div className="or-login-corner-logo" aria-hidden="true">
          <img src="/splash-logo.png" alt="" width="128" height="128" draggable="false" />
        </div>

        <section className="or-login-brand" aria-hidden="true">
          <div className="or-login-brand-heading">
            <span className="or-login-brand-mark">
              <img src="/splash-logo.png" alt="" width="128" height="128" draggable="false" />
            </span>
            <span className="or-login-brand-name">源远教学平台</span>
          </div>
        </section>

        <div className="or-login-splash" aria-hidden="true">
          <span className="or-login-splash-logo">
            <img src="/splash-logo.png" alt="" width="56" height="56" draggable="false" />
          </span>
          <span>源远教学平台</span>
        </div>

        <div className="or-login-form-pane">
          <form
            className={`or-login-form or-login-desktop-card${busy ? " is-submitting" : ""}`}
            noValidate
            aria-busy={busy}
            onSubmit={(submitEvent) => void submit(submitEvent)}
          >
          <div className="or-login-heading-wrap" data-or-stagger="1">
            <span className="or-login-heading-mark" aria-hidden="true">源 远</span>
            <div>
              <h1 className="or-login-heading">
                {isBootstrap ? "管理员初始化" : (
                  <>
                    <span className="or-login-mobile-only">统一登录</span>
                    <span className="or-login-desktop-only">登录源远教学平台</span>
                  </>
                )}
              </h1>
              {isBootstrap ? (
                <p className="or-login-heading-note">仅用于尚未初始化的平台，请先确认当前环境。</p>
              ) : null}
            </div>
          </div>

          <div className="or-login-field" data-or-stagger="2">
            <label className="or-login-label" htmlFor="platform-login-username">
              {isBootstrap ? "用户名" : (
                <>
                  <span className="or-login-mobile-only">用户名</span>
                  <span className="or-login-desktop-only">账号</span>
                </>
              )}
            </label>
            <div className="or-login-input-wrap">
              <input
                id="platform-login-username"
                className="or-login-input"
                value={username}
                placeholder={isBootstrap ? "设置管理员用户名" : "用户名 / 学工号"}
                onChange={(changeEvent) => {
                  setUsername(changeEvent.target.value);
                  clearError();
                }}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={busy}
                required
              />
            </div>
          </div>

          {isBootstrap ? (
            <div className="or-login-field" data-or-stagger="3">
              <label className="or-login-label" htmlFor="platform-login-display-name">显示名称</label>
              <div className="or-login-input-wrap">
                <input
                  id="platform-login-display-name"
                  className="or-login-input"
                  value={displayName}
                  onChange={(changeEvent) => {
                    setDisplayName(changeEvent.target.value);
                    clearError();
                  }}
                  disabled={busy}
                  required
                />
              </div>
            </div>
          ) : null}

          <div className="or-login-field" data-or-stagger="3">
            <label className="or-login-label" htmlFor="platform-login-password">密码</label>
            <div className="or-login-input-wrap">
              <input
                id="platform-login-password"
                className="or-login-input platform-login-password"
                value={password}
                placeholder="请输入至少 6 位密码"
                onChange={(changeEvent) => {
                  setPassword(changeEvent.target.value);
                  clearError();
                }}
                type={showPassword ? "text" : "password"}
                autoComplete={isBootstrap ? "new-password" : "current-password"}
                minLength={6}
                disabled={busy}
                required
              />
              <button
                className="or-login-eye"
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((value) => !value)}
                disabled={busy}
              >
                <span className="or-login-mobile-only">
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </span>
                <span className="or-login-desktop-only">
                  {showPassword ? <Eye aria-hidden="true" /> : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </div>

          {!isBootstrap ? (
            <div className="or-login-recovery" data-or-stagger="3">
              <button
                className="or-login-recovery-toggle"
                type="button"
                aria-label="忘记密码"
                aria-expanded={recoveryOpen}
                aria-controls="platform-login-recovery"
                onClick={() => setRecoveryOpen((value) => !value)}
                disabled={busy}
              >
                <span className="or-login-mobile-only">忘记密码</span>
                <span className="or-login-desktop-only">忘记密码？</span>
              </button>
              <p
                id="platform-login-recovery"
                className={`or-login-recovery-content${recoveryOpen ? " is-open" : ""}`}
                hidden={!recoveryOpen}
              >
                忘记密码请联系学校管理员；平台管理员请联系系统维护人员。
              </p>
            </div>
          ) : null}

          <div className="or-login-button-track" data-or-stagger="4">
            <button
              className="or-login-submit"
              type="submit"
              disabled={busy}
              aria-busy={busy}
              aria-label={busy ? (isBootstrap ? "正在创建" : "正在登录") : isBootstrap ? "创建并进入" : "登录"}
            >
              <span className="or-login-submit-label">
                {busy ? (isBootstrap ? "正在创建" : "正在登录") : isBootstrap ? "创建并进入" : (
                  <>
                    <span className="or-login-mobile-only">登录</span>
                    <span className="or-login-desktop-only">登 录</span>
                  </>
                )}
              </span>
              <LoginLoadingDots active={busy} />
            </button>
          </div>

          </form>
        </div>
      </div>
      <div className="or-login-error-slot" aria-hidden={formError ? undefined : true}>
        {formError ? (
          <div className="or-login-error" role="alert">
            {formError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
