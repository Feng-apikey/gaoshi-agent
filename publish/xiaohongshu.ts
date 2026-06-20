import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, isOnLoginPage, humanReadPause, humanEnter, humanClick } from "./humanize.ts";
import { fillField, clickButton, uploadFile } from "./helpers.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://creator.xiaohongshu.com";
const DASHBOARD_URL = "https://creator.xiaohongshu.com/publish";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";

const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 10, maxImages: 18 },
  video: { title: 20, body: 1000, maxTags: 10 },
  article: { title: 64, body: 8000 },
} as const;

// ── Content type tab switching ──

async function clickToContentEditor(page: Page, ct: string): Promise<boolean> {
  const entryMap: Record<string, RegExp[]> = {
    image_text: [/上传图文/, /图文/],
    video: [/上传视频/, /视频/],
    article: [/写长文/, /长文/, /笔记/],
  };
  const patterns = entryMap[ct];
  if (!patterns) return false;

  // Try buttons first
  for (const pat of patterns) {
    try {
      const btn = page.getByRole("button", { name: pat }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await humanClick(page, btn);
        await sleep(1500);
        return true;
      }
    } catch {}
  }
  // Then links
  for (const pat of patterns) {
    try {
      const link = page.getByRole("link", { name: pat }).first();
      if (await link.isVisible({ timeout: 2000 })) {
        await humanClick(page, link);
        await sleep(1500);
        return true;
      }
    } catch {}
  }
  // Fallback: tab elements
  for (const pat of patterns) {
    try {
      const tab = page.getByRole("tab", { name: pat }).first();
      if (await tab.isVisible({ timeout: 2000 })) {
        await humanClick(page, tab);
        await sleep(1500);
        return true;
      }
    } catch {}
  }
  // Last resort: any visible text match
  for (const pat of patterns) {
    const el = page.getByText(pat).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(page, el);
      await sleep(1500);
      return true;
    }
  }
  return false;
}

// ── Element fillers ──

async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [() => page.getByPlaceholder(/(标题)/)]);
  if (loc) await fillField(page, loc, title);
}

async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容|正文输入|描述)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, body);
}


async function doSubmit(page: Page): Promise<boolean> {
  await humanReadPause();
  return clickButton(page, [/存草稿/, /保存草稿/, /暂存/]);
}

// ── Image Text ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("xiaohongshu", PUBLISH_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);
  await clickToContentEditor(page, "image_text");

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await fillTitle(page, draft.title.slice(0, LIMITS.image_text.title));
  await fillBody(page, draft.content.slice(0, LIMITS.image_text.body));

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `已保存到小红书草稿箱：${draft.title}` };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("xiaohongshu", PUBLISH_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);
  await clickToContentEditor(page, "video");

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));
  await fillBody(page, draft.content.slice(0, LIMITS.video.body));

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `视频已保存到小红书草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("xiaohongshu", PUBLISH_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);
  await clickToContentEditor(page, "article");

  if (draft.cover) await uploadFile(page, draft.cover);

  await fillTitle(page, draft.title.slice(0, LIMITS.article.title));
  await fillBody(page, draft.content.slice(0, LIMITS.article.body));

  if (draft.abstract) {
    const abstractLoc = await pickVisible(page, [
      () => page.getByPlaceholder(/(摘要|简介)/),
    ]);
    if (abstractLoc) await fillField(page, abstractLoc, draft.abstract.slice(0, 60));
  }

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `长文已保存到小红书草稿箱：${draft.title}` };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
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
