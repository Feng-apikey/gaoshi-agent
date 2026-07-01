import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { exec } from "node:child_process";
import * as os from "node:os";
import { STEALTH_INIT_SCRIPT } from "./stealth.ts";

const DEBUG_PORT = 9222;
const DEBUG_URL = `http://localhost:${DEBUG_PORT}`;

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
const _pages = new Map<string, Page>();

// Edge Chromium command-line flags to suppress automation fingerprints.
//   --disable-blink-features=AutomationControlled
//     Removes the Blink-runtime "AutomationControlled" feature that pages can
//     inspect via Permissions / NavigatorUAData. Critical for stealth.
//   --no-first-run / --no-default-browser-check
//     Skips the first-run onboarding dialog.
const EDGE_AUTOMATION_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];

/**
 * Apply the anti-bot stealth init script to a BrowserContext.
 *
 * `addInitScript` runs in the page BEFORE the page's own JavaScript executes —
 * so when platform JS reads `navigator.webdriver`, it sees `false`, not `true`.
 */
function applyStealth(ctx: BrowserContext): void {
  try {
    ctx.addInitScript({ content: STEALTH_INIT_SCRIPT });
  } catch (err) {
    console.warn("[browser-manager] addInitScript failed:", err);
  }
}

// ── Port probe + Edge launcher (CDP path) ──

async function isPortOpen(): Promise<boolean> {
  try {
    const resp = await fetch(DEBUG_URL + "/json/version", { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function launchEdgeDebugPort(): void {
  const argList = EDGE_AUTOMATION_ARGS.map((a) => `'${a}'`).join(", ");
  if (os.platform() === "win32") {
    exec(
      `powershell -Command "Start-Process 'msedge' -ArgumentList '--remote-debugging-port=${DEBUG_PORT}', ${argList}"`,
      { windowsHide: true },
      (err) => { if (err) console.error("[browser-manager] debug-port launch failed:", err.message); }
    );
  } else {
    const args = EDGE_AUTOMATION_ARGS.map((a) => `'${a}'`).join(" ");
    exec(`open -a "Microsoft Edge" --args --remote-debugging-port=${DEBUG_PORT} ${args}`, (err) => {
      if (err) console.error("[browser-manager] debug-port launch failed:", err.message);
    });
  }
}

async function connectCDP(): Promise<Browser> {
  if (await isPortOpen()) {
    return await chromium.connectOverCDP(DEBUG_URL);
  }
  launchEdgeDebugPort();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isPortOpen()) {
      return await chromium.connectOverCDP(DEBUG_URL);
    }
  }
  throw new Error("无法通过 CDP 连接到 Edge,请手动启动一次 Edge(带 --remote-debugging-port)后重试");
}

async function ensureContext(): Promise<BrowserContext> {
  if (_context) {
    try {
      const livePages = _context.pages();
      if (livePages.some((p) => !p.isClosed())) return _context;
    } catch {
      _context = null;
    }
  }
  if (_browser && !_browser.isConnected()) _browser = null;

  const browser = await connectCDP();
  _browser = browser;
  const existing = browser.contexts();
  if (existing.length > 0) {
    _context = existing[0];
  } else {
    _context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
  }
  applyStealth(_context);
  return _context;
}

// ── Page management ──

export async function getPage(key: string): Promise<Page> {
  if (_pages.has(key)) {
    const page = _pages.get(key)!;
    if (!page.isClosed()) return page;
    _pages.delete(key);
  }

  const context = await ensureContext();
  const page = await context.newPage();
  _pages.set(key, page);
  return page;
}

export async function navigateTo(key: string, url: string): Promise<Page> {
  // Release cached page to avoid beforeunload hang when the previous publish
  // left the page in a "draft saved" state that intercepts navigation.
  await releasePage(key);
  const page = await getPage(key);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

export async function releasePage(key: string): Promise<void> {
  const page = _pages.get(key);
  if (page) {
    try { await page.close(); } catch {}
    _pages.delete(key);
  }
}

/**
 * Tear down cached handles. Tests use this; production rarely needs it.
 *
 * CDP-mode: the Browser is the owner — close it.
 */
export async function disposeAll(): Promise<void> {
  for (const [, page] of _pages) {
    try { await page.close(); } catch {}
  }
  _pages.clear();
  if (_browser) {
    try { await _browser.close(); } catch {}
  }
  _browser = null;
  _context = null;
}
