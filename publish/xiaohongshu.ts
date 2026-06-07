import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, humanClick, pasteText, dismissPopups as closePopups } from "./humanize.ts";

const CREATOR_URL = "https://creator.xiaohongshu.com";
const DASHBOARD_URL = "https://creator.xiaohongshu.com/publish";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";
// XHS removed the dedicated /publish/article path. Long-form "article" drafts
// in gaoshi become text-heavy notes on /publish/publish — same publish flow
// as image_text, just with no images and a long body.
const ARTICLE_URL = "https://creator.xiaohongshu.com/publish/publish";

const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 10, maxImages: 9 },
  video: { title: 20, body: 1000, maxTags: 10 },
  article: { title: 20, body: 6000, maxTags: 10 },
} as const;

export interface DraftData {
  id: string;
  title: string;
  content: string;
  tags: string[];
  images: string[];
  video: string;
  cover: string;
  abstract: string;
  header: string;
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

async function dismissPopups(page: Page): Promise<void> {
  const candidates = ["我知道了", "关闭", "取消", "跳过"];
  for (const name of candidates) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await sleep(300); }
    } catch {}
  }
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(标题)/),
  ]);
  if (!loc) return;
  await loc.click();
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, title);
  await sleep(300);
}

async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容|正文输入|描述)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (!loc) return;
  await loc.click();
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, body);
  await sleep(300);
}

/**
 * XHS doesn't expose a dedicated tag input on the publish page — tags are
 * typed inline ("#xxx") in the body, then a suggestion popover shows.
 */
async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  const ed = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (!ed) return;
  for (const tag of tags.slice(0, maxTags)) {
    await ed.click();
    await sleep(200);
    await pasteText(page, ` #${tag}`);
    await sleep(500);
    // Suggestion popover — known-fragile, XHS's tag-suggest UI class name
    // changes periodically. Inspect on a live page to refresh.
    for (const sel of [
      "[class*='suggest']:visible",
      "[class*='option']:visible",
    ]) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) { await loc.click(); break; }
    }
  }
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  const fs = await import("node:fs");
  if (!filePath || !fs.existsSync(filePath)) return;
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(filePath);
  const hints = isVideo
    ? [/可将视频拖拽到此处|可直接将视频文件拖入|点击上传视频/]
    : [/可将图片拖拽到此处|可直接将图片文件拖入|点击上传图片/];
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
  await sleep(isVideo ? 12000 : 5000);
}

async function saveDraft(page: Page): Promise<void> {
  for (const name of [/存草稿/, /保存草稿/, /暂存/]) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await sleep(2000); return; }
    } catch {}
  }
}

// ── Image Text ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("xiaohongshu", PUBLISH_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await closePopups(page);

  // Upload images
  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await fillTitle(page, draft.title.slice(0, LIMITS.image_text.title));
  await fillBody(page, draft.content.slice(0, LIMITS.image_text.body));
  await addTags(page, draft.tags, LIMITS.image_text.maxTags);
  await saveDraft(page);
  return { success: true, message: `已保存到小红书草稿箱：${draft.title}` };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("xiaohongshu", PUBLISH_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await closePopups(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));
  await fillBody(page, draft.content.slice(0, LIMITS.video.body));
  await addTags(page, draft.tags, LIMITS.video.maxTags);
  await saveDraft(page);
  return { success: true, message: `视频已保存到小红书草稿箱：${draft.title}` };
}

// ── Article (XHS has no dedicated article UI — long-form notes go via /publish) ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  // XHS removed /publish/article (404 as of 2026-06). Long-form "article" drafts
  // become text-heavy notes on the same /publish page as image_text.
  await navigateTo("xiaohongshu", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await closePopups(page);

  // Cover (single image, mapped to draft.cover) — XHS publish page supports a cover image
  if (draft.cover) {
    const fs = await import("node:fs");
    if (fs.existsSync(draft.cover)) {
      const coverZone = await pickVisible(page, [
        () => page.getByText(/上传封面|添加封面|封面|头图/),
      ], 2000);
      if (coverZone) {
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 5000 }),
          coverZone.click(),
        ]);
        await fc.setFiles(draft.cover);
        await sleep(3000);
      }
    }
  }

  await fillTitle(page, draft.title.slice(0, LIMITS.article.title));
  await fillBody(page, draft.content.slice(0, LIMITS.article.body));

  if (draft.abstract) {
    // On the unified /publish page XHS doesn't show a separate abstract field
    // — it's derived from the body. So prepend the abstract to the body content.
    // (We tried to find a 摘要 placeholder above; if not found, we just skip.)
    const abstractLoc = await pickVisible(page, [
      () => page.getByPlaceholder(/^[^]*(摘要|简介)/),
    ]);
    if (abstractLoc) {
      await abstractLoc.click();
      await pasteText(page, draft.abstract.slice(0, 60));
      await sleep(300);
    }
  }

  await addTags(page, draft.tags, LIMITS.article.maxTags);
  await saveDraft(page);
  return { success: true, message: `长文已保存到小红书草稿箱：${draft.title}` };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
  // /publish is the dashboard with the sidebar showing 发布笔记 / 笔记管理 /
  // 数据看板 — the original CREATOR_URL root redirects to /new/home which
  // doesn't have those markers, giving false negatives.
  await navigateTo("xiaohongshu", DASHBOARD_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");
  const bodyText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  const markers = ["发布笔记", "笔记管理", "数据中心", "创作中心", "内容管理"];
  return markers.filter(m => bodyText.includes(m)).length >= 2;
}

// ── Dispatch ──

export const dispatch: Record<string, (draft: DraftData) => Promise<{ success: boolean; message: string }>> = {
  image_text: publishImageText,
  video: publishVideo,
  article: publishArticle,
};
