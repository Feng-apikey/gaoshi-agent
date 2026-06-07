import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";

const CREATOR_URL = "https://creator.xiaohongshu.com";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";
const ARTICLE_URL = "https://creator.xiaohongshu.com/publish/article";

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
  for (const txt of ["我知道了", "关闭", "取消", "跳过"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await sleep(300); }
    } catch {}
  }
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const selectors = ['[placeholder*="标题"]', '[class*="title"] input', '[class*="title"] textarea'];
  for (const sel of selectors) {
    try {
      const input = page.locator(sel).first();
      if (!(await input.isVisible({ timeout: 3000 }))) continue;
      await input.click();
      await sleep(150);
      await page.keyboard.press("Control+a");
      await pasteText(page, title);
      await sleep(300);
      return;
    } catch {}
  }
}

async function fillBody(page: Page, body: string): Promise<void> {
  const editor = page.locator('[contenteditable="true"]:visible').first();
  if (!(await editor.isVisible({ timeout: 3000 }))) return;
  await editor.click();
  await sleep(150);
  await page.keyboard.press("Control+a");
  await pasteText(page, body);
  await sleep(300);
}

async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  const editor = page.locator('[contenteditable="true"]:visible').first();
  for (const tag of tags.slice(0, maxTags)) {
    await editor.click();
    await sleep(200);
    await pasteText(page, ` #${tag}`);
    await sleep(500);
    try {
      const suggestion = page.locator('[class*="suggest"]:visible, [class*="option"]:visible').first();
      if (await suggestion.isVisible({ timeout: 1500 })) await suggestion.click();
    } catch {}
  }
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  const fs = await import("node:fs");
  if (!filePath || !fs.existsSync(filePath)) return;
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(filePath);
  const hints = isVideo
    ? ["可直接将视频文件拖入此区域", "可将视频拖拽到此处", "点击上传视频"]
    : ["可直接将图片文件拖入此区域", "可将图片拖拽到此处", "点击上传图片"];
  let uploadEl: any = null;
  for (const hint of hints) {
    const el = page.locator(`text=${hint}`).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) { uploadEl = el; break; }
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
  for (const txt of ["存草稿", "保存草稿", "暂存"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
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
  await dismissPopups(page);

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
  await dismissPopups(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));
  await fillBody(page, draft.content.slice(0, LIMITS.video.body));
  await addTags(page, draft.tags, LIMITS.video.maxTags);
  await saveDraft(page);
  return { success: true, message: `视频已保存到小红书草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("xiaohongshu", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("xiaohongshu");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录小红书，请在 Edge 中打开 creator.xiaohongshu.com 手动登录后重试" };
  }
  await dismissPopups(page);

  // Header image (upload before text)
  if (draft.header) {
    const fs = await import("node:fs");
    if (fs.existsSync(draft.header)) {
      const headerZone = page.locator('text=头图, text=文章头图, text=上传头图').first();
      if (await headerZone.isVisible({ timeout: 2000 }).catch(() => false)) {
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 5000 }),
          headerZone.click(),
        ]);
        await fc.setFiles(draft.header);
        await sleep(3000);
      }
    }
  }

  // Cover
  if (draft.cover) {
    const fs = await import("node:fs");
    if (fs.existsSync(draft.cover)) {
      const coverZone = page.locator('text=上传封面, text=封面, text=添加封面').first();
      if (await coverZone.isVisible({ timeout: 2000 }).catch(() => false)) {
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
    const inputs = page.locator('textarea, input[type="text"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      const ph = await el.getAttribute("placeholder").catch(() => "") || "";
      if (ph.includes("摘要") || ph.includes("简介")) {
        await el.click();
        await pasteText(page, draft.abstract.slice(0, 60));
        await sleep(300);
        break;
      }
    }
  }
  await addTags(page, draft.tags, LIMITS.article.maxTags);
  await saveDraft(page);
  return { success: true, message: `长文已保存到小红书草稿箱：${draft.title}` };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
  await navigateTo("xiaohongshu", CREATOR_URL);
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
