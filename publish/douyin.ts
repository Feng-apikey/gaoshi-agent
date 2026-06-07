import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";

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
  abstract: string;
}

// ── Helpers ──

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    const ta = document.createElement("textarea");
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0";
    ta.value = t;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }, text);
  await page.keyboard.press("Control+v");
  await sleep(100);
}

async function dismissPopups(page: Page): Promise<void> {
  const buttons = ["我知道了", "知道了", "关闭", "跳过"];
  for (const txt of buttons) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await sleep(300);
      }
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
  const titleInput = page.locator('input[placeholder*="标题"], [contenteditable="true"]').first();
  if (await titleInput.isVisible({ timeout: 5000 })) {
    await titleInput.click();
    await pasteText(page, draft.title.slice(0, LIMITS.image_text.title));
    await sleep(300);
  }

  // Body
  const editor = page.locator('[contenteditable="true"]').first();
  if (await editor.isVisible({ timeout: 3000 })) {
    await editor.click();
    await pasteText(page, draft.content.slice(0, LIMITS.image_text.body));
    await sleep(300);
  }

  // Tags
  if (draft.tags?.length) {
    for (const tag of draft.tags.slice(0, LIMITS.image_text.maxTags)) {
      await editor.click();
      await pasteText(page, ` #${tag}`);
      await sleep(500);
      try {
        const suggestion = page.locator('[class*="suggest"], [class*="option"]').first();
        if (await suggestion.isVisible({ timeout: 1500 })) await suggestion.click();
      } catch {}
    }
  }

  // Save draft
  await sleep(500);
  for (const txt of ["保存草稿", "存草稿", "暂存"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await sleep(2000);
        return { success: true, message: `已保存到抖音草稿箱：${draft.title}` };
      }
    } catch {}
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

  // Upload video
  const uploadZone = page.locator('text=点击上传, text=上传视频').first();
  if (await uploadZone.isVisible({ timeout: 5000 })) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      uploadZone.click(),
    ]);
    await fileChooser.setFiles(draft.video);
    // Wait for upload: look for preview or success indicator
    try {
      await page.waitForSelector('video, [class*="preview"], [class*="success"]', { timeout: 60000 });
    } catch {
      return { success: false, message: "视频上传超时" };
    }
    await sleep(2000);
  }

  // Title
  const titleInput = page.locator('input[placeholder*="标题"]').first();
  if (await titleInput.isVisible({ timeout: 3000 })) {
    await titleInput.click();
    await pasteText(page, draft.title.slice(0, LIMITS.video.title));
    await sleep(300);
  }

  // Description
  const descInput = page.locator('textarea[placeholder*="描述"], [placeholder*="简介"]').first();
  if (await descInput.isVisible({ timeout: 3000 })) {
    await descInput.click();
    await pasteText(page, draft.content.slice(0, LIMITS.video.body));
    await sleep(300);
  }

  // Tags
  if (draft.tags?.length) {
    for (const tag of draft.tags.slice(0, LIMITS.video.maxTags)) {
      const tagInput = page.locator('[placeholder*="标签"]').first();
      if (await tagInput.isVisible({ timeout: 2000 })) {
        await tagInput.click();
        await pasteText(page, tag);
        await sleep(500);
      }
    }
  }

  // Save draft
  await sleep(500);
  for (const txt of ["保存草稿", "存草稿"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await sleep(2000);
        return { success: true, message: `视频已保存到抖音草稿箱：${draft.title}` };
      }
    } catch {}
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
  const titleInput = page.locator('input[placeholder*="标题"]').first();
  if (await titleInput.isVisible({ timeout: 5000 })) {
    await titleInput.click();
    await pasteText(page, draft.title.slice(0, LIMITS.article.title));
    await sleep(300);
  }

  // Abstract (optional, short description)
  const abstractInput = page.locator('[placeholder*="摘要"], textarea[placeholder*="简介"]').first();
  if (await abstractInput.isVisible({ timeout: 2000 })) {
    await abstractInput.click();
    await pasteText(page, (draft.abstract || draft.content.slice(0, 30)).slice(0, LIMITS.article.abstract));
    await sleep(300);
  }

  // Body
  const editor = page.locator('[contenteditable="true"]').first();
  if (await editor.isVisible({ timeout: 3000 })) {
    await editor.click();
    await pasteText(page, draft.content.slice(0, LIMITS.article.body));
    await sleep(300);
  }

  // Tags
  if (draft.tags?.length) {
    for (const tag of draft.tags.slice(0, LIMITS.article.maxTags)) {
      await editor.click();
      await pasteText(page, ` #${tag}`);
      await sleep(500);
      try {
        const suggestion = page.locator('[class*="suggest"], [class*="option"]').first();
        if (await suggestion.isVisible({ timeout: 1500 })) await suggestion.click();
      } catch {}
    }
  }

  // Save draft
  await sleep(500);
  for (const txt of ["保存草稿", "存草稿", "暂存"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await sleep(2000);
        return { success: true, message: `长文已保存到抖音草稿箱：${draft.title}` };
      }
    } catch {}
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
