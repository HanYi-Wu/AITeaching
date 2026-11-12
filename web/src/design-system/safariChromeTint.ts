/**
 * iOS Safari（iOS 26 “液态玻璃”界面）不会把网页内容画到状态栏/灵动岛与底部地址栏下面，
 * 而是给这两条区域填一种颜色。真机测试（public/safari-bar-test.html）结论：
 *   - 页面没有合适的边缘固定元素时，两条都使用 body 的背景色，且运行中修改也会实时生效；
 *   - 过细的边缘固定条（5px）、铺满全屏的固定层不会被采用，反而会让两条退回系统默认灰色。
 * 应用原先 body 是 --or-page 浅灰（#EFEDF0），所以上下两条一直是浅灰色，看起来像被遮挡。
 *
 * 这里在手机尺寸下把 html/body 的背景色实时设为“页面顶部边缘的颜色”。手机端 html/body
 * 完全被应用根节点盖住，修改它们只影响这两条系统栏。颜色优先取 :root 上的 CSS 覆盖变量
 * `--or-chrome-top-override`（登录页开屏动画等场景使用），否则自动取顶部边缘实际内容的背景色。
 */

const MOBILE_QUERY = "(max-width: 899.98px)";
const SETTLE_MS = 240;
const OBSERVED_ATTRIBUTES = [
  "class",
  "style",
  "hidden",
  "open",
  "data-state",
  "data-phase",
  "data-chrome-bottom",
  "data-ready",
  "data-curtain",
  "data-or-boot-login",
  "data-eh-theme",
  "data-or-accent",
  "data-or-login-accent",
];

/** Returns the alpha channel of a computed CSS color string (1 when unknown). */
export function colorAlpha(color: string): number {
  const value = color.trim().toLowerCase();
  if (!value || value === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(value);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const legacy = /^rgba?\(([^)]*)\)$/.exec(value);
  if (legacy) {
    const parts = legacy[1].split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 4) {
      const alpha = parts[3];
      return alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
    }
  }
  return 1;
}

function isIgnoredChromeBar(element: Element): boolean {
  return (
    element.classList.contains("or-login-chrome-top") ||
    element.classList.contains("or-login-handoff-top")
  );
}

function elementAt(x: number, y: number): Element | null {
  if (typeof document.elementsFromPoint === "function") {
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (!isIgnoredChromeBar(candidate)) return candidate;
    }
    return null;
  }
  const hit = document.elementFromPoint(x, y);
  return hit && !isIgnoredChromeBar(hit) ? hit : null;
}

/** The app's page color, used when nothing opaque is found at an edge. */
function pageColor(): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--or-page").trim();
  return value || null;
}

/**
 * Finds the first (nearly) opaque background color at a viewport point.
 * `html` / `body` are skipped on purpose: their inline background is driven by this module.
 */
function sampleBackground(x: number, y: number): string | null {
  let element: Element | null = elementAt(x, y);
  while (element && element !== document.body && element !== document.documentElement) {
    const background = getComputedStyle(element).backgroundColor;
    if (colorAlpha(background) >= 0.95) return background;
    element = element.parentElement;
  }
  return pageColor();
}

function isIosSafari({ userAgent, maxTouchPoints }: Navigator): boolean {
  // iPadOS Safari can use the macOS Safari user agent in desktop browsing mode.
  const isIosDevice =
    /\b(?:iPhone|iPad|iPod)\b/.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
  return isIosDevice && /\bVersion\/[\d.]+(?: Mobile\/\w+)? Safari\/[\d.]+$/.test(userAgent);
}

export function installSafariChromeTint(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) {
    return () => {};
  }
  if (
    !isIosSafari(window.navigator) ||
    typeof window.matchMedia !== "function" ||
    typeof document.elementFromPoint !== "function"
  ) {
    return () => {};
  }

  const root = document.documentElement;
  const body = document.body;
  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  const originalRootBackground = root.style.backgroundColor;
  const originalBodyBackground = body.style.backgroundColor;

  const setCanvasColor = (color: string | null) => {
    if (!color) return;
    for (const element of [root, body]) {
      if (element.style.backgroundColor !== color) element.style.backgroundColor = color;
    }
  };
  const restoreCanvasColor = () => {
    root.style.backgroundColor = originalRootBackground;
    body.style.backgroundColor = originalBodyBackground;
  };

  const update = () => {
    if (!mobileMedia.matches) {
      restoreCanvasColor();
      return;
    }
    if (root.dataset.orBootLogin === "true") {
      const bootAccent = getComputedStyle(root).getPropertyValue("--or-login-accent-color").trim() || "#000000";
      setCanvasColor(bootAccent);
      return;
    }
    const width = window.innerWidth || root.clientWidth;
    if (!width) return;
    const override = getComputedStyle(root).getPropertyValue("--or-chrome-top-override").trim();
    setCanvasColor(override || sampleBackground(Math.round(width / 2), 2));
  };

  let rafId: number | null = null;
  let settleTimer: number | null = null;
  const schedule = () => {
    if (!mobileMedia.matches) return;
    if (rafId === null) {
      if (typeof window.requestAnimationFrame === "function") {
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          update();
        });
      } else {
        update();
      }
    }
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      update();
    }, SETTLE_MS);
  };

  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
  const updateViewport = () => {
    observer?.disconnect();
    if (mobileMedia.matches) {
      observer?.observe(body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: OBSERVED_ATTRIBUTES,
      });
      observer?.observe(root, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
    }
    update();
  };

  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  mobileMedia.addEventListener?.("change", updateViewport);

  updateViewport();

  return () => {
    observer?.disconnect();
    if (rafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(rafId);
    }
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("scroll", schedule, { capture: true });
    mobileMedia.removeEventListener?.("change", updateViewport);
    restoreCanvasColor();
  };
}
