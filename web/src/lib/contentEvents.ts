import { useEffect, useRef } from "react";

export const CONTENT_LIBRARY_CHANGED_EVENT = "education-helper-content-library-changed";
export type ContentLibraryKind = "question" | "template";

export function notifyContentLibraryChanged(kind: ContentLibraryKind, source?: object) {
  window.dispatchEvent(new CustomEvent(CONTENT_LIBRARY_CHANGED_EVENT, { detail: { kind, source } }));
}

export function notifyAgentContentChanged(toolName: string, status: string) {
  if (toolName === 'bank.organize' && status === 'succeeded') notifyContentLibraryChanged('question');
}

export function useContentLibraryChanged(
  callback: (kind: ContentLibraryKind) => void,
  ignoreSource?: object,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const ignoreSourceRef = useRef(ignoreSource);
  ignoreSourceRef.current = ignoreSource;

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: ContentLibraryKind; source?: object }>).detail;
      if (detail?.source && detail.source === ignoreSourceRef.current) return;
      callbackRef.current(detail?.kind === "template" ? "template" : "question");
    };
    window.addEventListener(CONTENT_LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONTENT_LIBRARY_CHANGED_EVENT, onChanged);
  }, []);
}
