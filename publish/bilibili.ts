import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, isOnLoginPage, humanReadPause, humanEnter } from "./humanize.ts";
import { fillField, clickButton, uploadFile } from "./helpers.ts";
import { getLimits } from "../schemas/platform-schema.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://member.bilibili.com";
const DYNAMIC_URL = "https://t.bilibili.com/";
const VIDEO_URL = "https://member.bilibili.com/platform/upload/video/frame";
const ARTICLE_URL = "https://member.bilibili.com/platform/upload/text/edit";

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

async function doSubmit(page: Page): Promise<boolean> {
  await humanReadPause();
  return await clickButton(page, [/保存草稿/, /存草稿/]);
}

// ── Dynamic (image_text — B站动态 = 图文) ──

async function publishDynamic(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("B站", "dynamic")!;
  await navigateTo("bilibili", DYNAMIC_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillTextarea(page, draft.content.slice(0, L.body));

  if (draft.images?.length && L.maxImages !== undefined) {
    for (const img of draft.images.slice(0, L.maxImages)) {
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
  const L = getLimits("B站", "video")!;

  await navigateTo("bilibili", VIDEO_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  await uploadFile(page, draft.video);
  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));

  if (draft.content && L.body !== undefined) {
    await fillTextarea(page, draft.content.slice(0, L.body));
  }

  if (!(await doSubmit(page))) {
    return { success: false, message: "找不到保存草稿按钮" };
  }
  return { success: true, message: `视频已保存到B站草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("B站", "article")!;
  await navigateTo("bilibili", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillBody(page, draft.content.slice(0, L.body));

  if (draft.images?.length && L.maxImages !== undefined) {
    for (const img of draft.images.slice(0, L.maxImages)) {
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
// B站 dispatch 用 schema key "dynamic" 不用 "image_text" —— 草稿/MCP 工具的
// content_type 都按 schema 走，AI 调 dynamic 才会匹配。但同时保留 image_text alias
// 防止旧调用方直接传 image_text（发布前 schema 改之前的代码）。
export const dispatch: Record<string, (draft: DraftData) => Promise<{ success: boolean; message: string }>> = {
  dynamic: publishDynamic,
  image_text: publishDynamic,   // alias for legacy callers
  video: publishVideo,
  article: publishArticle,
};
