import { FormEvent, useState } from "react";
import { BookOpenCheck, Eye, EyeOff, KeyRound, LogIn, UserPlus } from "lucide-react";
import {
  bootstrapAdmin,
  loginPlatform,
  saveSessionToken,
  type PlatformAuthResponse,
  type PlatformUser,
} from "../../../platform/auth";

type Props = {
  mode: "bootstrap" | "login";
  onAuthenticated: (user: PlatformUser) => void;
  onError: (message: string | null) => void;
};

export function PlatformLogin({ mode, onAuthenticated, onError }: Props) {
  const [username, setUsername] = useState(mode === "bootstrap" ? "admin" : "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(mode === "bootstrap" ? "Administrator" : "");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isBootstrap = mode === "bootstrap";

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
      onAuthenticated(result.user);
    } catch (e) {
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
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex-1 bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:flex lg:items-center lg:justify-center lg:py-12">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:min-h-[620px] lg:grid-cols-[1.05fr_1fr]">
        <section className="relative overflow-hidden bg-slate-950 p-6 text-white sm:p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500"><BookOpenCheck className="h-6 w-6" /></span>
            <div><p className="text-xl font-semibold">源远教学平台</p><p className="text-xs font-medium tracking-[0.22em] text-indigo-200">ORIGINREACH · OR</p></div>
          </div>
          <div className="relative mt-8 sm:mt-14 lg:mt-0">
            <p className="mb-4 text-sm font-semibold tracking-[0.2em] text-indigo-300">教学 · 考试 · 成长</p>
            <h1 className="max-w-md text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">从备课到反馈，<br />让每一步都有依据。</h1>
            <p className="mt-5 hidden max-w-md text-sm leading-7 text-slate-300 sm:block">题库、组卷、答题、批改与学情分析，围绕同一教学流程协同工作。</p>
          </div>
          <p className="relative mt-12 hidden text-xs text-slate-400 sm:block">源远智能体可辅助教师操作；成绩和关键决策仍由教师把关。</p>
        </section>
        <div className="flex items-center justify-center p-5 sm:p-10 lg:p-14">
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            {isBootstrap ? <UserPlus className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950">
              {isBootstrap ? "创建管理员账户" : "登录平台"}
            </h2>
            <p className="text-sm text-slate-500">
              {isBootstrap ? "首次使用平台时需要初始化管理员。" : "使用管理员、学校、教师或学生账户进入。"}
            </p>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">用户名</span>
          <input
            value={username}
            placeholder={isBootstrap ? "设置管理员用户名" : "用户名 / 学号（不重号时可用）"}
            onChange={(event) => {
              setUsername(event.target.value);
              clearError();
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
            autoComplete="username"
            required
          />
        </label>

        {isBootstrap && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium text-slate-700">显示名称</span>
            <input
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                clearError();
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">密码</span>
          <span className="relative block">
            <input
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearError();
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
              type={showPassword ? "text" : "password"}
              autoComplete={isBootstrap ? "new-password" : "current-password"}
              minLength={6}
              required
            />
            <button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>

        {!isBootstrap ? <p className="mb-5 text-xs leading-5 text-slate-500">账号由学校或平台管理员创建。忘记密码请联系学校管理员；平台管理员请联系系统维护人员重置。</p> : null}

        {formError && (
          <div
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isBootstrap ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {busy ? "处理中" : isBootstrap ? "创建并进入" : "登录"}
        </button>
      </form>
        </div>
      </div>
    </div>
  );
}
