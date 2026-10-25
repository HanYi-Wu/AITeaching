import { useCallback, useEffect, useRef } from "react";

/** Captured requests may update this view only while their identity remains current. */
export function useComposeRequestScope(scopeKey: string) {
  const scope = useRef({ key: scopeKey, revision: 0, mounted: true });
  if (scope.current.key !== scopeKey) {
    scope.current = { ...scope.current, key: scopeKey, revision: scope.current.revision + 1 };
  }
  useEffect(() => {
    scope.current.mounted = true;
    return () => {
      scope.current.mounted = false;
      scope.current.revision += 1;
    };
  }, []);
  return useCallback(() => {
    const revision = scope.current.revision;
    return () => scope.current.mounted && scope.current.revision === revision;
  }, []);
}
