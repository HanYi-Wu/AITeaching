import { useEffect, useRef } from "react";

export const CONTENT_LIBRARY_CHANGED_EVENT = "education-helper-content-library-changed";
export type ContentLibraryKind = "question" | "template";

export function notifyContentLibraryChanged(kind: ContentLibraryKind) {
  window.dispatchEvent(new CustomEvent(CONTENT_LIBRARY_CHANGED_EVENT, { detail: { kind } }));
}

export function notifyAgentContentChanged(toolName: string, status: string) {
  if (toolName === 'bank.organize' && status === 'succeeded') notifyContentLibraryChanged('question');
}

export function useContentLibraryChanged(callback: (kind: ContentLibraryKind) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: ContentLibraryKind }>).detail;
      callbackRef.current(detail?.kind === "template" ? "template" : "question");
    };
    window.addEventListener(CONTENT_LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONTENT_LIBRARY_CHANGED_EVENT, onChanged);
  }, []);
}
