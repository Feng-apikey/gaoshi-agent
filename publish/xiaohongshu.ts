import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, dismissPopups, pickVisible, isOnLoginPage, humanReadPause } from "./humanize.ts";
import { fillField, clickButton, addTagsInline, uploadFile } from "./helpers.ts";
import type { DraftData } from "./types.ts";
import { existsSync } from "node:fs";

const CREATOR_URL = "https://creator.xiaohongshu.com";
const DASHBOARD_URL = "https://creator.xiaohongshu.com/publish";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";

const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 10, maxImages: 9 },
  video: { title: 20, body: 1000, maxTags: 10 },
  article: { title: 20, body: 6000, maxTags: 10 },
} as const;

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

function bodyEditorFinder(page: Page): () => Promise<Locator | null> {
  return () => pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|内容)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ]);
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
  await dismissPopups(page);

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await fillTitle(page, draft.title.slice(0, LIMITS.image_text.title));
  await fillBody(page, draft.content.slice(0, LIMITS.image_text.body));
  await addTagsInline(page, bodyEditorFinder(page), draft.tags, LIMITS.image_text.maxTags);

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
  await dismissPopups(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));
  await fillBody(page, draft.content.slice(0, LIMITS.video.body));
  await addTagsInline(page, bodyEditorFinder(page), draft.tags, LIMITS.video.maxTags);

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
  await dismissPopups(page);

  if (draft.cover) {
    if (existsSync(draft.cover)) {
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
    const abstractLoc = await pickVisible(page, [
      () => page.getByPlaceholder(/(摘要|简介)/),
    ]);
    if (abstractLoc) await fillField(page, abstractLoc, draft.abstract.slice(0, 60));
  }

  await addTagsInline(page, bodyEditorFinder(page), draft.tags, LIMITS.article.maxTags);

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
