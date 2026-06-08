import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { exec } from "node:child_process";
import * as os from "node:os";

const DEBUG_PORT = 9222;
const DEBUG_URL = `http://localhost:${DEBUG_PORT}`;

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
const _pages = new Map<string, Page>();

// ── CDP connection ──

async function isPortOpen(): Promise<boolean> {
  try {
    const resp = await fetch(DEBUG_URL + "/json/version", { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function launchEdge(): void {
  if (os.platform() === "win32") {
    exec(
      `powershell -Command "Start-Process 'msedge' -ArgumentList '--remote-debugging-port=${DEBUG_PORT}', '--no-first-run', '--no-default-browser-check'"`,
      { windowsHide: true },
      (err) => { if (err) console.error("[browser-manager] launch failed:", err.message); }
    );
  } else {
    exec(`open -a "Microsoft Edge" --args --remote-debugging-port=${DEBUG_PORT}`, (err) => {
      if (err) console.error("[browser-manager] launch failed:", err.message);
    });
  }
}

async function connect(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  if (await isPortOpen()) {
    _browser = await chromium.connectOverCDP(DEBUG_URL);
    return _browser;
  }

  // Auto-launch Edge with debug port
  launchEdge();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isPortOpen()) {
      _browser = await chromium.connectOverCDP(DEBUG_URL);
      return _browser;
    }
  }
  throw new Error("无法启动 Edge 浏览器，请手动打开 Edge 后重试");
}

// ── Page management ──

async function ensureContext(): Promise<BrowserContext> {
  if (_context?.browser()?.isConnected()) return _context;
  const browser = await connect();
  // Reuse existing context to preserve user's login cookies
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    _context = contexts[0];
  } else {
    _context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
  }
  return _context;
}

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
