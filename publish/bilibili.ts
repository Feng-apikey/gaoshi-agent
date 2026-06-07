import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, humanClick, pasteText, dismissPopups as closePopups } from "./humanize.ts";

const CREATOR_URL = "https://member.bilibili.com";
const DYNAMIC_URL = "https://t.bilibili.com/";
const VIDEO_URL = "https://member.bilibili.com/platform/upload/video/frame";
const ARTICLE_URL = "https://member.bilibili.com/platform/upload/text/edit";

const LIMITS = {
  image_text: { text: 2000, maxImages: 9, maxTags: 5 },
  video: { title: 30, desc: 250, maxTags: 10 },
  article: { title: 30, body: 20000, maxImages: 50 },
} as const;

export interface DraftData {
  id: string;
  title: string;
  content: string;
  tags: string[];
  images: string[];
  video: string;
  cover: string;
  header: string;
  abstract: string;
}

async function pickVisible(page: Page, factories: Array<() => Locator>, timeout = 3000): Promise<Locator | null> {
  for (const factory of factories) {
    try {
      const loc = factory().first();
      if (await loc.isVisible({ timeout })) return loc;
    } catch {}
  }
  return null;
}

/**
 * Find the title input. On Bilibili, the title field placeholder contains
 * "标题" (article) or "视频标题" (video upload).
 */
async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(视频标题|标题)/),
  ]);
  if (!loc) return;
  await humanClick(page, loc);
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, title);
  await sleep(300);
}

/**
 * Find the rich-text body editor (article page). Bilibili's article editor
 * is a contenteditable div, often without a placeholder. Fall back to
 * a plain <textarea> with placeholder hint.
 */
async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容|文章正文)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (!loc) return;
  await humanClick(page, loc);
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, body);
  await sleep(300);
}

/**
 * Find the text input/editor used for short posts (动态 / 视频描述).
 * Bilibili's dynamic composer on t.bilibili.com is an embedded widget with
 * placeholder "有什么想和大家分享的?". The video upload form uses a textarea
 * with placeholder "说点什么" / "视频描述".
 */
async function fillTextarea(page: Page, text: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/有什么想和大家分享|说点什么|发表动态|视频描述|描述/),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (!loc) return;
  await humanClick(page, loc);
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, text);
  await sleep(300);
}

async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  const tagStr = tags.slice(0, maxTags).join(", ");
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(添加标签|标签)/),
  ], 2000);
  if (!loc) return;
  await humanClick(page, loc);
  await sleep(200);
  await loc.fill(tagStr);
  await sleep(500);
}

/**
 * Click the upload zone. The zone is a clickable container that opens
 * a file picker. Visible text is hint text like "可将视频文件拖入此区域".
 * getByText matches the visible label.
 */
async function uploadFile(page: Page, filePath: string): Promise<void> {
  const fs = await import("node:fs");
  if (!filePath || !fs.existsSync(filePath)) return;
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(filePath);
  const hints = isVideo
    ? [/可将视频文件拖入|点击上传视频|选择视频/]
    : [/可将图片文件拖入|点击上传图片|选择图片/];
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
  await sleep(isVideo ? 17000 : 5000);
}

/**
 * Click submit. Bilibili's creator flow has "投稿" (video) / "发布" (dynamic)
 * / "立即发布" / "提交审核", then a "保存草稿" fallback.
 */
async function clickSubmit(page: Page): Promise<void> {
  const primary = [/^投稿$/, /^发布$/, /^立即发布$/, /^提交审核$/];
  for (const name of primary) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) { await humanClick(page, btn); await sleep(3000); return; }
    } catch {}
  }
  // Fallback: save draft
  for (const name of [/保存草稿/, /存草稿/]) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) { await humanClick(page, btn); await sleep(2000); return; }
    } catch {}
  }
}

// ── Image Text (Dynamic) ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", DYNAMIC_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await closePopups(page);

  await fillTextarea(page, draft.content.slice(0, LIMITS.image_text.text));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await clickSubmit(page);
  return { success: true, message: `动态已保存到B站草稿箱：${draft.title}` };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("bilibili", VIDEO_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await closePopups(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));

  if (draft.content) {
    await fillTextarea(page, draft.content.slice(0, LIMITS.video.desc));
  }
  await addTags(page, draft.tags, LIMITS.video.maxTags);
  await clickSubmit(page);
  return { success: true, message: `视频已保存到B站草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await closePopups(page);

  await fillTitle(page, draft.title.slice(0, LIMITS.article.title));
  await fillBody(page, draft.content.slice(0, LIMITS.article.body));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.article.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await clickSubmit(page);
  return { success: true, message: `专栏已保存到B站草稿箱：${draft.title}` };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
  await navigateTo("bilibili", CREATOR_URL);
  await sleep(3000);
  const page = await getPage("bilibili");
  const bodyText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  const markers = ["内容管理", "稿件管理", "创作中心", "数据", "作品管理"];
  return markers.filter(m => bodyText.includes(m)).length >= 2;
}

// ── Dispatch ──

export const dispatch: Record<string, (draft: DraftData) => Promise<{ success: boolean; message: string }>> = {
  image_text: publishImageText,
  video: publishVideo,
  article: publishArticle,
};
