import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { PlatformUser } from "./authTypes";
import { getManagementOptions, type ManagementOptions } from "./managementApi";
import { loadSessionToken } from "./session";
import { canManage } from "./managementAccess";

const OPTIONS_CHANGED = "solaire:management-options-changed";
const OptionsContext = createContext<ManagementOptions | null>(null);
const ManagementUserContext = createContext<PlatformUser | null>(null);

export function notifyManagementOptionsChanged() {
  window.dispatchEvent(new Event(OPTIONS_CHANGED));
}

export function ManagementOptionsProvider({ value, user, children }: { value: ManagementOptions | null; user?: PlatformUser; children: ReactNode }) {
  return <ManagementUserContext.Provider value={user ?? null}><OptionsContext.Provider value={value}>{children}</OptionsContext.Provider></ManagementUserContext.Provider>;
}

export function useManagementDictionary() {
  return useContext(OptionsContext);
}

export function useManagementCapability(permission: string) {
  const user = useContext(ManagementUserContext);
  return user ? canManage(user, permission) : true;
}

export function useManagementOptions(user: PlatformUser): ManagementOptions | null {
  const sessionToken = loadSessionToken();
  const identity = JSON.stringify([user.id, user.school_id, user.role, sessionToken]);
  const currentIdentity = useRef(identity);
  const [snapshot, setSnapshot] = useState<{ identity: string; options: ManagementOptions } | null>(null);
  currentIdentity.current = identity;

  useEffect(() => {
    if (user.role !== "admin" && user.role !== "school") return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      void getManagementOptions(user.role as "admin" | "school").then((options) => {
        if (!active || currentIdentity.current !== identity || requestRevision !== revision || loadSessionToken() !== sessionToken) return;
        if (options?.settings && Array.isArray(options.subjects) && Array.isArray(options.grades)) {
          setSnapshot({ identity, options });
        }
      }).catch(() => {
        // Free-text entry and existing defaults stay usable if suggestions cannot load.
      });
    };
    refresh();
    window.addEventListener(OPTIONS_CHANGED, refresh);
    return () => {
      active = false;
      revision += 1;
      window.removeEventListener(OPTIONS_CHANGED, refresh);
    };
  }, [identity, sessionToken, user.role]);

  return snapshot?.identity === identity ? snapshot.options : null;
}
