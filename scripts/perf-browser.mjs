#!/usr/bin/env node

/**
 * Repeatable read-only browser performance probe for OriginReach.
 *
 * The probe deliberately uses ordinary browser refresh timing: no
 * --disable-frame-rate-limit, --disable-gpu-vsync, or synthetic scroll/layout
 * work. It measures main-thread rAF gaps and long tasks. In headless mode that
 * is not proof of a physical display's presented-frame rate; the report keeps
 * that distinction explicit.
 *
 * Example:
 *   node scripts/perf-browser.mjs --url http://127.0.0.1:5174 \
 *     --output .perf-evidence/baseline.json --runs 1
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_BROWSER = process.env.PERF_BROWSER || (
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome"
);

const ACCOUNTS = {
  teacher: { username: "demo_teacher", password: "teacher123" },
  admin: { username: "demo_admin", password: "demo123" },
  school: { username: "demo_school", password: "school123" },
  student: { username: "demo_student", password: "student123" },
};

const VIEWPORTS = {
  pc: { name: "pc", width: 1440, height: 900, mobile: false },
  mobile: { name: "mobile", width: 390, height: 844, mobile: true },
};

const TEACHER_ACTIONS = [
  { id: "graph", label: "知识图谱" },
  { id: "bank", label: "题库" },
  { id: "template", label: "模板" },
  { id: "compose", label: "组卷" },
  { id: "papers", label: "试卷", testId: "nav-papers" },
  { id: "students", label: "学生", testId: "nav-students" },
  { id: "analysis", label: "分析" },
  { id: "assistant", label: "智能体" },
];

const ROLE_ACTIONS = {
  teacher: TEACHER_ACTIONS,
  admin: [
    { id: "schools", label: "学校与账号" },
    { id: "ai", label: "平台 AI" },
    { id: "extensions", label: "扩展组件" },
  ],
  school: [
    { id: "overview", testId: "school-page-overview", label: "总览" },
    { id: "teachers", testId: "school-page-teachers", label: "教师" },
    { id: "classes", testId: "school-page-classes", label: "班级" },
    { id: "students", testId: "school-page-students", label: "学生" },
    { id: "assignments", testId: "school-page-assignments", label: "分配" },
    { id: "ai", testId: "school-page-ai", label: "AI" },
  ],
  student: [
    { id: "home", testId: "student-page-home", label: "主页" },
    { id: "papers", testId: "student-page-papers", label: "待答" },
    { id: "results", testId: "student-page-results", label: "成绩" },
    { id: "account", testId: "student-page-account", label: "设置" },
  ],
};

function parseArgs(argv) {
  const result = {
    url: "http://127.0.0.1:5174",
    browser: DEFAULT_BROWSER,
    output: path.resolve(".perf-evidence", `browser-${Date.now()}.json`),
    runs: 1,
    settleMs: 350,
    sampleMs: 900,
    cpu: [1, 2, 4],
    roles: Object.keys(ACCOUNTS),
    viewports: Object.keys(VIEWPORTS),
    headed: false,
    assistantDiagnostics: false,
    port: 9333,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (["headed", "assistantDiagnostics"].includes(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    if (key === "runs" || key === "settleMs" || key === "sampleMs" || key === "port") result[key] = Number(value);
    else if (key === "cpu") result.cpu = value.split(",").map(Number).filter((item) => Number.isFinite(item) && item > 0);
    else if (key === "roles") result.roles = value.split(",").filter((item) => ACCOUNTS[item]);
    else if (key === "viewports") result.viewports = value.split(",").filter((item) => VIEWPORTS[item]);
    else if (key === "output") result.output = path.resolve(value);
    else if (key === "browser") result.browser = value;
    else if (key === "url") result.url = value.replace(/\/$/, "");
    else throw new Error(`Unknown option --${key}`);
  }
  if (!result.cpu.length || !result.roles.length || !result.viewports.length) throw new Error("cpu, roles and viewports cannot be empty");
  return result;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.events.get(message.method) || []) listener(message.params);
      }
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate(expression, awaitPromise = true, sessionId) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (response?.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || response.exceptionDetails.exception?.description || "Runtime.evaluate failed");
    }
    return response?.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch { /* best effort */ }
  }
}

async function waitForJson(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

async function launchBrowser(options) {
  const profile = path.join(tmpdir(), `originreach-perf-${process.pid}-${Date.now()}`);
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-features=BackForwardCache,Translate",
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ];
  // No frame-rate or vsync disabling flags: these results are ordinary refresh-mode measurements.
  if (!options.headed) args.unshift("--headless=new");
  const child = spawn(options.browser, args, { stdio: "ignore", windowsHide: true });
  const version = await waitForJson(`http://127.0.0.1:${options.port}/json/version`);
  const pages = await waitForJson(`http://127.0.0.1:${options.port}/json/list`);
  const page = pages.find((item) => item.type === "page") || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.connect();
  const browserCdp = new CdpClient(version.webSocketDebuggerUrl);
  await browserCdp.connect();
  const gpu = await browserCdp.send("SystemInfo.getInfo").catch(() => null);
  await cdp.send("Runtime.enable").catch(() => {});
  await cdp.send("Network.enable").catch(() => {});
  return { child, profile, cdp, browserCdp, version, gpu };
}

function createBrowserDiagnostics(cdp) {
  const state = {
    consoleErrors: [],
    exceptions: [],
    loadingFailed: [],
    httpErrors: [],
  };
  const remoteValue = (item) => item?.value ?? item?.unserializableValue ?? item?.description ?? item?.objectId ?? null;
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params?.type !== "error") return;
    state.consoleErrors.push({
      timestamp: params.timestamp ?? null,
      args: (params.args || []).map(remoteValue),
      executionContextId: params.executionContextId ?? null,
      stackTrace: params.stackTrace ?? null,
    });
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const details = params?.exceptionDetails || {};
    state.exceptions.push({
      timestamp: params.timestamp ?? null,
      text: details.text ?? null,
      url: details.url ?? null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null,
      exception: details.exception?.description ?? details.exception?.value ?? null,
      stackTrace: details.stackTrace ?? null,
    });
  });
  cdp.on("Network.loadingFailed", (params) => {
    state.loadingFailed.push({
      requestId: params.requestId ?? null,
      url: params.url ?? null,
      errorText: params.errorText ?? null,
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason ?? null,
      type: params.type ?? null,
    });
  });
  cdp.on("Network.responseReceived", (params) => {
    const response = params?.response;
    if (!response || Number(response.status) < 400) return;
    state.httpErrors.push({
      requestId: params.requestId ?? null,
      url: response.url ?? null,
      status: response.status ?? null,
      statusText: response.statusText ?? null,
      mimeType: response.mimeType ?? null,
      type: params.type ?? null,
    });
  });
  return {
    reset() {
      for (const values of Object.values(state)) values.length = 0;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

const PERF_INSTALL = `(() => {
  if (window.__orPerf?.version === 2) return;
  const state = { active: null };

  const assistantSelector = 'aside[aria-label="源远教学平台 AI 助手"]';
  const isVisible = (element) => {
    if (!element || element.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const visibleAssistant = () => [...document.querySelectorAll(assistantSelector)].find(isVisible) || null;
  const nodeRect = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const assistantDiagnostics = () => {
    const roots = [...document.querySelectorAll(assistantSelector)].map((root, index) => {
      const style = window.getComputedStyle(root);
      const closeButtons = [...root.querySelectorAll('[data-assistant-close]')].map((element) => ({
        visible: isVisible(element),
        disabled: Boolean(element.disabled),
        ariaLabel: element.getAttribute('aria-label'),
        rect: nodeRect(element),
      }));
      const textareas = [...root.querySelectorAll('textarea')].map((element) => ({
        visible: isVisible(element),
        disabled: Boolean(element.disabled),
        ariaHidden: element.getAttribute('aria-hidden'),
        placeholder: element.getAttribute('placeholder'),
        className: element.className,
        rect: nodeRect(element),
      }));
      return {
        index,
        ariaHidden: root.getAttribute('aria-hidden'),
        role: root.getAttribute('role'),
        tabIndex: root.getAttribute('tabindex'),
        className: root.className,
        rect: nodeRect(root),
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          transform: style.transform,
          pointerEvents: style.pointerEvents,
        },
        closeButtons,
        textareas,
        textSample: (root.innerText || '').slice(0, 800),
      };
    });
    const mobileMore = [...document.querySelectorAll('[data-mobile-more]')].map((element) => ({
      visible: isVisible(element),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaHidden: element.getAttribute('aria-hidden'),
      text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
      rect: nodeRect(element),
    }));
    return {
      href: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      activeElement: document.activeElement?.tagName || null,
      roots,
      mobileMore,
    };
  };

  window.__orPerf = {
    version: 2,
    async start(label) {
      if (state.active) await this.stop();
      const active = {
        label,
        armedAt: performance.now(),
        startedAt: null,
        raf: [],
        longtasks: [],
        firstMutationMs: null,
        firstContentChangeMs: null,
        assistantShellReadyMs: null,
        assistantComposerPresentMs: null,
        assistantComposerReadyMs: null,
        assistantCheckScheduled: false,
        lastRaf: null,
        assistantRoots: new Set(),
      };
      const contentRoot = document.querySelector('main') || document.body || document.documentElement;
      active.observer = new PerformanceObserver((list) => {
        if (active.startedAt == null) return;
        for (const entry of list.getEntries()) {
          // The evaluate task starts just before begin()/click(). Include a
          // task overlapping the click, otherwise the first blocking task is
          // incorrectly discarded even though its rAF gap is visible.
          if (entry.startTime + entry.duration > active.startedAt) active.longtasks.push(entry.duration);
        }
      });
      try { active.observer.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }

      const captureAssistantMilestones = () => {
        const drawer = visibleAssistant();
        if (!drawer || active.startedAt == null) return;
        const elapsed = performance.now() - active.startedAt;
        const closeButton = drawer.querySelector('[data-assistant-close]');
        if (active.assistantShellReadyMs == null && isVisible(closeButton)) {
          active.assistantShellReadyMs = elapsed;
        }
        const composer = [...drawer.querySelectorAll('textarea')].find(isVisible);
        if (active.assistantComposerPresentMs == null && composer) {
          active.assistantComposerPresentMs = elapsed;
        }
        if (active.assistantComposerReadyMs == null && composer && !composer.disabled) {
          active.assistantComposerReadyMs = elapsed;
        }
      };
      const scheduleAssistantMilestones = () => {
        if (active.startedAt == null || active.assistantCheckScheduled) return;
        active.assistantCheckScheduled = true;
        requestAnimationFrame(() => {
          active.assistantCheckScheduled = false;
          if (state.active === active) captureAssistantMilestones();
        });
      };
      active.assistantObserver = new MutationObserver(() => {
        const roots = [...document.querySelectorAll(assistantSelector)];
        for (const root of roots) {
          if (active.assistantRoots.has(root)) continue;
          active.assistantRoots.add(root);
          active.assistantObserver.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
        }
        scheduleAssistantMilestones();
      });
      const assistantBody = document.body || document.documentElement;
      if (label === 'assistant') active.assistantObserver.observe(assistantBody, { childList: true });
      for (const root of label === 'assistant' ? document.querySelectorAll(assistantSelector) : []) {
        active.assistantRoots.add(root);
        active.assistantObserver.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      }

      // Observe only content mutations below main. Do not read innerText/innerHTML
      // on every mutation: those operations serialize the DOM and can force layout.
      active.mutationObserver = new MutationObserver((records) => {
        if (active.startedAt == null || !records.length) return;
        const elapsed = performance.now() - active.startedAt;
        if (active.firstMutationMs == null) active.firstMutationMs = elapsed;
        if (active.firstContentChangeMs == null) active.firstContentChangeMs = elapsed;
      });
      active.mutationObserver.observe(contentRoot, {
        subtree: true,
        childList: true,
        characterData: true,
      });

      const tick = (now) => {
        if (state.active !== active) return;
        if (active.startedAt != null && active.lastRaf != null) active.raf.push(now - active.lastRaf);
        active.lastRaf = now;
        requestAnimationFrame(tick);
      };
      state.active = active;
      requestAnimationFrame(tick);
      // Establish a rAF baseline before the click is marked. The click itself
      // resets lastRaf, so its first blocking interval is included exactly once.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { armedAt: active.armedAt, lastRaf: active.lastRaf };
    },
    begin() {
      const active = state.active;
      if (!active) return { ok: false, error: 'probe not started' };
      active.startedAt = performance.now();
      active.lastRaf = active.startedAt;
      active.raf.length = 0;
      active.longtasks.length = 0;
      active.firstMutationMs = null;
      active.firstContentChangeMs = null;
      active.assistantShellReadyMs = null;
      active.assistantComposerPresentMs = null;
      active.assistantComposerReadyMs = null;
      return { ok: true, startedAt: active.startedAt };
    },
    async stop() {
      const active = state.active;
      if (!active) return null;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const drawer = active.label === 'assistant' ? visibleAssistant() : null;
      if (drawer && active.startedAt != null) {
        const elapsed = performance.now() - active.startedAt;
        const closeButton = drawer.querySelector('[data-assistant-close]');
        if (active.assistantShellReadyMs == null && isVisible(closeButton)) active.assistantShellReadyMs = elapsed;
        const composer = [...drawer.querySelectorAll('textarea')].find(isVisible);
        if (active.assistantComposerPresentMs == null && composer) active.assistantComposerPresentMs = elapsed;
        if (active.assistantComposerReadyMs == null && composer && !composer.disabled) active.assistantComposerReadyMs = elapsed;
      }
      state.active = null;
      active.observer.disconnect();
      active.mutationObserver.disconnect();
      active.assistantObserver.disconnect();
      const values = active.raf.filter((value) => Number.isFinite(value) && value > 0);
      const longtasks = active.longtasks.filter((value) => Number.isFinite(value));
      const pct = (budget) => values.length ? values.filter((value) => value <= budget).length / values.length : null;
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : null;
      return {
        label: active.label,
        durationMs: active.startedAt == null ? null : performance.now() - active.startedAt,
        frameCount: values.length,
        frameAvgMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        frameP95Ms: percentile(0.95),
        worstFrameMs: values.length ? Math.max(...values) : null,
        budget60PassRate: pct(16.7),
        budget120PassRate: pct(8.3),
        budget144PassRate: pct(6.9),
        longTaskCount: longtasks.length,
        longTaskTotalMs: longtasks.reduce((sum, value) => sum + value, 0),
        longestTaskMs: longtasks.length ? Math.max(...longtasks) : 0,
        firstMutationMs: active.firstMutationMs,
        firstContentChangeMs: active.firstContentChangeMs,
        // Shell appearance and usable chat input are intentionally separate.
        assistantShellReadyMs: active.assistantShellReadyMs,
        assistantComposerPresentMs: active.assistantComposerPresentMs,
        assistantComposerReadyMs: active.assistantComposerReadyMs,
      };
    },
    assistantDiagnostics,
    scrollState() {
      const candidates = [
        document.scrollingElement,
        document.querySelector('main'),
        document.querySelector('[data-testid="student-page-papers"]'),
        document.querySelector('[data-testid="student-page-results"]'),
      ].filter(Boolean);
      return {
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
        nodes: candidates.map((element) => ({
          tag: element.tagName,
          testId: element.getAttribute('data-testid'),
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowY: window.getComputedStyle(element).overflowY,
        })),
      };
    },
    readiness(actionId) {
      const selectors = {
        papers: '[data-testid^="student-start-"]',
        results: '[data-testid^="student-result-"]',
        account: '[data-testid="student-account-current-password"]',
        graph: '.or-g50-container',
        assistant: 'aside[aria-label="源远教学平台 AI 助手"]',
      };
      const selector = selectors[actionId] || null;
      const nodes = selector ? [...document.querySelectorAll(selector)] : [];
      return {
        main: Boolean(document.querySelector('main')),
        selector,
        count: nodes.length,
        visibleCount: nodes.filter(isVisible).length,
      };
    },
    click({ text, testId } = {}) {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]');
      };
      let candidates = testId ? [document.querySelector('[data-testid="' + CSS.escape(testId) + '"]')] : [];
      candidates = candidates.filter(Boolean);
      if (!candidates.length && text) {
        const wanted = String(text).replace(/\\s+/g, '');
        candidates = [...document.querySelectorAll('button,[role="button"],[role="tab"]')].filter((element) => visible(element) && String(element.textContent || '').replace(/\\s+/g, '').includes(wanted));
      }
      const target = candidates.find(visible) || candidates[0];
      if (!target) return { ok: false, error: 'target not found', text, testId, visibleButtons: [...document.querySelectorAll('button')].filter(visible).slice(0, 80).map((button) => (button.innerText || '').trim()) };
      target.click();
      return { ok: true, text: target.innerText || target.getAttribute('aria-label') || testId || '' };
    },
    input(id, value) {
      const element = document.getElementById(id);
      if (!element) return { ok: false, error: 'input not found', id };
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    },
    snapshot() {
      const body = document.body?.innerText || '';
      return { href: location.href, title: document.title, body: body.slice(0, 4000), bodyLength: body.length };
    },
  };
})();`;

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  if (viewport.mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}

async function waitFor(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(100);
  }
  return false;
}

async function clearSession(cdp, origin) {
  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" }).catch(() => {});
}

async function login(cdp, account, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, "Boolean(document.querySelector('#platform-login-username'))", 20_000);
  await cdp.evaluate(PERF_INSTALL);
  const inputResults = await cdp.evaluate(`({username:window.__orPerf.input('platform-login-username', ${JSON.stringify(account.username)}),password:window.__orPerf.input('platform-login-password', ${JSON.stringify(account.password)})})`);
  const clickResult = await cdp.evaluate("(() => { const button = document.querySelector('form button[type=submit]'); if (!button) return {ok:false,error:'submit button not found'}; button.click(); return {ok:true}; })()");
  const ready = await waitFor(cdp, "!document.querySelector('#platform-login-username') && Boolean(document.querySelector('main'))", 20_000);
  await sleep(250);
  return { ready, inputResults, clickResult, snapshot: await cdp.evaluate("window.__orPerf.snapshot()") };
}

async function measureAction(cdp, action, options) {
  await cdp.evaluate(`window.__orPerf.start(${JSON.stringify(action.id)})`);
  const actionResult = await cdp.evaluate(`(() => {
    const begin = window.__orPerf.begin();
    const click = window.__orPerf.click(${JSON.stringify({ text: action.label, testId: action.testId })});
    return { begin, click };
  })()`);
  const clickResult = actionResult?.click;
  if (!clickResult?.ok) {
    await cdp.evaluate("window.__orPerf.stop()").catch(() => {});
    return { action: action.id, clickResult, begin: actionResult?.begin, error: "click failed" };
  }
  await sleep(options.sampleMs);
  const metrics = await cdp.evaluate("window.__orPerf.stop()");
  await sleep(options.settleMs);
  const readiness = await cdp.evaluate(`window.__orPerf.readiness(${JSON.stringify(action.id)})`);
  return { action: action.id, label: action.label, clickResult, begin: actionResult?.begin, readiness, ...metrics };
}

async function saveAssistantScreenshot(cdp, options, role, viewport, cpu, run) {
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const stem = path.basename(options.output).replace(/\.json$/i, "");
  const filename = path.join(
    path.dirname(options.output),
    `${stem}-assistant-${role}-${viewport.name}-cpu${cpu}-run${run}.png`,
  );
  await writeFile(filename, Buffer.from(response.data, "base64"));
  return path.relative(process.cwd(), filename);
}

async function measureScrollAction(cdp, viewport, options, actionId) {
  const scrollBefore = await cdp.evaluate("window.__orPerf.scrollState()");
  await cdp.evaluate(`window.__orPerf.start(${JSON.stringify(actionId)})`);
  const begin = await cdp.evaluate("window.__orPerf.begin()");
  const wheelEvents = [];
  for (let index = 0; index < 3; index += 1) {
    wheelEvents.push(await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(viewport.width / 2),
      y: Math.round(viewport.height / 2),
      deltaX: 0,
      deltaY: Math.round(Math.max(viewport.height * 0.7, 520)),
    }).catch((error) => ({ error: String(error) })));
    await sleep(20);
  }
  await sleep(options.sampleMs);
  const metrics = await cdp.evaluate("window.__orPerf.stop()");
  await sleep(options.settleMs);
  const scrollAfter = await cdp.evaluate("window.__orPerf.scrollState()");
  return { action: actionId, scenario: "scroll", begin, wheelEvents, scrollBefore, scrollAfter, ...metrics };
}

async function measureGraphView(cdp, viewport, options) {
  const actionId = "graph-view";
  await cdp.evaluate(`window.__orPerf.start(${JSON.stringify(actionId)})`);
  const result = await cdp.evaluate(`(() => {
    const begin = window.__orPerf.begin();
    const buttons = [...document.querySelectorAll('.or-g50-mode-tabs button')];
    const desktop = buttons.find((button) => String(button.textContent || '').replace(/\\s+/g, '') === '知识图谱');
    if (desktop) {
      desktop.click();
      return { begin, ok: true, control: 'desktop-button' };
    }
    const mobile = document.querySelector('button[aria-label="图谱视图"]');
    if (!mobile) return { begin, ok: false, error: 'graph view toggle not found' };
    mobile.click();
    return { begin, ok: true, control: 'mobile-trigger' };
  })()`);
  let option = null;
  if (result?.control === "mobile-trigger") {
    await sleep(80);
    option = await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('[data-value="graph"]')].find((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      });
      if (!item) return { ok: false, error: 'graph view menu item not found' };
      item.click();
      return { ok: true };
    })()`);
  }
  await sleep(options.sampleMs);
  const metrics = await cdp.evaluate("window.__orPerf.stop()");
  await sleep(options.settleMs);
  const readiness = await cdp.evaluate("window.__orPerf.readiness('graph')");
  return { action: actionId, scenario: "graph-view", viewport: viewport.name, result, option, readiness, ...metrics };
}

async function measureGraphDrag(cdp, viewport, options) {
  const actionId = "graph-drag";
  await cdp.evaluate(`window.__orPerf.start(${JSON.stringify(actionId)})`);
  const result = await cdp.evaluate(`(() => {
    const begin = window.__orPerf.begin();
    const node = document.querySelector('.react-flow__node');
    if (!node) return { begin, ok: false, error: 'react-flow node not found' };
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return { begin, ok: false, error: 'react-flow node has empty rect' };
    return { begin, ok: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  if (result?.ok) {
    const x = Number(result.x);
    const y = Number(result.y);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 36, y: y + 24, button: "left", buttons: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 36, y: y + 24, button: "left", buttons: 0, clickCount: 1 });
  }
  await sleep(options.sampleMs);
  const metrics = await cdp.evaluate("window.__orPerf.stop()");
  await sleep(options.settleMs);
  return { action: actionId, scenario: "graph-drag", viewport: viewport.name, result, ...metrics };
}

async function measureMobileAction(cdp, action, options, role) {
  if (role === "teacher" && (action.id === "assistant" || ["template", "students", "analysis"].includes(action.id))) {
    const opened = await cdp.evaluate("(() => { const button = document.querySelector('[data-mobile-more]'); if (!button) return {ok:false,error:'mobile more trigger not found'}; button.click(); return {ok:true}; })()");
    if (!opened?.ok) return { action: action.id, error: "mobile more menu failed", opened };
    await sleep(100);
  }
  return measureAction(cdp, action, options);
}

async function collectResourceTimings(cdp) {
  return cdp.evaluate(`performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/papers')).map((entry) => ({name:entry.name,duration:entry.duration,startTime:entry.startTime,transferSize:entry.transferSize||0}))`);
}

async function runRole(cdp, role, viewport, cpu, options, run) {
  await setViewport(cdp, viewport);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await clearSession(cdp, new URL(options.url).origin);
  const loginResult = await login(cdp, ACCOUNTS[role], options.url);
  if (!loginResult.ready) return { role, viewport: viewport.name, cpu, login: loginResult, error: "login failed" };

  const actions = ROLE_ACTIONS[role];
  const measurements = [];
  for (const action of actions) {
    // Route controls are read-only. Assistant opens its drawer; no message is sent.
    const measured = viewport.mobile ? await measureMobileAction(cdp, action, options, role) : await measureAction(cdp, action, options);
    if (options.assistantDiagnostics && action.id === "assistant") {
      measured.assistantDiagnostics = await cdp.evaluate("window.__orPerf.assistantDiagnostics()").catch((error) => ({ error: String(error) }));
      if (viewport.mobile) {
        measured.assistantScreenshot = await saveAssistantScreenshot(cdp, options, role, viewport, cpu, run).catch((error) => ({ error: String(error) }));
      }
    }
    measurements.push(measured);
    if (role === "teacher" && action.id === "graph" && !measured.error) {
      const graphView = await measureGraphView(cdp, viewport, options);
      measurements.push(graphView);
      if (!graphView.result?.error && !graphView.option?.error) {
        measurements.push(await measureGraphDrag(cdp, viewport, options));
      }
    }
    if (role === "student" && (action.id === "papers" || action.id === "results") && !measured.error) {
      measurements.push(await measureScrollAction(cdp, viewport, options, `${action.id}-scroll`));
    }
  }
  return {
    role,
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    cpuThrottle: cpu,
    login: loginResult,
    measurements,
    papersResourceTimings: await collectResourceTimings(cdp),
    finalSnapshot: await cdp.evaluate("window.__orPerf.snapshot()"),
  };
}

function flattenSummary(results) {
  const rows = [];
  for (const run of results) {
    for (const measurement of run.measurements || []) {
      if (measurement.error) continue;
      rows.push({
        role: run.role,
        viewport: run.viewport,
        cpuThrottle: run.cpuThrottle,
        action: measurement.action,
        firstContentChangeMs: measurement.firstContentChangeMs,
        scenario: measurement.scenario || "load",
        assistantShellReadyMs: measurement.assistantShellReadyMs,
        assistantComposerPresentMs: measurement.assistantComposerPresentMs,
        assistantComposerReadyMs: measurement.assistantComposerReadyMs,
        frameP95Ms: measurement.frameP95Ms,
        worstFrameMs: measurement.worstFrameMs,
        budget60PassRate: measurement.budget60PassRate,
        budget120PassRate: measurement.budget120PassRate,
        longTaskCount: measurement.longTaskCount,
        longTaskTotalMs: measurement.longTaskTotalMs,
        longestTaskMs: measurement.longestTaskMs,
      });
    }
  }
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(options.output), { recursive: true });
  const startedAt = new Date().toISOString();
  const browser = await launchBrowser(options);
  const browserDiagnostics = createBrowserDiagnostics(browser.cdp);
  const results = [];
  try {
    const browserInfo = {
      executable: options.browser,
      version: browser.version,
      gpu: browser.gpu,
      headless: !options.headed,
      frameRateFlags: { disableFrameRateLimit: false, disableGpuVsync: false },
    };
    for (let run = 1; run <= options.runs; run += 1) {
      for (const viewportName of options.viewports) {
        for (const cpu of options.cpu) {
          for (const role of options.roles) {
            process.stdout.write(`run=${run} viewport=${viewportName} cpu=${cpu} role=${role}\n`);
            browserDiagnostics.reset();
            try {
              const roleResult = await runRole(browser.cdp, role, VIEWPORTS[viewportName], cpu, options, run);
              // Allow late console/network events from the final action to arrive
              // before resetting the per-role diagnostics bucket.
              await sleep(100);
              results.push({ run, ...roleResult, diagnostics: browserDiagnostics.snapshot() });
            } catch (error) {
              await sleep(100);
              results.push({
                run,
                role,
                viewport: viewportName,
                cpuThrottle: cpu,
                error: error instanceof Error ? error.message : String(error),
                diagnostics: browserDiagnostics.snapshot(),
              });
            }
          }
        }
      }
    }
    const payload = {
      schema: "originreach-browser-performance-v1",
      startedAt,
      finishedAt: new Date().toISOString(),
      command: process.argv.slice(2),
      options: { ...options, output: path.relative(process.cwd(), options.output) },
      browser: browserInfo,
      method: {
        frameIntervals: "requestAnimationFrame callback gaps; main-thread signal only",
        longTasks: "PerformanceObserver longtask entries (>=50ms)",
        budgetsMs: { hz60: 16.7, hz120: 8.3, hz144: 6.9 },
        scrollScenario: "three Input.dispatchMouseEvent mouseWheel events over the main scroll container after student papers/results load; labeled scenario=scroll",
        diagnostics: "Runtime.exceptionThrown, console.error, Network.loadingFailed, and HTTP responses >=400 per role/viewport/cpu run",
        noSyntheticVsyncUnlock: true,
        noForcedLayoutForContentObserver: true,
      },
      results,
      summaryRows: flattenSummary(results),
    };
    await writeFile(options.output, JSON.stringify(payload, null, 2) + "\n", "utf8");
    process.stdout.write(`wrote ${options.output}\n`);
  } finally {
    browser.cdp.close();
    browser.browserCdp.close();
    browser.child.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

