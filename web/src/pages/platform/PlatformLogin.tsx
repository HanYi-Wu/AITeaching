import { FormEvent, useState } from "react";
import { KeyRound, LogIn, UserPlus } from "lucide-react";
import {
  bootstrapAdmin,
  loginPlatform,
  saveSessionToken,
  type PlatformAuthResponse,
  type PlatformUser,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

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
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformShell
      roleLabel="平台入口"
      title={isBootstrap ? "创建管理员账户" : "登录平台"}
      subtitle={isBootstrap ? "首次使用当前项目时需要初始化管理员。" : "使用平台账号进入对应端。"}
    >
      <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            {isBootstrap ? <UserPlus className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">
              {isBootstrap ? "创建管理员账户" : "登录平台"}
            </h1>
            <p className="text-sm text-slate-500">
              {isBootstrap ? "首次使用当前项目时需要初始化管理员。" : "使用管理员、学校、教师或学生账户进入。"}
            </p>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">用户名</span>
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              clearError();
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            />
          </label>
        )}

        <label className="mb-5 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">密码</span>
          <input
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearError();
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
            type="password"
            autoComplete={isBootstrap ? "new-password" : "current-password"}
            minLength={6}
            required
          />
        </label>

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
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
        >
          {isBootstrap ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {busy ? "处理中" : isBootstrap ? "创建并进入" : "登录"}
        </button>
      </form>
      </div>
    </PlatformShell>
  );
}
