import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAppearance,
  installAppearance,
  readLoginAppearance,
  readAppearance,
  saveLoginAppearance,
  saveAppearance,
} from "./appearance";

describe("appearance preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-eh-theme");
    document.documentElement.removeAttribute("data-or-accent");
    document.documentElement.removeAttribute("data-or-login-accent");
  });

  it("uses black for an anonymous login until this device has a saved appearance", () => {
    expect(readLoginAppearance()).toEqual({ mode: "system", accent: "black" });

    applyAppearance(null);

    expect(document.documentElement.dataset.orAccent).toBe("black");
    expect(document.documentElement.dataset.orLoginAccent).toBe("black");
  });

  it("remembers only the anonymous appearance across reloads", async () => {
    expect(saveLoginAppearance({ mode: "dark", accent: "black" })).toBe(true);
    expect(JSON.parse(localStorage.getItem("or-login-appearance") || "null")).toEqual({ mode: "dark", accent: "black" });

    vi.resetModules();
    const reloaded = await import("./appearance");
    expect(reloaded.readLoginAppearance()).toEqual({ mode: "dark", accent: "black" });
    reloaded.applyAppearance(null);
    expect(document.documentElement.dataset.ehTheme).toBe("night");
    expect(document.documentElement.dataset.orLoginAccent).toBe("black");
  });

  it("keeps each account's saved appearance separate", () => {
    const teacherA = { id: "teacher-a", preferences: {} };
    const teacherB = { id: "teacher-b", preferences: {} };

    saveAppearance(teacherA.id, { mode: "dark", accent: "purple" });

    expect(readAppearance(teacherA)).toEqual({ mode: "dark", accent: "purple" });
    expect(readAppearance(teacherB)).toEqual({ mode: "system", accent: "blue" });
  });

  it("keeps the device login accent separate from the active account accent", () => {
    const teacher = { id: "teacher-login-separation", preferences: {} };
    saveLoginAppearance({ mode: "dark", accent: "purple" });
    saveAppearance(teacher.id, { mode: "light", accent: "green" });

    applyAppearance(teacher);
    expect(document.documentElement.dataset.orAccent).toBe("green");
    expect(document.documentElement.dataset.orLoginAccent).toBe("purple");

    applyAppearance(null);
    expect(document.documentElement.dataset.orAccent).toBe("purple");
    expect(document.documentElement.dataset.orLoginAccent).toBe("purple");
  });

  it("maps legacy theme preferences to their appearance settings", () => {
    expect(readAppearance({ id: "legacy-night", preferences: { theme: "night" } })).toEqual({
      mode: "dark",
      accent: "blue",
    });
    expect(readAppearance({ id: "legacy-forest", preferences: { theme: "forest" } })).toEqual({
      mode: "light",
      accent: "green",
    });
    expect(readAppearance({ id: "legacy-warm", preferences: { theme: "warm" } })).toEqual({
      mode: "light",
      accent: "orange",
    });
  });

  it("applies system color changes and removes its listener on cleanup", () => {
    let prefersDark = false;
    let onChange: (() => void) | undefined;
    const media = {
      get matches() {
        return prefersDark;
      },
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        onChange = listener as () => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => media));

    const cleanup = installAppearance({ id: "system-user", preferences: {} });
    expect(document.documentElement.dataset.ehTheme).toBe("classic");

    prefersDark = true;
    onChange?.();
    expect(document.documentElement.dataset.ehTheme).toBe("night");

    cleanup();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", onChange);
  });

  it("loads a saved appearance from storage for a fresh profile after reload", async () => {
    saveAppearance("teacher-reloaded", { mode: "light", accent: "green" });

    const profileAfterReload = {
      id: "teacher-reloaded",
      preferences: { theme: "night" },
    };

    vi.resetModules();
    const reloaded = await import("./appearance");
    expect(reloaded.readAppearance(profileAfterReload)).toEqual({ mode: "light", accent: "green" });
  });

  it("keeps the saved appearance usable for this session if local storage rejects a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage denied"); });
    expect(saveAppearance("restricted-account", { mode: "dark", accent: "orange" })).toBe(false);
    expect(readAppearance({ id: "restricted-account", preferences: {} })).toEqual({ mode: "dark", accent: "orange" });
    expect(readAppearance({ id: "other-restricted-account", preferences: {} }).accent).toBe("blue");
  });

  it("keeps the anonymous login appearance usable for this session if local storage rejects a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage denied"); });
    expect(saveLoginAppearance({ mode: "light", accent: "black" })).toBe(false);
    expect(readLoginAppearance()).toEqual({ mode: "light", accent: "black" });
  });
});
