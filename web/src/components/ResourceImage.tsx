import { useEffect, useState } from "react";
import { apiGetBlob, resourceApiUrl } from "../api/client";

/** Protected images must use the authenticated API, never tokens in URLs. */
export function ResourceImage({ path, className }: { path: string; className?: string }) {
  const [state, setState] = useState<{ path: string; url?: string; error?: string }>({ path });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState({ path });
    let cancelled = false;
    let objectUrl: string | undefined;
    void apiGetBlob(resourceApiUrl(path))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ path, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ path, error: "图片加载失败，请检查登录状态后重试" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, attempt]);

  if (state.path === path && state.error) {
    return (
      <span
        role="status"
        className="my-2.5 block rounded-[10px] border border-[var(--or-warning)] bg-[var(--or-warning-container)] dark:border-amber-900/40 dark:bg-amber-950/30 p-2.5 text-sm text-[var(--or-on-warning)] dark:text-amber-300"
      >
        {state.error}{" "}
        <button
          type="button"
          className="font-medium underline underline-offset-2 hover:text-[var(--or-on-warning)] dark:hover:text-amber-100"
          onClick={() => setAttempt((value) => value + 1)}
        >
          重试图片
        </button>
      </span>
    );
  }

  if (state.path !== path || !state.url) {
    return <span role="status" className="my-2 block text-xs sm:text-sm text-[var(--or-muted)]">正在加载图片…</span>;
  }

  return (
    <img
      className={className}
      src={state.url}
      alt="题目图片"
      onError={() =>
        setState((current) => ({
          ...current,
          error: "图片无法解码，请重试或联系教师重新上传",
        }))
      }
    />
  );
}
