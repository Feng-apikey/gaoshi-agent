import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── DB (for systemStatus only — draft CRUD is in storage/db.ts) ──

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "gaoshi.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  return _db;
}

// ── System ──

export function systemStatus() {
  const count = (db().prepare("SELECT count(*) as c FROM drafts").get() as any)?.c ?? 0;
  return {
    drafts: count,
    platform: os.platform(),
    memory: { total: Math.round(os.totalmem() / 1024 / 1024), free: Math.round(os.freemem() / 1024 / 1024) },
  };
}

// ── Render ──

let _browser: any = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  const launchOpts: any = { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
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
  _browser = await chromium.launch(launchOpts);
  return _browser;
}

export async function renderCard(html: string, width = 800, height = 600) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      if (type === "font" || type === "image" || type === "media") {
        return route.abort();
      }
      return route.continue();
    });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await new Promise(r => setTimeout(r, 300));

    const outDir = path.join(DATA_DIR, "images");
    fs.mkdirSync(outDir, { recursive: true });
    const filename = `render_${Date.now()}.png`;
    const outPath = path.join(outDir, filename);
    await page.screenshot({ path: outPath, fullPage: false });
    return { path: outPath, width, height };
  } finally {
    await page.close();
  }
}
