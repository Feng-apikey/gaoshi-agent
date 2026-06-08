import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, dismissPopups, pickVisible, humanReadPause, isOnLoginPage, withIdleMouseMove } from "./humanize.ts";
import { fillField, clickButton, addTagsInline } from "./helpers.ts";
import type { DraftData } from "./types.ts";

const CREATOR_URL = "https://creator.douyin.com";
const POST_IMAGE_URL = "https://creator.douyin.com/creator-micro/content/post/image";
const POST_VIDEO_URL = "https://creator.douyin.com/creator-micro/content/post/video";
const POST_ARTICLE_URL = "https://creator.douyin.com/creator-micro/content/post/article";

const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 5 },
  video: { title: 30, body: 500, maxTags: 5 },
  article: { title: 30, body: 8000, abstract: 30, maxTags: 5, maxImages: 50 },
} as const;

// ── Element finders ──

async function findTitleInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(视频标题|填写标题|标题)/),
  ]);
}

async function findBodyEditor(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|描述|内容|说点什么)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ], 2000);
}

async function findTagInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(话题|添加标签|标签)/),
  ]);
}

async function findAbstractInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(摘要|简介)/),
  ]);
}

async function submitDraft(page: Page): Promise<boolean> {
  await humanReadPause();
  return clickButton(page, [/保存草稿/, /存草稿/, /暂存/]);
}

// ── Image Text ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("douyin", POST_IMAGE_URL);
  await sleep(2000);
  const page = await getPage("douyin");
  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await dismissPopups(page);

  const titleInput = await findTitleInput(page);
  if (titleInput) await fillField(page, titleInput, draft.title.slice(0, LIMITS.image_text.title));

  const editor = await findBodyEditor(page);
  if (editor) await fillField(page, editor, draft.content.slice(0, LIMITS.image_text.body));

  await addTagsInline(page, () => findBodyEditor(page), draft.tags, LIMITS.image_text.maxTags);

  if (await submitDraft(page)) {
    return { success: true, message: `已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("douyin", POST_VIDEO_URL);
  await sleep(2000);
  const page = await getPage("douyin");
  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await dismissPopups(page);

  const uploadZone = page.getByText(/点击上传|上传视频/).first();
  if (await uploadZone.isVisible({ timeout: 5000 })) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      uploadZone.click(),
    ]);
    await fileChooser.setFiles(draft.video);
    await withIdleMouseMove(page, async () => {
      try {
        await page.waitForSelector("video", { timeout: 120000 });
      } catch {
        await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      }
    });
    await sleep(2000);
  }

  const titleInput = await findTitleInput(page);
  if (titleInput) await fillField(page, titleInput, draft.title.slice(0, LIMITS.video.title));

  const descInput = await pickVisible(page, [
    () => page.getByPlaceholder(/(视频描述|描述|简介)/),
  ]);
  if (descInput) await fillField(page, descInput, draft.content.slice(0, LIMITS.video.body));

  if (draft.tags?.length) {
    const tagInput = await findTagInput(page);
    if (tagInput) {
      await fillField(page, tagInput, draft.tags.slice(0, LIMITS.video.maxTags).join(", "));
    }
  }

  if (await submitDraft(page)) {
    return { success: true, message: `视频已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "保存失败" };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("douyin", POST_ARTICLE_URL);
  await sleep(2000);
  const page = await getPage("douyin");
  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await dismissPopups(page);

  const titleInput = await findTitleInput(page);
  if (titleInput) await fillField(page, titleInput, draft.title.slice(0, LIMITS.article.title));

  const abstractInput = await findAbstractInput(page);
  if (abstractInput) {
    await fillField(page, abstractInput, (draft.abstract || draft.content.slice(0, 30)).slice(0, LIMITS.article.abstract));
  }

  const editor = await findBodyEditor(page);
  if (editor) await fillField(page, editor, draft.content.slice(0, LIMITS.article.body));

  await addTagsInline(page, () => findBodyEditor(page), draft.tags, LIMITS.article.maxTags);

  if (await submitDraft(page)) {
    return { success: true, message: `长文已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
  await navigateTo("douyin", CREATOR_URL);
  await sleep(3000);
  const page = await getPage("douyin");
  try {
    await page.waitForSelector("body", { timeout: 5000 });
  } catch {}
  const bodyText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  const markers = ["发布视频", "内容管理", "作品管理", "创作中心", "数据中心"];
  return markers.filter(m => bodyText.includes(m)).length >= 2;
}

// ── Dispatch ──

export const dispatch: Record<string, (draft: DraftData) => Promise<{ success: boolean; message: string }>> = {
  image_text: publishImageText,
  video: publishVideo,
  article: publishArticle,
};
