import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const STATE_DIR = path.join(os.homedir(), process.platform === "win32" ? "AppData/Roaming/xiaohongshu-mcp" : ".xiaohongshu-mcp");
const STATE_FILE = path.join(STATE_DIR, "storage-state.json");

export interface StorageState {
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  expires: number;
}

export function loadStorageState(): StorageState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as StorageState;
    if (Date.now() > data.expires) return null;
    return data;
  } catch { return null; }
}

export function saveStorageState(cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }>, origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const data: StorageState = {
    cookies,
    origins,
    expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

export function clearStorageState(): void {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}
