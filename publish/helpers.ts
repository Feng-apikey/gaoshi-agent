import type { Page, Locator } from "playwright";
import { sleep, humanClick, pasteText, waitForUploadComplete, withIdleMouseMove } from "./humanize.ts";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import * as path from "node:path";
import { getDB } from "../storage/db.ts";
import { materials } from "../storage/schema.ts";
import { eq } from "drizzle-orm";

// Module-level path cache populated by validateMaterials, consumed by uploadFile
const _knownPaths = new Map<string, string>();
export function cacheMaterialPath(id: string, absPath: string): void {
  _knownPaths.set(id, absPath);
}
export function clearPathCache(): void {
  _knownPaths.clear();
}

export async function fillField(page: Page, loc: Locator, text: string): Promise<void> {
  await humanClick(page, loc);
  await sleep(400);
  await page.keyboard.press("Control+a");
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

/**
 * Upload a file via real OS file dialog.
 *
 * humanClick triggers the native file picker → PowerShell SendKeys fills
 * the path and presses Alt+O → the dialog closes and the browser dispatches
 * a trusted change event (isTrusted: true).
 */
export async function uploadFile(page: Page, materialId: string, knownPath?: string): Promise<void> {
  if (!materialId) throw new Error("素材 ID 为空");

  // Resolve material ID → real file path
  let absPath: string;
  if (knownPath && existsSync(knownPath)) {
    absPath = knownPath;
  } else if (_knownPaths.has(materialId) && existsSync(_knownPaths.get(materialId)!)) {
    absPath = _knownPaths.get(materialId)!;
  } else {
    try {
      const db = getDB();
      const row = db.select().from(materials).where(eq(materials.id, materialId)).get() as any;
      if (row?.path && existsSync(row.path)) {
        absPath = row.path;
      } else {
        // Fallback: try data/<materialId>
        const fallback = path.resolve(process.cwd(), 'data', materialId);
        if (existsSync(fallback)) absPath = fallback;
        else throw new Error(`素材文件不存在：${materialId}`);
      }
    } catch (err: any) {
      throw new Error(`素材路径解析失败：${err.message}`);
    }
  }

  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(absPath);
  const hints = isVideo
    ? [/可将视频拖拽到此处|可直接将视频文件拖入|点击上传视频|选择视频|点击上传|上传视频/]
    : [/可将图片拖拽到此处|可直接将图片文件拖入|点击上传图片|选择图片|上传图片|上传封面|添加封面|封面/];
  let uploadEl: Locator | null = null;
  for (const hint of hints) {
    const loc = page.getByText(hint).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) { uploadEl = loc; break; }
  }
  if (!uploadEl) throw new Error("找不到上传区域");

  // Real click → OS file dialog appears
  await humanClick(page, uploadEl);

  // Wait for dialog to fully materialize, then fill path via PowerShell (async — don't block event loop)
  const dialogWait = 4000 + Math.floor(Math.random() * 500);   // 4.0-4.5s
  const shortWait = 250 + Math.floor(Math.random() * 200);     // 250-450ms
  const escapedPath = absPath.replace(/\\/g, '\\\\');
  const psCmd = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds ${dialogWait}; [System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds ${shortWait}; [System.Windows.Forms.SendKeys]::SendWait('${escapedPath}'); Start-Sleep -Milliseconds ${shortWait}; [System.Windows.Forms.SendKeys]::SendWait('%o')`;
  await new Promise<void>((resolve, reject) => {
    exec(`powershell -Command "${psCmd}"`, { windowsHide: true, timeout: 15000 },
      (err) => err ? reject(err) : resolve()
    );
  });

  await withIdleMouseMove(page, () => waitForUploadComplete(page, isVideo));
}
