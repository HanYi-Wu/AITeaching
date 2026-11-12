import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colorAlpha, installSafariChromeTint } from "./safariChromeTint";

describe("colorAlpha", () => {
  it("reads alpha from legacy and modern color syntaxes", () => {
    expect(colorAlpha("transparent")).toBe(0);
    expect(colorAlpha("rgba(0, 0, 0, 0)")).toBe(0);
    expect(colorAlpha("rgba(10, 20, 30, 0.5)")).toBe(0.5);
    expect(colorAlpha("rgb(239, 237, 240)")).toBe(1);
    expect(colorAlpha("color(srgb 0.1 0.2 0.3 / 0.09)")).toBeCloseTo(0.09);
    expect(colorAlpha("oklab(0.5 0.1 0.1 / 40%)")).toBeCloseTo(0.4);
    expect(colorAlpha("#000000")).toBe(1);
  });
});

describe("installSafariChromeTint", () => {
  const originalElementFromPoint = document.elementFromPoint;
  const originalMatchMedia = window.matchMedia;
  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const desktopSafari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: iphoneSafari, maxTouchPoints: 5 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.elementFromPoint = originalElementFromPoint;
    window.matchMedia = originalMatchMedia;
    document.documentElement.style.removeProperty("--or-chrome-top-override");
    document.body.innerHTML = "";
  });

  function mockViewport(matches = true) {
    const media = {
      matches,
      addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(media);
    return media;
  }

  it("paints html/body with the color found at the top edge and restores on uninstall", () => {
    const header = document.createElement("header");
    header.style.backgroundColor = "rgb(1, 2, 3)";
    document.body.append(header);
    mockViewport();
    document.elementFromPoint = vi.fn(() => header) as typeof document.elementFromPoint;

    const uninstall = installSafariChromeTint();
    expect(document.body.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(document.documentElement.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(document.querySelector(".or-chrome-tint")).toBeNull();

    uninstall();
    expect(document.body.style.backgroundColor).toBe("");
    expect(document.documentElement.style.backgroundColor).toBe("");
  });

  it("prefers the CSS override color", () => {
    mockViewport();
    document.elementFromPoint = vi.fn(() => null) as typeof document.elementFromPoint;
    document.documentElement.style.setProperty("--or-chrome-top-override", "rgb(0, 0, 0)");

    const uninstall = installSafariChromeTint();
    expect(document.body.style.backgroundColor).toBe("rgb(0, 0, 0)");
    uninstall();
  });

  it.each([
    [desktopSafari, 0],
    [iphoneSafari.replace("Version/26.0", "CriOS/142.0.0.0"), 5],
  ])("skips other browsers even in a narrow viewport", (userAgent, maxTouchPoints) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
    mockViewport();
    document.elementFromPoint = vi.fn(() => null);
    const observe = vi.spyOn(MutationObserver.prototype, "observe");

    installSafariChromeTint()();

    expect(window.matchMedia).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(document.elementFromPoint).not.toHaveBeenCalled();
  });

  it("only observes desktop-mode iPad Safari while its viewport is narrow", () => {
    vi.stubGlobal("navigator", { userAgent: desktopSafari, maxTouchPoints: 5 });
    const media = mockViewport(false);
    document.elementFromPoint = vi.fn(() => null);
    document.documentElement.style.setProperty("--or-chrome-top-override", "rgb(1, 2, 3)");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");

    const uninstall = installSafariChromeTint();
    const [, resize] = media.addEventListener.mock.calls[0];
    expect(observe).not.toHaveBeenCalled();

    media.matches = true;
    resize();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(document.body.style.backgroundColor).toBe("rgb(1, 2, 3)");

    disconnect.mockClear();
    media.matches = false;
    resize();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(document.body.style.backgroundColor).toBe("");
    uninstall();
  });
});
