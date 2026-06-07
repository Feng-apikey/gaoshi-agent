import type { Page } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";

const CREATOR_URL = "https://member.bilibili.com";
const DYNAMIC_URL = "https://member.bilibili.com/platform/upload/dynamic";
const VIDEO_URL = "https://member.bilibili.com/platform/upload/video";
const ARTICLE_URL = "https://member.bilibili.com/platform/article";

const LIMITS = {
  image_text: { text: 2000, maxImages: 9, maxTags: 5 },
  video: { title: 30, desc: 250, maxTags: 10 },
  article: { title: 30, body: 20000, maxImages: 50 },
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
  for (const txt of ["我知道了", "知道了", "关闭", "跳过"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await sleep(300); }
    } catch {}
  }
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const selectors = ['input[placeholder*="标题"]', 'input[placeholder*="视频标题"]', 'textarea[placeholder*="标题"]'];
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

async function fillTextarea(page: Page, text: string): Promise<void> {
  const selectors = ['textarea[placeholder*="说点什么"]', 'textarea[placeholder*="发表动态"]', '[contenteditable="true"]:visible'];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 3000 }))) continue;
      await el.click();
      await sleep(150);
      await pasteText(page, text);
      await sleep(300);
      return;
    } catch {}
  }
}

async function addTags(page: Page, tags: string[], maxTags: number): Promise<void> {
  if (!tags?.length) return;
  const tagStr = tags.slice(0, maxTags).join(", ");
  const selectors = ['input[placeholder*="标签"]', 'input[placeholder*="添加标签"]'];
  for (const sel of selectors) {
    try {
      const input = page.locator(sel).first();
      if (!(await input.isVisible({ timeout: 2000 }))) continue;
      await input.click();
      await sleep(200);
      await input.fill(tagStr);
      await sleep(500);
      return;
    } catch {}
  }
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  const fs = await import("node:fs");
  if (!filePath || !fs.existsSync(filePath)) return;
  const isVideo = /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(filePath);
  const hints = isVideo
    ? ["可直接将视频文件拖入此区域", "点击上传视频", "选择视频文件"]
    : ["可直接将图片文件拖入此区域", "点击上传图片", "选择图片文件"];
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
  await sleep(isVideo ? 17000 : 5000);
}

async function clickSubmit(page: Page): Promise<void> {
  for (const txt of ["发布", "提交审核", "立即发布", "投稿"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await sleep(3000); return; }
    } catch {}
  }
  // Fallback: try save draft
  for (const txt of ["保存草稿", "存草稿"]) {
    try {
      const btn = page.locator(`text=${txt}`).first();
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await sleep(2000); return; }
    } catch {}
  }
}

// ── Image Text (Dynamic) ──

async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", DYNAMIC_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await dismissPopups(page);

  await fillTextarea(page, draft.content.slice(0, LIMITS.image_text.text));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.image_text.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await clickSubmit(page);
  return { success: true, message: `动态已保存到B站草稿箱：${draft.title}` };
}

// ── Video ──

async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };

  await navigateTo("bilibili", VIDEO_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await dismissPopups(page);

  await uploadFile(page, draft.video);
  await fillTitle(page, draft.title.slice(0, LIMITS.video.title));

  if (draft.content) {
    await fillTextarea(page, draft.content.slice(0, LIMITS.video.desc));
  }
  await addTags(page, draft.tags, LIMITS.video.maxTags);
  await clickSubmit(page);
  return { success: true, message: `视频已保存到B站草稿箱：${draft.title}` };
}

// ── Article ──

async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  await navigateTo("bilibili", ARTICLE_URL);
  await sleep(3000);
  const page = await getPage("bilibili");

  if (page.url().includes("/login") || page.url().includes("/signin")) {
    return { success: false, message: "未登录B站，请在 Edge 中打开 member.bilibili.com 手动登录后重试" };
  }
  await dismissPopups(page);

  await fillTitle(page, draft.title.slice(0, LIMITS.article.title));
  await fillBody(page, draft.content.slice(0, LIMITS.article.body));

  if (draft.images?.length) {
    for (const img of draft.images.slice(0, LIMITS.article.maxImages)) {
      await uploadFile(page, img);
      await sleep(3000);
    }
  }

  await clickSubmit(page);
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
