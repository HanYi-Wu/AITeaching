import { useCallback, useEffect, useRef } from "react";

/**
 * Ensures template loading and saving requests only apply their responses
 * when the request scope (active path) remains current.
 */
export function useTemplateRequestScope(currentPath: string) {
  const scope = useRef({ path: currentPath, revision: 0, mounted: true });

  if (scope.current.path !== currentPath) {
    scope.current = {
      path: currentPath,
      revision: scope.current.revision + 1,
      mounted: true,
    };
  }

  useEffect(() => {
    scope.current.mounted = true;
    return () => {
      scope.current.mounted = false;
      scope.current.revision += 1;
    };
  }, []);

  const createScopeCheck = useCallback(() => {
    const revision = scope.current.revision;
    const targetPath = scope.current.path;
    return () =>
      scope.current.mounted &&
      scope.current.revision === revision &&
      scope.current.path === targetPath;
  }, []);

  const isCurrentPath = useCallback(
    (path: string) => scope.current.mounted && scope.current.path === path,
    [],
  );

  return {
    createScopeCheck,
    isCurrentPath,
  };
}
