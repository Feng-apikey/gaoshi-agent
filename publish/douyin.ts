import type { Page, Locator } from "playwright";
import { getPage, navigateTo } from "./browser-manager.ts";
import { sleep, pickVisible, humanReadPause, isOnLoginPage, humanEnter, humanClick, humanPause, withIdleMouseMove } from "./humanize.ts";
import { fillField, clickButton, injectFileViaOSDialog, uploadFile, resolveMaterialPath } from "./helpers.ts";
import { getLimits } from "../schemas/platform-schema.ts";
import type { DraftData } from "./types.ts";

// ── Direct post URLs (skip the homepage redirect dialog traps) ──
const POST_IMAGE_URL = "https://creator.douyin.com/creator-micro/content/post/image";
const POST_VIDEO_URL = "https://creator.douyin.com/creator-micro/content/post/video";
const POST_ARTICLE_URL = "https://creator.douyin.com/creator-micro/content/post/article";

// ── Element finders ──

/**
 * Title input. Substring regex tolerates "请填写标题" / "视频标题" / "标题（20字以内）".
 */
async function findTitleInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(视频标题|填写标题|标题)/),
  ]);
}

/**
 * Body editor — usually a contenteditable div, sometimes a textbox.
 */
async function findBodyEditor(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByRole("textbox", { name: /(正文|描述|内容|说点什么)/ }),
    () => page.locator("[contenteditable='true']:visible").first(),
  ], 2000);
}

/**
 * Tag input on the video page — dedicated <input placeholder="...">.
 */
async function findTagInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(话题|添加标签|标签)/),
  ]);
}

/**
 * Abstract textarea on the article page.
 */
async function findAbstractInput(page: Page): Promise<Locator | null> {
  return pickVisible(page, [
    () => page.getByPlaceholder(/(摘要|简介)/),
  ]);
}

/**
 * "保存草稿 / 存草稿 / 暂存" — getByRole matches accessible name (tolerant of whitespace).
 */
async function clickSaveDraft(page: Page): Promise<boolean> {
  return clickButton(page, [/保存草稿/, /存草稿/, /暂存/]);
}

/**
 * Tag suggestion popover — known-fragile. Class names change periodically;
 * refresh by inspecting a live page when this stops working.
 */
async function pickFirstTagSuggestion(page: Page): Promise<void> {
  const candidates = [
    page.locator("[class*='suggest']:visible").first(),
    page.locator("[class*='option']:visible").first(),
    page.locator("[class*='topic']:visible").first(),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 1500 })) {
        await humanClick(page, loc);
        return;
      }
    } catch {}
  }
}

/**
 * Click into a contenteditable body and move the caret to the very end so
 * pasted text appends rather than overwrites the middle. Fixes the "光标
 * bug" where every subsequent paste lands at the click point.
 */
async function appendToBody(page: Page, text: string): Promise<void> {
  const editor = await findBodyEditor(page);
  if (!editor) return;
  await humanClick(page, editor);
  await humanPause(100, 250);
  // Ctrl+End → move caret to end of contenteditable
  await page.keyboard.press("Control+End");
  await humanPause(100, 200);
  const { pasteText } = await import("./humanize.ts");
  await pasteText(page, text);
  await humanPause(400, 700);
}

/**
 * Inline-tag append for image_text. Tags live in the body as "#xxx" with
 * a trailing space. We append each tag at the body end so order is
 * deterministic and popovers appear under the caret.
 */
async function appendTagsToBody(page: Page, tags: string[], maxTags: number): Promise<void> {
  for (const tag of tags.slice(0, maxTags)) {
    await appendToBody(page, ` #${tag}`);
    await humanPause(300, 500);
    await pickFirstTagSuggestion(page);
  }
}

// ── Image Text ──
//
// 抖音图文发布页 (creator.douyin.com/.../post/image) 页面结构:
//   ┌────────────────────────────────────────────────────┐
//   │ 左侧表单 (基础信息 + 扩展信息 + 发布设置)            │
//   │   - 作品描述 (textarea, 必填, 含 #话题 字段)       │
//   │   - 封面设置 (默认从图片区第一张提取, 可手动换)     │
//   │   - 添加合集 / 自主声明 / 选择音乐 / 关联热点        │
//   │                                                     │
//   │ 右侧大区 (.content-right-ik9gts)                    │
//   │   └─ 手机预览 (.container-IRuUu2)                  │
//   │       └─ "点击上传 或直接将图片文件拖入此区域"        │
//   │          (无图片时显示, 有图片时换成缩略图+进度条)    │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 右侧点上传区 → 逐张走 OS dialog 注入图片
//   2. 左侧填标题 (placeholder "请填写标题")
//   3. 左侧填正文 (contenteditable, 必须含 #xxx 话题)
//   4. 封面设置: 默认从已上传图片取第一张, 不再单独上传; 只有 draft.cover 显式指定且跟图片列表不同时才换
//   5. 标签 append 到正文末尾 #xxx (抖音 image_text 没有独立标签 input)
//   6. 点保存草稿 (按钮在底部, 文案"保存草稿"/"暂存离开")
async function publishImageText(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("抖音", "image_text")!;
  await navigateTo("douyin", POST_IMAGE_URL);
  await sleep(2000);
  const page = await getPage("douyin");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await humanEnter(page);

  // 1. 右侧手机预览容器 = 真上传触发区 (点击它会触发 React 内部的 input.click())
  //    Selector 来自 DOM 扫描, 不要改成 getByText(会命中更深的 .bold-KtUGPM 占位文本节点)
  if (draft.images?.length && L.maxImages !== undefined) {
    const uploadZone = page.locator(".container-IRuUu2").first();
    await withIdleMouseMove(page, () => humanClick(page, uploadZone));
    for (const img of draft.images.slice(0, L.maxImages)) {
      const abs = resolveMaterialPath(img);
      await injectFileViaOSDialog(page, abs, false);
    }
  }

  // 2. 标题: placeholder 形如 "请填写标题" / "标题(20字以内)"
  const titleInput = await findTitleInput(page);
  if (titleInput && L.title !== undefined) await fillField(page, titleInput, draft.title.slice(0, L.title));

  // 3. 正文: contenteditable (TipTap 类富文本); 不要 Ctrl+A 全选,会破坏已有结构
  const editor = await findBodyEditor(page);
  if (editor && L.body !== undefined) await fillField(page, editor, draft.content.slice(0, L.body));

  // 4. 封面: 抖音默认从已上传图片取第一张, 只有显式不同 cover 才覆盖
  if (draft.cover && L.maxImages !== undefined) {
    await uploadFile(page, ".content-upload-kVVDpn", draft.cover);
  }

  // 5. 标签: image_text 没有独立标签 input, append 到正文末尾 #xxx
  if (draft.tags?.length && L.maxTags !== undefined) {
    await appendTagsToBody(page, draft.tags, L.maxTags);
  }

  // 6. 保存草稿: 底部固定按钮 "保存草稿" / "暂存离开"
  await humanReadPause();
  if (await clickSaveDraft(page)) {
    return { success: true, message: `已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Video ──
//
// 抖音视频发布页 (creator.douyin.com/.../post/video) 页面结构:
//   ┌────────────────────────────────────────────────────┐
//   │ 顶部: 大视频上传 drop-zone                          │
//   │   - "点击上传 或将视频拖拽到此区域"                  │
//   │                                                     │
//   │ 下方表单:                                            │
//   │   - 视频标题 (placeholder "请填写视频标题")         │
//   │   - 视频描述 (contenteditable, 含 #话题)             │
//   │   - 封面设置 (单独的区域, 不从视频自动提取)        │
//   │   - 话题 (独立 input, 逗号分隔, 不需要 #)            │
//   │   - 位置 / 关联热点                                  │
//   │                                                     │
//   │ 底部: 发布按钮                                       │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 上传视频 (拖入或点击触发 OS dialog)
//   2. 填标题 → 填描述 → 单独上传封面
//   3. 填话题 (有独立 input, 逗号分隔, 区别于 image_text 的 #xxx inline 形式)
//   4. 保存草稿
async function publishVideo(draft: DraftData): Promise<{ success: boolean; message: string }> {
  if (!draft.video) return { success: false, message: "草稿缺少视频文件" };
  const L = getLimits("抖音", "video")!;

  await navigateTo("douyin", POST_VIDEO_URL);
  await sleep(2000);
  const page = await getPage("douyin");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await humanEnter(page);

  // 1. 上传视频 (大 drop-zone, DOM 扫描确认 .upload-card-IBCFN_)
  await uploadFile(page, ".upload-card-IBCFN_", draft.video);

  // 2a. 标题
  const titleInput = await findTitleInput(page);
  if (titleInput && L.title !== undefined) await fillField(page, titleInput, draft.title.slice(0, L.title));

  // 2b. 描述 (contenteditable)
  const descEditor = await findBodyEditor(page);
  if (descEditor && L.body !== undefined) await fillField(page, descEditor, draft.content.slice(0, L.body));

  // 2c. 封面 (video 的封面是单独上传, 不像 image_text 自动从图取)
  //     DOM 扫描确认 .coverContainer-NNTF1U 是封面容器
  if (draft.cover) {
    await uploadFile(page, ".coverContainer-NNTF1U", draft.cover);
  }

  // 3. 话题 — 独立 input, 逗号分隔 (区别于 image_text 的 #xxx inline)
  if (draft.tags?.length && L.maxTags !== undefined) {
    const tagInput = await findTagInput(page);
    if (tagInput) {
      await fillField(page, tagInput, draft.tags.slice(0, L.maxTags).join(", "));
    }
  }

  // 4. 保存
  await humanReadPause();
  if (await clickSaveDraft(page)) {
    return { success: true, message: `视频已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "保存失败" };
}

// ── Article ──
//
// 抖音长文 (creator.douyin.com/.../post/article) 页面结构:
//   ┌────────────────────────────────────────────────────┐
//   │ 标题 (placeholder "请填写标题")                    │
//   │ 摘要 (placeholder "添加文章摘要...")                │
//   │                                                     │
//   │ 正文区 (TipTap 富文本编辑器)                        │
//   │   - 支持 markdown / 工具栏插入表格/图片/代码块    │
//   │   - fillField 走 Control+End, 不破坏已插入结构      │
//   │                                                     │
//   │ 正文头图上传 (.content-upload-go676U) — 插入正文显示│
//   │ 文章封面上传 (.content-upload-ksKds3) — 文章列表封面│
//   │                                                     │
//   │ (无独立话题字段, 长文的话题机制未实现)              │
//   └────────────────────────────────────────────────────┘
//
// 发布步骤:
//   1. 进页面 → 填标题 → 填摘要
//   2. 填正文 (TipTap 富文本, 不 Ctrl+A 避免破坏表格)
//   3. 上传正文头图 + 文章封面
//   4. 保存草稿
async function publishArticle(draft: DraftData): Promise<{ success: boolean; message: string }> {
  const L = getLimits("抖音", "article")!;
  await navigateTo("douyin", POST_ARTICLE_URL);
  await sleep(2000);
  const page = await getPage("douyin");

  if (isOnLoginPage(page)) {
    return { success: false, message: "未登录抖音，请在 Edge 中打开 creator.douyin.com 手动登录后重试" };
  }
  await humanEnter(page);

  // 标题
  const titleInput = await findTitleInput(page);
  if (titleInput && L.title !== undefined) await fillField(page, titleInput, draft.title.slice(0, L.title));

  // 摘要 (article 独立字段, image_text/video 没有)
  const abstractInput = await findAbstractInput(page);
  if (abstractInput && L.abstract !== undefined) {
    const abs = (draft.abstract || draft.content.slice(0, 30)).slice(0, L.abstract);
    await fillField(page, abstractInput, abs);
  }

  // 正文 (TipTap 富文本, fillField 用 Control+End 不破坏表格)
  const editor = await findBodyEditor(page);
  if (editor && L.body !== undefined) await fillField(page, editor, draft.content.slice(0, L.body));

  // 正文头图 (插入到正文中显示的图片)
  if (draft.header) {
    await uploadFile(page, ".content-upload-go676U", draft.header);
  }

  // 封面 (article 独立封面, image_text 是从图片自动提取)
  if (draft.cover) {
    await uploadFile(page, ".content-upload-ksKds3", draft.cover);
  }

  // 长文没有独立标签字段 (article 有自己的话题机制, 当前 dispatcher 不处理)

  await humanReadPause();
  if (await clickSaveDraft(page)) {
    return { success: true, message: `长文已保存到抖音草稿箱：${draft.title}` };
  }
  return { success: false, message: "找不到保存草稿按钮" };
}

// ── Login check ──

export async function checkLogin(): Promise<boolean> {
  await navigateTo("douyin", POST_IMAGE_URL);
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