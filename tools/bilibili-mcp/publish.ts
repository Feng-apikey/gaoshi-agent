import type { Page } from "playwright";
import { humanClick, humanPause, humanMoveTo, sleep, rand } from "./humanize.ts";
import { DYNAMIC_URL, UPLOAD_VIDEO_URL, ARTICLE_URL, PARTITIONS, LIMITS, MARKERS, SELECTORS, TIMEOUT, DELAY } from "./constants.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";

// ���� Placeholder PNG (400x400 grey) ����

function createPlaceholderPNG(): Buffer {
  const w = 400, h = 400;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const off = y * (w * 3 + 1); raw[off] = 0; for (let x = 0; x < w; x++) { const p = off + 1 + x * 3; raw[p] = 0x99; raw[p + 1] = 0x99; raw[p + 2] = 0x99; } }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crc32 = (buf: Buffer) => { let c = 0xFFFFFFFF; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); } return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, "ascii"); const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crcVal]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ���� Content formatting ����

function formatBiliBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[#*\-\_~`>]/g, "")
    .trim()
}

function formatBiliTitle(title: string): string {
  return title.replace(/\n/g, " ").trim()
}

// ���� Human-like interaction helpers ����
// Mouse move + click (humanized) �� clipboard paste �� triggers full paste event chain

async function writeClipboard(page: Page, text: string): Promise<void> {
  const ok = await page.evaluate((t: string) => {
    const ta = document.createElement("textarea");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.value = t;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const r = document.execCommand("copy");
    document.body.removeChild(ta);
    return r;
  }, text);
  if (!ok) {
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await sleep(rand(50, 100));
    await page.evaluate((t: string) => {
      const ta = document.createElement("textarea");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.value = t;
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }, text);
  }
}

async function pasteText(page: Page, text: string): Promise<void> {
  await writeClipboard(page, text);
  await sleep(rand(50, 120));
  await page.keyboard.press("Control+v");
}

async function focusAndSelectAll(page: Page, locator: import("playwright").Locator): Promise<void> {
  await humanMoveTo(page, locator);
  await humanPause(50, 150);
  await locator.click();
  await sleep(rand(150, 300));
  await page.keyboard.press("Control+a");
  await sleep(rand(30, 80));
}

async function dismissPopups(page: Page): Promise<void> {
  for (const txt of MARKERS.POPUP_BUTTONS) {
    try { const btn = page.locator(`text=${txt}`).first(); if (await btn.isVisible({ timeout: TIMEOUT.POPUP })) { await humanClick(page, btn); await humanPause(100, 300); } } catch {}
  }
}

async function fillTitle(page: Page, title: string): Promise<void> {
  for (const sel of SELECTORS.TITLE_INPUT) {
    try {
      const input = page.locator(sel).first();
      if (!(await input.isVisible({ timeout: TIMEOUT.ELEMENT_VISIBLE }))) continue;
      await focusAndSelectAll(page, input);
      await pasteText(page, title);
      await humanPause(100, 300);
      return;
    } catch {}
  }
  throw new Error("找不到标题输入框");
}

async function fillBody(page: Page, body: string): Promise<void> {
  const editor = page.locator(SELECTORS.BODY_EDITOR).first();
  if (!(await editor.isVisible({ timeout: TIMEOUT.ELEMENT_VISIBLE }))) throw new Error("找不到正文编辑器");
  await focusAndSelectAll(page, editor);
  await pasteText(page, body);
  await humanPause(100, 300);
}

async function fillTextarea(page: Page, text: string): Promise<void> {
  for (const sel of [SELECTORS.DYNAMIC_TEXTAREA, SELECTORS.BODY_EDITOR].flat()) {
    try {
      const el = page.locator(sel as string).first();
      if (!(await el.isVisible({ timeout: TIMEOUT.ELEMENT_VISIBLE }))) continue;
      await focusAndSelectAll(page, el);
      await pasteText(page, text);
      await humanPause(100, 300);
      return;
    } catch {}
  }
  throw new Error("找不到文本输入框");
}

async function addTags(page: Page, tags: string[]): Promise<void> {
  if (!tags?.length) return;
  const tagStr = tags.join(", ");
  for (const sel of [SELECTORS.TAGS_INPUT, '#video-tags', 'input[placeholder*="标签"]', 'textarea[placeholder*="标签"]'].flat()) {
    try {
      const input = page.locator(sel as string).first();
      if (!(await input.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }))) continue;
      await humanMoveTo(page, input);
      await humanPause(50, 150);
      await input.click();
      await sleep(DELAY.AFTER_CLICK);
      await input.fill(tagStr);
      await input.dispatchEvent("input");
      await humanPause(200, 500);
      return;
    } catch {}
  }
}

async function submitPublish(page: Page): Promise<void> {
  for (const txt of MARKERS.SUBMIT_BUTTONS) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK })) {
        await humanClick(page, btn);
        await sleep(DELAY.POST_SUBMIT);
        // best-effort: 检查是否出现错误弹窗
        const errorMarkers = ["发布失败", "提交失败", "请重试", "格式错误", "审核不通过"];
        for (const em of errorMarkers) {
          const errEl = page.locator(`text=${em}`).first();
          if (await errEl.isVisible({ timeout: 1500 }).catch(() => false)) {
            throw new Error(`发布失败: ${em}`);
          }
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("发布失败")) throw e;
    }
  }
  for (const txt of MARKERS.SAVE_DRAFT_BUTTONS) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK })) {
        await humanClick(page, btn);
        await sleep(DELAY.AFTER_SAVE_DRAFT);
        return;
      }
    } catch {}
  }
  throw new Error("找不到发布/提交按钮");
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv|ts|m4v|mpeg4|mpg|m4)$/i.test(filePath);
  const TEXT_HINTS = isVideo
    ? ["可直接将视频文件拖入此区域", "点击上传视频", "选择视频文件"]
    : ["可直接将图片文件拖入此区域", "点击上传图片", "选择图片文件"];
  let uploadEl: import("playwright").Locator | null = null;
  for (const hint of TEXT_HINTS) {
    try {
      const el = page.locator(`text=${hint}`).first();
      const vis = await el.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false);
      if (vis) { uploadEl = el; break; }
    } catch {}
  }
  if (!uploadEl) {
    const zones = isVideo
      ? [SELECTORS.VIDEO_UPLOAD_ZONE, '[class*="upload"]', '[class*="uploader"]']
      : [SELECTORS.IMAGE_UPLOAD_ZONE, '[class*="upload"]', '[class*="uploader"]'];
    for (const sel of zones) {
      try {
        const el = page.locator(sel).first();
        const vis = await el.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false);
        if (vis) { uploadEl = el; break; }
      } catch {}
    }
  }
  if (!uploadEl) throw new Error("找不到上传区域");
  await humanMoveTo(page, uploadEl);
  await humanPause(100, 300);
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: TIMEOUT.FILE_INPUT }),
    uploadEl.click(),
  ]);
  await fileChooser.setFiles(filePath);
  await sleep(isVideo ? DELAY.AFTER_VIDEO_UPLOAD : DELAY.AFTER_FILE_UPLOAD);
}

async function uploadCover(page: Page, coverPath: string): Promise<void> {
  if (!coverPath || !fs.existsSync(coverPath)) return;
  for (const hint of [SELECTORS.COVER_UPLOAD, 'text=上传封面', 'text=添加封面', 'text=选择封面', '[class*="cover-upload"]'].flat()) {
    try {
      const zone = page.locator(hint as string).first();
      if (!(await zone.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }))) continue;
      await humanMoveTo(page, zone);
      await humanPause(100, 300);
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: TIMEOUT.FILE_INPUT }),
        zone.click(),
      ]);
      await fileChooser.setFiles(coverPath);
      await sleep(DELAY.AFTER_COVER_UPLOAD);
      return;
    } catch {}
  }
}

async function uploadImages(page: Page, imagePaths: string[]): Promise<void> {
  if (!imagePaths?.length) return;
  for (const p of imagePaths) {
    await uploadFile(page, p);
    await sleep(DELAY.BETWEEN_IMAGES);
  }
}

async function selectPartition(page: Page, tid: number): Promise<void> {
  try {
    const partitionBtn = page.locator(SELECTORS.PARTITION_SELECTOR).first();
    if (await partitionBtn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK })) {
      await humanClick(page, partitionBtn);
      await humanPause(300, 600);
      const name = PARTITIONS[tid];
      if (name) {
        const option = page.locator(`text=${name}`).first();
        if (await option.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK })) {
          await humanClick(page, option);
          await humanPause(200, 400);
        }
      }
    }
  } catch {}
}

// ���� Public API ����

export async function publishDynamic(page: Page, content: {
  text: string; images?: string[]; topic_id?: number; schedule_time?: number;
}): Promise<{ url: string }> {
  await page.goto(DYNAMIC_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.AFTER_NAV);
  if (page.url().includes("/login") || page.url().includes("/signin")) {
    throw new Error("登录已过期或未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
  }
  await dismissPopups(page);
  await fillTextarea(page, content.text.slice(0, LIMITS.dynamic.text));
  await humanPause(300, 800);
  if (content.images?.length) {
    const maxImgs = Math.min(content.images.length, LIMITS.dynamic.maxImages);
    await uploadImages(page, content.images.slice(0, maxImgs));
    await humanPause(500, 1000);
  }
  await submitPublish(page);
  return { url: DYNAMIC_URL };
}

export async function publishVideo(page: Page, content: {
  videoPath: string; title: string; desc?: string; tid?: number; tags?: string[]; coverPath?: string;
}): Promise<{ url: string }> {
  await page.goto(UPLOAD_VIDEO_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.AFTER_NAV);
  if (page.url().includes("/login") || page.url().includes("/signin")) {
    throw new Error("登录已过期或未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
  }
  await dismissPopups(page);
  await uploadFile(page, content.videoPath);
  await sleep(DELAY.AFTER_VIDEO_UPLOAD);
  await dismissPopups(page);
  await fillTitle(page, formatBiliTitle(content.title.slice(0, LIMITS.video.title)));
  await humanPause(300, 800);
  if (content.desc) {
    await fillTextarea(page, formatBiliBody(content.desc).slice(0, LIMITS.video.desc));
    await humanPause(300, 800);
  }
  if (content.tid) { await selectPartition(page, content.tid); await humanPause(200, 500); }
  if (content.tags?.length) { await addTags(page, content.tags.slice(0, LIMITS.video.maxTags)); await humanPause(200, 500); }
  if (content.coverPath) { await uploadCover(page, content.coverPath); await humanPause(500, 1000); }
  await submitPublish(page);
  return { url: UPLOAD_VIDEO_URL };
}

export async function publishArticle(page: Page, content: {
  title: string; content: string; images?: string[]; category_id?: number;
}): Promise<{ url: string }> {
  await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.AFTER_NAV);
  if (page.url().includes("/login") || page.url().includes("/signin")) {
    throw new Error("登录已过期或未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
  }
  await dismissPopups(page);
  await fillTitle(page, formatBiliTitle(content.title.slice(0, LIMITS.article.title)));
  await humanPause(300, 800);
  await fillBody(page, formatBiliBody(content.content.slice(0, LIMITS.article.body)));
  await humanPause(500, 1000);
  if (content.images?.length) {
    const maxImgs = Math.min(content.images.length, LIMITS.article.maxImages);
    await uploadImages(page, content.images.slice(0, maxImgs));
    await humanPause(500, 1000);
  }
  await submitPublish(page);
  return { url: ARTICLE_URL };
}
