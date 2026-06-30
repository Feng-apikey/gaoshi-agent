import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, humanReadPause, isOnLoginPage, humanEnter, humanClick, humanPause } from "./humanize.ts";
import { fillField, clickButton, uploadFile } from "./helpers.ts";
import { getLimits } from "../schemas/platform-schema.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://creator.xiaohongshu.com";
const DASHBOARD_URL = "https://creator.xiaohongshu.com/publish";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";

// XHS removed the dedicated /publish/article path. Long-form "article" drafts
// in gaoshi become text-heavy notes on /publish/publish?target=article —
// different from image_text/?target=image: article enters an editor page
// (not the inline publish form), with NO cover upload area. Must click
// "新的创作" on the article hub before the editor mounts.
const ARTICLE_HUB_URL = "https://creator.xiaohongshu.com/publish/publish?target=article";
const IMAGE_TEXT_URL = "https://creator.xiaohongshu.com/publish/publish?target=image";
const VIDEO_URL = "https://creator.xiaohongshu.com/publish/publish?target=video";

// ── Element fillers ──
//
// image_text tab: title is <input class="d-text" placeholder="填写标题会有更多赞哦">
// article editor: title is <textarea class="d-text" placeholder="输入标题" maxlength=64>
//
// `pickVisible` walks the candidates in order and returns the first visible match.
// We prefer the article-textarea selector first when on the article editor
// (its placeholder is more specific), but the broader "标题" regex still works
// on image_text because pickVisible skips non-visible elements.

async function fillTitle(page: Page, title: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.locator("textarea.d-text[placeholder='输入标题']"),
    () => page.locator("input.d-text[placeholder*='标题']"),
    () => page.getByPlaceholder(/(填写标题|输入标题)/),
  ]);
  if (loc) await fillField(page, loc, title);
}

async function fillBody(page: Page, body: string): Promise<void> {
  const loc = await pickVisible(page, [
    () => page.locator(".tiptap[contenteditable='true']"),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (loc) await fillField(page, loc, body);
}

async function doSubmit(page: Page): Promise<boolean> {
  await humanReadPause();
  return clickButton(page, [/存草稿/, /保存草稿/, /暂存/]);
}

/**
 * Click into a contenteditable body and move the caret to the very end so
 * pasted text appends rather than overwrites the middle. This is the
 * "光标 bug" fix — every subsequent paste lands at the caret position,
 * which is exactly where the previous tag-suggestion popover left it.
 */
async function appendToBody(page: Page, text: string): Promise<void> {
  const ed = await pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
  if (!ed) return;
  await humanClick(page, ed);
  await humanPause(100, 250);
  await page.keyboard.press("Control+End");
  await humanPause(100, 200);
  const { pasteText } = await import("./humanize.ts");
  await pasteText(page, text);
  await humanPause(400, 700);
}

/**
 * XHS doesn't expose a dedicated tag input on the publish page — tags are
 * typed inline ("#xxx") in the body, then a suggestion popover shows.
 * Popover class names change periodically; refresh by inspecting a live page.
 */
async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  for (const tag of tags.slice(0, maxTags)) {
    await appendToBody(page, ` #${tag}`);
    await humanPause(400, 700);
    for (const sel of [
      "[class*='suggest']:visible",
      "[class*='option']:visible",
    ]) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        await humanClick(page, loc);
        break;
      }
    }
  }
}

// ── Image Text ──
//
// 小红书图文发布 (?target=image):
//   1. 直接 navigateTo 带 query param, 跳过"发布笔记"折叠菜单
//      (菜单项 rect 在 viewport 外, force click 也失败)
//   2. 上传图 (input.upload-input, multiple, accept images)
//   3. 标题 (input.d-text[placeholder*="标题"]) + 正文 (.tiptap) 在上传首图后才挂载
//   4. 标签通过 #xxx 内联 + popover (XHS 没有独立 tag input)
//   5. 底部 "暂存离开" / "发布" 按钮 (提交走"暂存离开" = 存草稿)
async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("小红书", "image_text")!;
  await navigateTo("xiaohongshu", IMAGE_TEXT_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);

  if (draft.images?.length && L.maxImages !== undefined) {
    for (const img of draft.images.slice(0, L.maxImages)) {
      // Click the visible wrapper (not the hidden file input itself) to trigger
      // the OS file dialog. The wrapper has the input as a child with opacity:0
      // and click bubbles through.
      await uploadFile(page, ".upload-wrapper", img);
    }
  }

  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillBody(page, draft.content.slice(0, L.body));

  if (draft.tags?.length && L.maxTags !== undefined) {
    await addTags(page, draft.tags, L.maxTags);
  }

  if (await doSubmit(page)) {
    return { success: true, message: `已保存到小红书草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Video ──
//
// 小红书视频发布 (?target=video, 默认 tab):
//   步骤: 上传视频 → 填标题/正文 → 加标签 → 提交
async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };
  const L = getLimits("小红书", "video")!;

  await navigateTo("xiaohongshu", VIDEO_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);

  await uploadFile(page, ".upload-wrapper", draft.video);
  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillBody(page, draft.content.slice(0, L.body));

  if (draft.tags?.length && L.maxTags !== undefined) {
    await addTags(page, draft.tags, L.maxTags);
  }

  if (await doSubmit(page)) {
    return { success: true, message: `视频已保存到小红书草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Article ──
//
// 小红书写长文 (?target=article → 点 "新的创作" → 进入编辑器):
//   ?target=article 直接进的是中转页 (只有"新的创作" / "导入链接"两个按钮),
//   必须先点 "新的创作" 进入独立编辑器页面
//   编辑器只有 标题(textarea 64 字符) + 正文(tiptap), 没有独立头图/摘要/标签字段
async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("小红书", "article")!;
  await navigateTo("xiaohongshu", ARTICLE_HUB_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await humanEnter(page);

  // Step into editor from the article hub
  const newCreate = page.getByText("新的创作", { exact: true }).first();
  if (await newCreate.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newCreate.click({ force: true }).catch(() => {});
    await sleep(2500);
  }

  // No cover upload area in the current article editor (XHS removed it).
  // draft.cover is intentionally ignored for now — log if a cover was supplied.
  if (draft.cover) {
    console.warn("[xiaohongshu/article] draft.cover ignored — 新版 XHS 文章编辑器无头图上传区");
  }

  if (L.title !== undefined) await fillTitle(page, draft.title.slice(0, L.title));
  if (L.body !== undefined) await fillBody(page, draft.content.slice(0, L.body));

  // No abstract/tag fields in the current article editor either.

  if (await doSubmit(page)) {
    return { success: true, message: `长文已保存到小红书草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
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