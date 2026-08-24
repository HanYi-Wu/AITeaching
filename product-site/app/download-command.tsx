"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

export default function DownloadCommand() {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "https://<站点域名>");
  const url = `${origin}/releases/upgrade-linux.sh`;
  return <code><span>$</span> wget -qO- &quot;{url}&quot; | bash</code>;
}
