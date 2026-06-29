import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, humanReadPause, isOnLoginPage, humanEnter, humanClick } from "./humanize.ts";
import { fillField, clickButton, uploadFile } from "./helpers.ts";
import { getLimits } from "../schemas/platform-schema.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://member.bilibili.com";
const DYNAMIC_URL = "https://t.bilibili.com/";
const VIDEO_URL = "https://member.bilibili.com/platform/upload/video/frame";
const ARTICLE_URL = "https://member.bilibili.com/platform/upload/text/edit";

// ── Element fillers ──

/**
 * Title input. Placeholder contains "标题" (article) or "视频标题" (video upload).
 */
async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/(视频标题|标题)/),
  ]);
  if (loc) await fillField(page, loc, title);
}

/**
 * Rich-text body editor for article. Bilibili's article editor is a
 * contenteditable div, often without a placeholder. Fall back to a plain
 * <textarea> with placeholder hint.
 */
async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容|文章正文)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, body);
}

/**
 * Text input/editor used for short posts (动态 / 视频描述).
 * t.bilibili.com dynamic composer: "有什么想和大家分享的?".
 * Video upload form: "说点什么" / "视频描述".
 */
async function fillTextarea(page: Page, text: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.getByPlaceholder(/(有什么想和大家分享|说点什么|发表动态|视频描述|描述)/),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, text);
}

/**
 * Click submit. Bilibili's creator flow has "投稿" (video) / "发布" (dynamic)
 * / "立即发布" / "提交审核" as primary, then a "保存草稿" fallback.
 */
async function clickSubmit(page: Page): Promise<boolean> {
  const primary = [/^投稿$/, /^发布$/, /^立即发布$/, /^提交审核$/];
  for (const name of primary) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await humanClick(page, btn);
        await sleep(3000);
        return true;
      }
    } catch {}
  }
  return clickButton(page, [/保存草稿/, /存草稿/], 2000);
}

/**
 * Upload images to B站 dynamic via the pics-uploader widget, one at a time.
 * Must first activate the image upload area by clicking the "pic" toolbar
 * item, then add images through the add-button.
 */
async function uploadDynamicImages(page: Page, images: string[], maxImages: number): Promise<void> {
  if (!images?.length) return;
  // Pre-flight: filter out non-existent files via resolveMaterialPath
  const { resolveMaterialPath } = await import("./helpers.ts");
  const valid: string[] = [];
  for (const id of images.slice(0, maxImages)) {
    try {
      const p = resolveMaterialPath(id);
      if (p) valid.push(id);
    } catch {}
  }
  if (!valid.length) return;

  // Activate the image upload area
  const picBtn = page.locator(".bili-dyn-publishing__tools__item.pic").first();
  if (await picBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanClick(page, picBtn);
    await sleep(500);
  }

  // Upload one image at a time — each click on the add button opens a fresh dialog
  for (const img of valid) {
    const addBtn = page.locator(".bili-pics-uploader__add").first();
    if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) break;
    await uploadFile(page, ".bili-pics-uploader__add", img);
  }
}

// ── Image Text (Dynamic) ──
//
// B站动态发布页 (t.bilibili.com) 页面结构:
//   ┌────────────────────────────────────────────────────┐
//   │ 顶部: 标题输入 (.bili-dyn-publishing__title__input) │
//   │                                                     │
//   │ 正文区: contenteditable                              │
//   │   - placeholder "有什么想和大家分享的?"            │
//   │                                                     │
//   │ 工具栏 (底部):                                      │
//   │   - .pic 按钮 = 激活图片上传区                       │
//   │   - .bili-pics-uploader__add = 添加图片按钮          │
//   │   (每个图上传 = 一次完整 OS dialog 流程)            │
//   │                                                     │
//   │ 发布按钮 (.bili-dyn-publishing__action.launcher)     │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 填标题 (可选, max 20)
//   2. 填正文 (contenteditable, 不 Ctrl+A)
//   3. 激活图片上传 (.pic 工具按钮) → 循环 add + uploadFile
//   4. 点 .launcher 发布按钮 (动态直接发布, 不存草稿)
async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("B站", "dynamic")!;
  await navigateTo("bilibili", DYNAMIC_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  // Title (optional, max 20 chars)
  if (draft.title && L.title !== undefined) {
    const titleInput = page.locator(".bili-dyn-publishing__title__input").first();
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fillField(page, titleInput, draft.title.slice(0, L.title));
    }
  }

  // Body (contenteditable, ~1000 char limit)
  if (L.body !== undefined) await fillTextarea(page, draft.content.slice(0, L.body));

  // Images via dedicated uploader widget
  if (draft.images?.length && L.maxImages !== undefined) {
    await uploadDynamicImages(page, draft.images, L.maxImages);
  }

  // Primary publish button on dynamic composer
  await humanReadPause();
  const publishBtn = page.locator(".bili-dyn-publishing__action.launcher").first();
  if (await publishBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanClick(page, publishBtn);
    await sleep(3000);
    return { success: true, message: `动态已发布到B站：${draft.title}` };
  }

  // Fallback: generic submit path
  if (await clickSubmit(page)) {
    return { success: true, message: `动态已保存到B站草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到发布按钮" };
}

// ── Video ──
//
// B站视频上传页 (member.bilibili.com/platform/upload/video/frame):
//   ┌────────────────────────────────────────────────────┐
//   │ 大视频上传 drop-zone (.upload-area)                  │
//   │   "点击上传 或将视频拖拽到此区域"                    │
//   │   上传后变成上传进度 + 视频预览                       │
//   │                                                     │
//   │ 下方表单 (上传完成后才显示):                         │
//   │   - 标题 (placeholder "视频标题")                    │
//   │   - 简介 (placeholder "说点什么")                   │
//   │   - 分区 / 标签 / 活动                               │
//   │                                                     │
//   │ 投稿按钮 (底部 "投稿")                                │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 上传视频 (大 drop-zone, 走 OS dialog)
//   2. 等上传完成后 → 填标题 → 填简介
//   3. 点投稿按钮
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

  // 1. 上传视频
  await uploadFile(page, ".upload-area", draft.video);

  // 2a. 标题
  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));

  // 2b. 简介 (B站动态/视频描述都用 fillTextarea)
  if (draft.content && L.body !== undefined) {
    await fillTextarea(page, draft.content.slice(0, L.body));
  }

  // 3. 投稿
  await humanReadPause();
  if (await clickSubmit(page)) {
    return { success: true, message: `视频已保存到B站草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Article ──
//
// B站专栏 (member.bilibili.com/platform/upload/text/edit):
//   ┌────────────────────────────────────────────────────┐
//   │ 标题                                                 │
//   │ 正文 (contenteditable / textarea, 图片内联)        │
//   │ 摘要 / 分类 / 标签                                   │
//   │                                                     │
//   │ 发布按钮                                             │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 填标题 → 填正文 (图片内联在正文中, 不单独上传)
//   2. 提交审核 / 保存草稿
async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("B站", "article")!;
  await navigateTo("bilibili", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await humanEnter(page);

  // B站专栏图片内联在正文中，不单独上传
  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillBody(page, draft.content.slice(0, L.body));

  await humanReadPause();
  if (await clickSubmit(page)) {
    return { success: true, message: `专栏已保存到B站草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
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
  dynamic: publishImageText,
  image_text: publishImageText,   // alias for legacy callers
  video: publishVideo,
  article: publishArticle,
};