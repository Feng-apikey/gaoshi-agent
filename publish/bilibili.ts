import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, isOnLoginPage, humanReadPause, humanEnter } from "./humanize.ts";
import { fillField, clickButton, uploadFile } from "./helpers.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://member.bilibili.com";
const DYNAMIC_URL = "https://t.bilibili.com/";
const VIDEO_URL = "https://member.bilibili.com/platform/upload/video/frame";
const ARTICLE_URL = "https://member.bilibili.com/platform/upload/text/edit";

const LIMITS = {
  image_text: { title: 20, text: 1000, maxImages: 18 },  // 动态
  video: { title: 80, desc: 2000, maxTags: 10 },
  article: { title: 30, body: 100000, maxImages: 50 },
} as const;

// ── Element fillers ──

async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [() => page.getByPlaceholder(/(视频标题|标题)/)]);
  if (loc) await fillField(page, loc, title);
}

async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容|文章正文)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, body);
}

async function fillTextarea(page: Page, text: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/有什么想和大家分享|说点什么|发表动态|视频描述|描述/),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, text);
}

async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/(添加标签|标签)/),
  ], 2000);
  if (!loc) return;
  for (const tag of tags.slice(0, maxTags)) {
    await fillField(page, loc, tag);
    await page.keyboard.press("Enter");
    await sleep(500);
  }
}

async function doSubmit(page: Page): Promise<boolean> {
  await humanReadPause();
  return await clickButton(page, [/保存草稿/, /存草稿/]);
}

// ── Image Text (Dynamic) ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", DYNAMIC_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  await fillTitle(page, draft.title.slice(0, LIMITS.image_text.title));
  await fillTextarea(page, draft.content.slice(0, LIMITS.image_text.text));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `动态已保存到B站草稿箱：${draft.title}` };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("bilibili", VIDEO_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));

  if (draft.content) {
    await fillTextarea(page, draft.content.slice(0, LIMITS.video.desc));
  }
  await addTags(page, draft.tags, LIMITS.video.maxTags);

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `视频已保存到B站草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  await fillTitle(page, draft.title.slice(0, LIMITS.article.title));
  await fillBody(page, draft.content.slice(0, LIMITS.article.body));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.article.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
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
