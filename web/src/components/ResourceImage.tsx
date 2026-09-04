import { useEffect, useState } from "react";
import { apiGetBlob, resourceApiUrl } from "../api/client";

/** Protected images must use the authenticated API, never tokens in URLs. */
export function ResourceImage({ path, className }: { path: string; className?: string }) {
  const [state, setState] = useState<{ path: string; url?: string; error?: string }>({ path });
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void apiGetBlob(resourceApiUrl(path)).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ path, url: objectUrl });
    }).catch(() => { if (!cancelled) setState({ path, error: "图片加载失败，请检查登录状态后重试" }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  if (state.path !== path || !state.url) return <span role="status">{state.path === path && state.error ? state.error : "正在加载图片…"}</span>;
  return <img className={className} src={state.url} alt="题目图片" />;
}
