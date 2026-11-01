import type { PlatformUser } from "../platform/authTypes";
import { ACCENT_COLORS, type AccentColorKey } from "./tokens";

export type Appearance = {
  mode: "light" | "dark" | "system";
  accent: AccentColorKey;
};

type Profile = Pick<PlatformUser, "id" | "preferences">;
const keyFor = (id: string) => `or-appearance:${id}`;
const sessionValues = new Map<string, Appearance>();
const loginAppearanceKey = "or-login-appearance";
const defaultLoginAppearance: Appearance = { mode: "system", accent: "black" };
let loginSessionValue: Appearance | null = null;

function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== "object") return false;
  const appearance = value as Partial<Appearance>;
  return (
    (appearance.mode === "light" || appearance.mode === "dark" || appearance.mode === "system") &&
    typeof appearance.accent === "string" && appearance.accent in ACCENT_COLORS
  );
}

export function readLoginAppearance(): Appearance {
  if (loginSessionValue) return loginSessionValue;
  try {
    const stored = JSON.parse(localStorage.getItem(loginAppearanceKey) || "null");
    if (isAppearance(stored)) return { mode: stored.mode, accent: stored.accent };
  } catch {
    // The anonymous login appearance is optional; default to black when storage is unavailable.
  }
  return defaultLoginAppearance;
}

export function saveLoginAppearance(value: Appearance) {
  try {
    localStorage.setItem(loginAppearanceKey, JSON.stringify(value));
    loginSessionValue = null;
    return true;
  } catch {
    loginSessionValue = value;
    return false;
  }
}

export function readAppearance(profile?: Profile | null): Appearance {
  const theme = profile?.preferences?.theme;
  const fallback: Appearance = {
    mode: theme === "night" ? "dark" : theme ? "light" : "system",
    accent: theme === "forest" ? "green" : theme === "warm" ? "orange" : "blue",
  };
  if (!profile) return fallback;
  const sessionValue = sessionValues.get(profile.id);
  if (sessionValue) return sessionValue;
  try {
    const stored = JSON.parse(localStorage.getItem(keyFor(profile.id)) || "null");
    if (isAppearance(stored)) {
      return { mode: stored.mode, accent: stored.accent };
    }
  } catch {
    // Older or incomplete local preferences fall back to the account profile.
  }
  return fallback;
}

export function saveAppearance(id: string, value: Appearance) {
  sessionValues.set(id, value);
  try {
    localStorage.setItem(keyFor(id), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function appearanceTheme(value: Appearance): string {
  if (value.mode === "dark" || (value.mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)) return "night";
  return value.accent === "green" ? "forest" : value.accent === "orange" ? "warm" : "classic";
}

export function applyAppearance(profile?: Profile | null) {
  const value = profile ? readAppearance(profile) : readLoginAppearance();
  const root = document.documentElement;
  root.dataset.ehTheme = appearanceTheme(value);
  root.dataset.orAccent = value.accent;
  root.dataset.orLoginAccent = profile ? readLoginAppearance().accent : value.accent;
  root.dataset.ehDensity = profile?.preferences?.density === "compact" ? "compact" : "comfortable";
  root.style.setProperty("--or-font-scale", String(profile?.preferences?.font_scale ?? 1));
  root.style.fontSize = `${Number(profile?.preferences?.font_scale ?? 1) * 100}%`;
}

export function installAppearance(profile?: Profile | null) {
  const value = profile ? readAppearance(profile) : readLoginAppearance();
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const apply = () => applyAppearance(profile);
  apply();
  if (value.mode === "system") media?.addEventListener("change", apply);
  return () => media?.removeEventListener("change", apply);
}
