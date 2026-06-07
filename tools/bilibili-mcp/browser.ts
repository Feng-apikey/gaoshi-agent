import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { loadStorageState, saveStorageState } from "./cookies.ts";
import { resetMousePosition } from "./humanize.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const ANTI_DETECT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'plugins', {
  get: () => { const arr = [1,2,3,4,5]; arr.item=()=>null; arr.namedItem=()=>null; arr.refresh=()=>{}; return arr; },
});
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => { const arr = [1,2,3,4]; arr.item=()=>null; arr.namedItem=()=>null; return arr; },
});
if (!window.chrome) { window.chrome = { runtime:{}, loadTimes:()=>{}, csi:()=>{}, app:{} }; }
const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
window.navigator.permissions.query = (p) => p.name==='notifications'? Promise.resolve({state:Notification.permission}) : origQuery(p);
delete window.__playwright__; delete window.__pw_manual; delete window.__PW_inspect;
`.trim();

export class BrowserManager {
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _page: Page | null = null;
  private _launched = false;
  private _headless: boolean;

  constructor(opts?: { headless?: boolean }) {
    this._headless = opts?.headless ?? false;
  }

  async launch(): Promise<Page> {
    if (this._launched && this._page && !this._page.isClosed()) return this._page;
    try { await this.persistState(); } catch {}
    await this._context?.close().catch(() => {});
    await this._browser?.close().catch(() => {});

    const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"];
    const launchOpts: any = { headless: this._headless, args };

    const bp = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (bp) {
      try {
        const entries = fs.readdirSync(bp).filter(f => f.startsWith("chromium-"));
        if (entries.length > 0) {
          const exe = path.join(bp, entries[0], "chrome-win64", "chrome.exe");
          if (fs.existsSync(exe)) launchOpts.executablePath = exe;
        }
      } catch {}
    }

    this._browser = await chromium.launch(launchOpts);

    const state = loadStorageState();
    const storageState = state ? { cookies: state.cookies, origins: state.origins } : undefined;

    this._context = await this._browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      colorScheme: "light",
      storageState,
    });
    await this._context.addInitScript(ANTI_DETECT_SCRIPT);
    this._page = await this._context.newPage();
    this._launched = true;
    resetMousePosition();
    return this._page;
  }

  async persistState(): Promise<void> {
    const ctx = this._context;
    if (!ctx) { console.error("[browser] persistState skipped: no context"); return; }
    try {
      const state = await ctx.storageState();
      console.error(`[browser] persistState: ${state.cookies.length} cookies, ${state.origins?.length ?? 0} origins`);
      saveStorageState(state.cookies, state.origins ?? []);
    } catch (err: any) {
      console.error("[browser] persistState failed:", err.message);
    }
  }

  async close(): Promise<void> {
    await this._context?.close().catch(() => {});
    await this._browser?.close().catch(() => {});
    this._page = null;
    this._context = null;
    this._browser = null;
    this._launched = false;
  }
}