import type { Page, Locator } from "playwright";
import { sleep, humanClick, withIdleMouseMove, waitForUploadComplete } from "./humanize.ts";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import * as path from "node:path";
import { getDB } from "../storage/db.ts";
import { materials } from "../storage/schema.ts";
import { eq } from "drizzle-orm";

// Module-level path cache populated by validateMaterials (in index.ts),
// consumed here to avoid hitting the DB on every upload call.
const _knownPaths = new Map<string, string>();
export function cacheMaterialPath(id: string, absPath: string): void {
  _knownPaths.set(id, absPath);
}
export function clearPathCache(): void {
  _knownPaths.clear();
}

// ── DOM helpers ──

export async function fillField(page: Page, loc: Locator, text: string): Promise<void> {
  await humanClick(page, loc);
  await sleep(400);
  await page.keyboard.press("Control+a");
  // Reuse the humanize pasteText for consistency (clipboard + Ctrl+V)
  const { pasteText } = await import("./humanize.ts");
  await pasteText(page, text);
  await sleep(700);
}

/**
 * Try to click the first visible button matching any of the given patterns.
 * Returns true if a button was found and clicked.
 */
export async function clickButton(page: Page, patterns: RegExp[], sleepMs = 2000): Promise<boolean> {
  for (const name of patterns) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await humanClick(page, btn);
        await sleep(sleepMs);
        return true;
      }
    } catch {}
  }
  return false;
}

// ── OS file dialog upload (拟人化 5 段时序) ──

/**
 * Escape special SendKeys characters: { } ( ) + ^ % ~ \ '
 * Windows filenames rarely contain most of these, but [ ] may appear in
 * cross-platform files. PowerShell single quotes are escaped by doubling.
 */
function escapeSendKeys(s: string): string {
  return s
    .replace(/[{}()^%+~]/g, "{$&}")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''");
}

/**
 * Resolve materialId → absolute file path. Reuses the cache populated by
 * index.ts validateMaterials; falls back to materials table; final fallback
 * to data/<id> on disk.
 */
function resolveMaterialPath(materialId: string, knownPath?: string): string {
  if (knownPath && existsSync(knownPath)) return knownPath;
  if (_knownPaths.has(materialId) && existsSync(_knownPaths.get(materialId)!)) {
    return _knownPaths.get(materialId)!;
  }
  try {
    const db = getDB();
    const row = db.select().from(materials).where(eq(materials.id, materialId)).get() as any;
    if (row?.path && existsSync(row.path)) return row.path;
  } catch {}
  const fallback = path.resolve(process.cwd(), "data", materialId);
  if (existsSync(fallback)) return fallback;
  throw new Error(`素材文件不存在：${materialId}`);
}

function findUploadZone(page: Page, absPath: string): Promise<Locator> {
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(absPath);
  const hints = isVideo
    ? [/可将视频拖拽到此处|可直接将视频文件拖入|点击上传视频|选择视频|点击上传|上传视频/]
    : [/可将图片拖拽到此处|可直接将图片文件拖入|点击上传图片|选择图片|上传图片|上传封面|添加封面|封面/];
  return (async () => {
    for (const hint of hints) {
      const loc = page.getByText(hint).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) return loc;
    }
    throw new Error("找不到上传区域");
  })();
}

/**
 * Upload a single file via the native OS file dialog. Sequential calls are
 * required for multiple files — caller loops and awaits each upload.
 *
 * 5-stage sequence:
 *  1. Resolve materialId → absPath (DB → cache → data/ fallback)
 *  2. Find upload zone, click → triggers native dialog (mouse 抖动 OK here)
 *  3. Wait for dialog to materialize
 *  4. PowerShell SendKeys injects path + Alt+O (page 操作全停)
 *  5. bringToFront + DOM 探测上传完成 (mouse 抖动 OK here)
 */
export async function uploadFile(page: Page, materialId: string, knownPath?: string): Promise<void> {
  if (!materialId) throw new Error("素材 ID 为空");

  const absPath = resolveMaterialPath(materialId, knownPath);
  const uploadEl = await findUploadZone(page, absPath);
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(absPath);

  // Stage 1+2: trigger native file dialog (mouse 抖动可包, page 还在焦点)
  await withIdleMouseMove(page, async () => {
    await humanClick(page, uploadEl);
    // 800-1200ms 等 OS dialog 物化（PowerShell 冷启动 + Windows 文件对话框初始化）
    await sleep(800 + Math.floor(Math.random() * 400));
  });

  // Stage 3: PowerShell SendKeys 注入路径 (page 操作全停, mouse 抖动不包)
  // Alt+N 先确保焦点在文件名输入框（Windows 11 某些 build 默认焦点不在）
  const dialogWait = 300 + Math.floor(Math.random() * 200);   // 300-500ms
  const shortWait = 200 + Math.floor(Math.random() * 200);   // 200-400ms
  const escaped = escapeSendKeys(absPath);
  const psCmd =
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `Start-Sleep -Milliseconds ${dialogWait}; ` +
    `[System.Windows.Forms.SendKeys]::SendWait('%n'); ` +
    `Start-Sleep -Milliseconds ${shortWait}; ` +
    `[System.Windows.Forms.SendKeys]::SendWait('${escaped}'); ` +
    `Start-Sleep -Milliseconds ${shortWait}; ` +
    `[System.Windows.Forms.SendKeys]::SendWait('%o')`;
  await new Promise<void>((resolve, reject) => {
    exec(`powershell -Command "${psCmd}"`, { windowsHide: true, timeout: 15000 },
      (err) => err ? reject(err) : resolve()
    );
  });

  // Stage 4: 抢回焦点到浏览器
  await page.bringToFront();
  await sleep(300 + Math.floor(Math.random() * 300));   // 300-600ms

  // Stage 5: 等这次上传完成 (mouse 抖动可包, page 已重获焦点)
  // waitForUploadComplete 内部用 DOM 探测 "重新上传/已上传/上传成功" 文案,
  // 不再用 networkidle (分片上传不等就 timeout, 视频 silently 失败)。
  await withIdleMouseMove(page, () => waitForUploadComplete(page, isVideo));
}
