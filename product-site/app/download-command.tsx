"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

export default function DownloadCommand() {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "https://<站点域名>");
  const url = `${origin}/releases/EducationHelper-1.5.0-linux-source.tar.gz`;
  return <code><span>$</span> wget &quot;{url}&quot;</code>;
}
