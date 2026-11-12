import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToolBarState = {
  left: ReactNode;
  right: ReactNode;
};
type ToolBarActions = {
  setToolBar: (partial: Partial<ToolBarState>) => void;
  clearToolBar: () => void;
};
const ToolBarActionsContext = createContext<ToolBarActions | null>(null);

const ToolBarContext = createContext<{
  setToolBar: (partial: Partial<ToolBarState>) => void;
  clearToolBar: () => void;
  left: ReactNode;
  right: ReactNode;
} | null>(null);

export function ToolBarProvider({ children }: { children: ReactNode }) {
  const [left, setLeft] = useState<ReactNode>(null);
  const [right, setRight] = useState<ReactNode>(null);

  const setToolBar = useCallback((partial: Partial<ToolBarState>) => {
    if (partial.left !== undefined) setLeft(partial.left);
    if (partial.right !== undefined) setRight(partial.right);
  }, []);

  const clearToolBar = useCallback(() => {
    setLeft(null);
    setRight(null);
  }, []);

  const value = useMemo(
    () => ({ setToolBar, clearToolBar, left, right }),
    [setToolBar, clearToolBar, left, right],
  );
  const actions = useMemo(() => ({ setToolBar, clearToolBar }), [setToolBar, clearToolBar]);

  return <ToolBarContext.Provider value={value}><ToolBarActionsContext.Provider value={actions}>{children}</ToolBarActionsContext.Provider></ToolBarContext.Provider>;
}

export function useToolBarActions(): ToolBarActions {
  const value = useContext(ToolBarActionsContext);
  if (!value) throw new Error("useToolBarActions must be used within ToolBarProvider");
  return value;
}

export function useToolBar() {
  const ctx = useContext(ToolBarContext);
  if (!ctx) {
    throw new Error("useToolBar must be used within ToolBarProvider");
  }
  return ctx;
}
