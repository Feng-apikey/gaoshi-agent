import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, humanClick, pasteText, dismissPopups } from "./humanize.ts";

const CREATOR_URL = "https://creator.douyin.com";
const POST_IMAGE_URL = "https://creator.douyin.com/creator-micro/content/post/image";
const POST_VIDEO_URL = "https://creator.douyin.com/creator-micro/content/post/video";
const POST_ARTICLE_URL = "https://creator.douyin.com/creator-micro/content/post/article";

const LIMITS = {
  image_text: { title: 20, body: 1000, maxTags: 5 },
  video: { title: 30, body: 500, maxTags: 5 },
  article: { title: 30, body: 8000, abstract: 30, maxTags: 5, maxImages: 50 },
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

// ── Helpers ──

/**
 * Pick the first visible locator from a chain of semantic candidates.
 * Accepts either a Locator factory (function) or a list of Locator factories.
 */
async function pickVisible(page: Page, factories: Array<() => Locator>, timeout = 3000): Promise<Locator | null> {
  for (const factory of factories) {
    const loc = factory();
    try {
      if (await loc.first().isVisible({ timeout })) return loc.first();
    } catch {}
  }
  return null;
}

/**
 * Find a title input. The title field on Douyin is a plain <input> with placeholder
 * containing "标题". We use substring regex to tolerate wording variations like
 * "请填写标题" / "视频标题" / "标题（20字以内）".
 */
async function findTitleInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(视频标题|填写标题|标题)/),
  ]);
}

/**
 * Find a description/body editor. Douyin's body editor is typically a
 * <div contenteditable="true"> with an aria-label or data-placeholder hint.
 * Fall back to the first visible contenteditable inside a posting form.
 */
async function findBodyEditor(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|描述|内容|说点什么)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ], 2000);
}

/**
 * Find a tag input. Douyin uses a dedicated <input placeholder="..."> for tag entry.
 */
async function findTagInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(话题|添加标签|标签)/),
  ]);
}

/**
 * Find the abstract (摘要) textarea on the article page.
 */
async function findAbstractInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(摘要|简介)/),
  ]);
}

/**
 * Find the "save draft" button. The exact text varies: 保存草稿 / 存草稿 / 暂存.
 * getByRole is more robust than text= because it matches the button's accessible
 * name (text content), and tolerates sibling whitespace.
 */
async function clickSaveDraft(page: Page): Promise<boolean> {
  const candidates = [/保存草稿/, /存草稿/, /暂存/];
  for (const name of candidates) {
    try {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await humanClick(page, btn);
        await sleep(2000);
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Tag suggestion popover (when the user types "#tag" the platform shows
 * a list of suggestions to pick). The popover lives in a div that
 * animates in; it has no stable semantic name. We click the first
 * suggestion that becomes visible. This is a known-fragile area:
 * if the platform changes the suggestion DOM, this will need a fresh
 * inspection.
 */
async function pickFirstTagSuggestion(page: Page): Promise<void> {
  const candidates = [
    page.locator("[class*='suggest']:visible").first(),
    page.locator("[class*='option']:visible").first(),
    page.locator("[class*='topic']:visible").first(),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 1500 })) { await humanClick(page, loc); return; }
    } catch {}
  }
}

// ── Image Text ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("douyin", POST_IMAGE_URL);
  await sleep(2000);
  const page = await getPage("douyin");
  await dismissPopups(page);

  // Title
  const titleInput = await findTitleInput(page);
  if (titleInput) {
    await humanClick(page, titleInput);
    await pasteText(page, draft.title.slice(0, LIMITS.image_text.title));
    await sleep(300);
  }

  // Body
  const editor = await findBodyEditor(page);
  if (editor) {
    await humanClick(page, editor);
    await pasteText(page, draft.content.slice(0, LIMITS.image_text.body));
    await sleep(300);
  }

  // Tags — pasted into the body editor (Douyin's image-text page doesn't expose
  // a dedicated tag input; tags are inline "#xxx" inside the body).
  if (draft.tags?.length) {
    for (const tag of draft.tags.slice(0, LIMITS.image_text.maxTags)) {
      const ed = await findBodyEditor(page);
      if (ed) {
        await humanClick(page, ed);
        await pasteText(page, ` #${tag}`);
        await sleep(500);
        await pickFirstTagSuggestion(page);
      }
    }
  }

  // Save draft
  if (await clickSaveDraft(page)) {
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
  await dismissPopups(page);

  // Upload video — the upload zone is a clickable area with text like
  // "点击上传" or "上传视频". getByText matches the visible text exactly;
  // we use a regex to be tolerant.
  const uploadZone = page.getByText(/点击上传|上传视频/).first();
  if (await uploadZone.isVisible({ timeout: 5000 })) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      uploadZone.click(),
    ]);
    await fileChooser.setFiles(draft.video);
    try {
      // Wait for the upload to complete — preview <video> or success marker appears.
      await page.waitForSelector("video, [class*='preview'], [class*='success']", { timeout: 60000 });
    } catch {
      return { success: false, message: "视频上传超时" };
    }
    await sleep(2000);
  }

  // Title
  const titleInput = await findTitleInput(page);
  if (titleInput) {
    await humanClick(page, titleInput);
    await pasteText(page, draft.title.slice(0, LIMITS.video.title));
    await sleep(300);
  }

  // Description (video page uses textarea with placeholder "描述" or "简介")
  const descInput = await pickVisible(page, [
    () => page.getByPlaceholder(/^[^]*(视频描述|描述|简介)/),
  ]);
  if (descInput) {
    await humanClick(page, descInput);
    await pasteText(page, draft.content.slice(0, LIMITS.video.body));
    await sleep(300);
  }

  // Tags — dedicated <input> on the video page
  if (draft.tags?.length) {
    const tagInput = await findTagInput(page);
    if (tagInput) {
      await humanClick(page, tagInput);
      await pasteText(page, draft.tags.slice(0, LIMITS.video.maxTags).join(", "));
      await sleep(500);
    }
  }

  if (await clickSaveDraft(page)) {
    return { success: true, message: `视频已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "保存失败" };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("douyin", POST_ARTICLE_URL);
  await sleep(2000);
  const page = await getPage("douyin");
  await dismissPopups(page);

  // Title
  const titleInput = await findTitleInput(page);
  if (titleInput) {
    await humanClick(page, titleInput);
    await pasteText(page, draft.title.slice(0, LIMITS.article.title));
    await sleep(300);
  }

  // Abstract (short blurb shown in feeds)
  const abstractInput = await findAbstractInput(page);
  if (abstractInput) {
    await humanClick(page, abstractInput);
    await pasteText(page, (draft.abstract || draft.content.slice(0, 30)).slice(0, LIMITS.article.abstract));
    await sleep(300);
  }

  // Body
  const editor = await findBodyEditor(page);
  if (editor) {
    await humanClick(page, editor);
    await pasteText(page, draft.content.slice(0, LIMITS.article.body));
    await sleep(300);
  }

  // Tags — inline in body
  if (draft.tags?.length) {
    for (const tag of draft.tags.slice(0, LIMITS.article.maxTags)) {
      const ed = await findBodyEditor(page);
      if (ed) {
        await humanClick(page, ed);
        await pasteText(page, ` #${tag}`);
        await sleep(500);
        await pickFirstTagSuggestion(page);
      }
    }
  }

  if (await clickSaveDraft(page)) {
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
