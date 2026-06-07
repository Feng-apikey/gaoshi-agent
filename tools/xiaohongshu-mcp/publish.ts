import type { Page } from "playwright";
import { humanClick, humanPause, humanMoveTo, sleep, rand } from "./humanize.ts";
import { PUBLISH_IMAGE_URL, PUBLISH_VIDEO_URL, PUBLISH_ARTICLE_URL, LIMITS, MARKERS, SELECTORS, TIMEOUT, DELAY } from "./constants.ts";
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

function formatXHSBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[#*\-\_~`>]/g, "")
    .trim()
}

const EMOJI_PREFIXES = ["🔥", "✨", "💡", "📌", "🎯", "🌟", "💪", "🎉"];

function formatXHSTitle(title: string): string {
  let t = title.replace(/\n/g, " ").trim()
  const hasEmoji = /[\p{Emoji}]/u.test(t)
  if (!hasEmoji && t.length < 50) {
    const emoji = EMOJI_PREFIXES[Math.floor(Math.random() * EMOJI_PREFIXES.length)]
    t = `${emoji} ${t}`
  }
  return t
}

// ���� Human-like interaction helpers ����
// Mouse move + click (humanized) �� clipboard paste �� triggers full paste event chain
// Indistinguishable from human Ctrl+V: beforeinput(insertFromPaste) �� input �� paste

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

async function addTags(page: Page, tags: string[]): Promise<void> {
  if (!tags?.length) return;
  const editor = page.locator(SELECTORS.BODY_EDITOR).first();
  for (const tag of tags.slice(0, LIMITS.image_text.maxTags)) {
    await humanMoveTo(page, editor);
    await humanPause(50, 150);
    await editor.click();
    await sleep(rand(150, 300));
    // Move cursor to end, then clipboard-paste the tag
    await editor.evaluate((el: any) => {
      el.focus();
      const sel = window.getSelection();
      sel?.selectAllChildren(el);
      sel?.collapseToEnd();
    });
    await pasteText(page, ` #${tag}`);
    await sleep(rand(500, 1200));
    try { await page.locator(SELECTORS.TAG_SUGGESTION).first().click({ timeout: TIMEOUT.TAG_SUGGESTION }); await humanPause(200, 500); } catch {}
  }
}

async function saveDraft(page: Page): Promise<void> {
  for (const txt of MARKERS.SAVE_DRAFT_BUTTONS) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK })) {
        await humanClick(page, btn);
        await sleep(DELAY.AFTER_SAVE_DRAFT);
        // best-effort: 检查是否出现错误弹窗
        const errorMarkers = ["发布失败", "保存失败", "请重试", "格式错误"];
        for (const em of errorMarkers) {
          const errEl = page.locator(`text=${em}`).first();
          if (await errEl.isVisible({ timeout: 1500 }).catch(() => false)) {
            throw new Error(`保存失败: ${em}`);
          }
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("保存失败")) throw e;
    }
  }
  throw new Error("找不到保存草稿按钮");
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv|ts|m4v|mpeg4|mpg|m4)$/i.test(filePath);
  const TEXT_HINTS = isVideo
    ? ["可直接将视频文件拖入此区域", "可将视频拖拽到此处", "点击上传视频", "选择视频文件"]
    : ["可直接将图片文件拖入此区域", "可将图片拖拽到此处", "点击上传图片", "选择图片文件"];
  let uploadEl: import("playwright").Locator | null = null;
  for (const hint of TEXT_HINTS) {
    const el = page.locator(`text=${hint}`).first();
    const vis = await el.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false);
    if (vis) { uploadEl = el; break; }
  }
  if (!uploadEl) throw new Error("找不到上传区域");
  // Humanized: move mouse �� pause �� click �� wait for filechooser
  await humanMoveTo(page, uploadEl);
  await humanPause(100, 300);
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: TIMEOUT.FILE_INPUT }),
    uploadEl.click(),
  ]);
  await fileChooser.setFiles(filePath);
  await sleep(isVideo ? DELAY.AFTER_VIDEO_UPLOAD : DELAY.AFTER_FILE_UPLOAD);
}

async function uploadCover(page: Page, filePath: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) return;
  const uploadZone = page.locator('text=上传封面, text=封面, text=添加封面, [class*="cover"] [class*="upload"]').first();
  if (await uploadZone.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false)) {
    await humanMoveTo(page, uploadZone);
    await humanPause(100, 300);
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: TIMEOUT.FILE_INPUT }),
      uploadZone.click(),
    ]);
    await fileChooser.setFiles(filePath);
    await sleep(DELAY.AFTER_COVER_UPLOAD);
  }
}

async function uploadHeaderImage(page: Page, filePath: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) return;
  const headerZone = page.locator('text=头图, text=文章头图, text=上传头图').first();
  if (await headerZone.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false)) {
    await humanMoveTo(page, headerZone);
    await humanPause(100, 300);
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: TIMEOUT.FILE_INPUT }),
      headerZone.click(),
    ]);
    await fileChooser.setFiles(filePath);
    await sleep(DELAY.AFTER_HEADER_UPLOAD);
  }
}

interface PublishOpts {
  fallbackURL: string;
  resultURL: string;
  title: string;
  titleMaxLen: number;
  body: string;
  bodyMaxLen: number;
  bodyRequired: boolean;
  tags?: string[];
  coverPath?: string;
  headerPath?: string;
  abstract?: string;
  preUpload?: () => Promise<void>;
}

async function fillAbstract(page: Page, abstract: string): Promise<void> {
  const inputs = page.locator('textarea, input[type="text"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    try {
      const ph = await el.getAttribute("placeholder").catch(() => "") || "";
      if (ph.includes("摘要") || ph.includes("内容简介")) {
        await focusAndSelectAll(page, el);
        await pasteText(page, abstract);
        await humanPause(100, 300);
        return;
      }
    } catch {}
  }
}

async function doPublish(page: Page, opts: PublishOpts): Promise<{ url: string }> {
  await page.goto(opts.fallbackURL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.AFTER_NAV);
  if (page.url().includes("/login") || page.url().includes("/signin")) {
    throw new Error("登录已过期或未登录，请先调用 xhs_get_login_qrcode 打开浏览器扫码登录");
  }
  await dismissPopups(page);
  if (opts.preUpload) {
    await opts.preUpload();
    await sleep(DELAY.AFTER_NAV);
    await dismissPopups(page);
  }
  await fillTitle(page, formatXHSTitle(opts.title).slice(0, opts.titleMaxLen));
  await humanPause(300, 800);
  if (opts.abstract) { await fillAbstract(page, opts.abstract); await humanPause(200, 500); }
  if (opts.body || opts.bodyRequired) { await fillBody(page, formatXHSBody(opts.body).slice(0, opts.bodyMaxLen)); await humanPause(300, 800); }
  if (opts.headerPath) { await uploadHeaderImage(page, opts.headerPath); await humanPause(500, 1000); }
  if (opts.coverPath) { await uploadCover(page, opts.coverPath); await humanPause(300, 600); }
  await addTags(page, opts.tags ?? []);
  await humanPause(200, 500);
  await saveDraft(page);
  return { url: opts.resultURL };
}

export async function publishImageText(page: Page, content: {
  title: string; body: string; tags?: string[]; imagePaths?: string[]; coverPath?: string;
}): Promise<{ url: string }> {
  const preUpload = async () => {
    if (content.imagePaths?.length) {
      for (const p of content.imagePaths) {
        await uploadFile(page, p);
        await sleep(DELAY.BETWEEN_IMAGES);
      }
    } else {
      const tmpFile = path.join(os.tmpdir(), `xhs_mcp_placeholder_${Date.now()}.png`);
      fs.writeFileSync(tmpFile, createPlaceholderPNG());
      try { await uploadFile(page, tmpFile); await sleep(DELAY.PLACEHOLDER_UPLOAD); } finally { try { fs.unlinkSync(tmpFile); } catch {} }
    }
  };
  return doPublish(page, {
    fallbackURL: PUBLISH_IMAGE_URL, resultURL: PUBLISH_IMAGE_URL,
    title: content.title, titleMaxLen: LIMITS.image_text.title, body: content.body, bodyMaxLen: LIMITS.image_text.body, bodyRequired: true,
    tags: content.tags, coverPath: content.coverPath, preUpload,
  });
}

export async function publishVideo(page: Page, content: {
  videoPath: string; title: string; description: string; tags?: string[]; coverPath?: string;
}): Promise<{ url: string }> {
  return doPublish(page, {
    fallbackURL: PUBLISH_VIDEO_URL, resultURL: PUBLISH_VIDEO_URL,
    title: content.title, titleMaxLen: LIMITS.video.title, body: content.description, bodyMaxLen: LIMITS.video.body, bodyRequired: false,
    tags: content.tags, coverPath: content.coverPath,
    preUpload: async () => { await uploadFile(page, content.videoPath); await sleep(DELAY.AFTER_VIDEO_UPLOAD); },
  });
}

export async function publishArticle(page: Page, content: {
  title: string; body: string; tags?: string[];
  abstract?: string; coverPath?: string; headerPath?: string;
}): Promise<{ url: string }> {
  return doPublish(page, {
    fallbackURL: PUBLISH_ARTICLE_URL, resultURL: PUBLISH_ARTICLE_URL,
    title: content.title, titleMaxLen: LIMITS.article.title, body: content.body, bodyMaxLen: LIMITS.article.body, bodyRequired: true,
    tags: content.tags, abstract: content.abstract, coverPath: content.coverPath, headerPath: content.headerPath,
  });
}
