import type { Page, Locator } from "playwright";
import { sleep, humanClick, pasteText, waitForUploadComplete, withIdleMouseMove } from "./humanize.ts";
import { existsSync } from "node:fs";

/**
 * Fill a field with human-like behavior: click, select all, paste, pause.
 */
export async function fillField(page: Page, loc: Locator, text: string): Promise<void> {
  await humanClick(page, loc);
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, text);
  await sleep(300);
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
 * Add tags inline in a contenteditable editor (XHS / Douyin image_text & article).
 * Re-finds the editor before each tag to handle focus shifts.
 */
export async function addTagsInline(
  page: Page,
  findEditor: () => Promise<Locator | null>,
  tags: string[],
  maxTags: number,
): Promise<void> {
  if (!tags?.length) return;
  for (const tag of tags.slice(0, maxTags)) {
    const ed = await findEditor();
    if (!ed) continue;
    await humanClick(page, ed);
    await sleep(200);
    await pasteText(page, ` #${tag}`);
    await sleep(800);
    await page.keyboard.press("Enter");
    await sleep(300);
  }
}

/**
 * Upload a file via file chooser (XHS / Bilibili).
 */
export async function uploadFile(page: Page, filePath: string): Promise<void> {
  if (!filePath || !existsSync(filePath)) return;
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(filePath);
  const hints = isVideo
    ? [/可将视频拖拽到此处|可直接将视频文件拖入|点击上传视频|选择视频/]
    : [/可将图片拖拽到此处|可直接将图片文件拖入|点击上传图片|选择图片/];
  let uploadEl: Locator | null = null;
  for (const hint of hints) {
    const loc = page.getByText(hint).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) { uploadEl = loc; break; }
  }
  if (!uploadEl) return;
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 5000 }),
    uploadEl.click(),
  ]);
  await fileChooser.setFiles(filePath);
  await withIdleMouseMove(page, () => waitForUploadComplete(page, isVideo));
}
