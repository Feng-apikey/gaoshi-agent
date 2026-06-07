import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserManager } from "./browser.ts";
import { isLoggedIn, getLoginQrcode, waitForLogin, logout } from "./login.ts";
import { publishImageText, publishVideo, publishArticle } from "./publish.ts";
import { searchFeeds } from "./search.ts";
import { LIMITS } from "./constants.ts";

const bm = new BrowserManager({ headless: false });
const server = new McpServer({ name: "xiaohongshu-mcp", version: "0.2.0" });

// ── Rate limit ──
let lastPublishTime = 0;
const PUBLISH_COOLDOWN = 10_000; // 10s between publishes

// ── Login state (persisted via storage-state.json) ──
let loginState = false;

function fastLoginCheck(page: import("playwright").Page): boolean {
  const url = page.url();
  return !url.includes("/login") && !url.includes("/signin") && url !== "about:blank";
}

async function waitCooldown(): Promise<void> {
  const elapsed = Date.now() - lastPublishTime;
  if (elapsed < PUBLISH_COOLDOWN) {
    const wait = PUBLISH_COOLDOWN - elapsed + Math.random() * 5000;
    console.error(`[xiaohongshu-mcp] cooldown: waiting ${Math.round(wait / 1000)}s`);
    await new Promise(r => setTimeout(r, wait));
  }
  lastPublishTime = Date.now();
}

function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function err(msg: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
}

async function ensureBrowser() {
  return bm.launch();
}

server.registerTool("xhs_check_login", {
  title: "检查小红书登录状态",
  description: "检查当前是否已登录小红书创作者平台",
  inputSchema: {},
}, async () => {
  try {
    const page = await ensureBrowser();
    const loggedIn = await isLoggedIn(page);
    return ok({ logged_in: loggedIn });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_get_login_qrcode", {
  title: "打开小红书登录页面",
  description: "打开浏览器窗口显示小红书创作者平台登录页。用户直接在浏览器中扫码，无需查看文件。打开后请直接告诉用户浏览器已打开，不要提及文件路径。扫码后调用 xhs_wait_login。",
  inputSchema: {},
}, async () => {
  try {
    const page = await ensureBrowser();
    const result = await getLoginQrcode(page);
    return ok(result as any);
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_wait_login", {
  title: "等待小红书扫码登录完成",
  description: "在浏览器打开后调用，轮询等待用户扫码登录（超时 120 秒）。返回成功后务必调用 xhs_check_login 确认登录状态再发布",
  inputSchema: { timeout_seconds: z.number().optional().default(120) },
}, async ({ timeout_seconds }) => {
  try {
    const page = await ensureBrowser();
    const success = await waitForLogin(page, (timeout_seconds ?? 120) * 1000);
    if (success) { loginState = true; await bm.persistState(); }
    return ok({ success, message: success ? "登录成功" : "登录超时，请重试" });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_publish_image_text", {
  title: "发布小红书图文笔记",
  description: "将图文内容发布到小红书创作者平台草稿箱。⚠️ 操作期间请勿触碰浏览器窗口，等待完成后查看结果。需要先登录。标题最多20字，正文最多1000字，标签最多10个，图片最多9张。",
  inputSchema: {
    title: z.string().min(1).max(LIMITS.image_text.title),
    content: z.string().min(1).max(LIMITS.image_text.body),
    tags: z.array(z.string()).optional().default([]),
    image_paths: z.array(z.string()).optional().default([]),
    cover_path: z.string().optional().default(""),
  },
}, async ({ title, content, tags, image_paths, cover_path }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 xhs_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishImageText(page, { title, body: content, tags, imagePaths: image_paths, coverPath: cover_path });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `笔记已保存到小红书草稿箱（操作完成，可以触碰浏览器了）：${title}` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_publish_video", {
  title: "发布小红书视频",
  description: "将视频文件上传到小红书创作者平台草稿箱。⚠️ 操作期间请勿触碰浏览器窗口。需要先登录。标题最多20字，描述最多1000字。",
  inputSchema: {
    video_path: z.string().min(1),
    title: z.string().min(1).max(LIMITS.video.title),
    description: z.string().min(1).max(LIMITS.video.body),
    tags: z.array(z.string()).optional().default([]),
    cover_path: z.string().optional().default(""),
  },
}, async ({ video_path, title, description, tags, cover_path }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 xhs_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishVideo(page, { videoPath: video_path, title, description, tags, coverPath: cover_path });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `视频已保存到小红书草稿箱（操作完成，可以触碰浏览器了）：${title}` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_publish_article", {
  title: "发布小红书长文",
  description: "将长文内容发布到小红书创作者平台草稿箱（小红书长文功能）。⚠️ 操作期间请勿触碰浏览器窗口。需要先登录。标题最多20字，正文最多6000字。",
  inputSchema: {
    title: z.string().min(1).max(LIMITS.article.title),
    content: z.string().min(1).max(LIMITS.article.body),
    tags: z.array(z.string()).optional().default([]),
    abstract: z.string().optional().default(""),
    cover_path: z.string().optional().default(""),
    header_path: z.string().optional().default(""),
  },
}, async ({ title, content, tags, abstract, cover_path, header_path }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 xhs_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishArticle(page, { title, body: content, tags, abstract, coverPath: cover_path, headerPath: header_path });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `长文已保存到小红书草稿箱（操作完成，可以触碰浏览器了）：${title}` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_search_feeds", {
  title: "搜索小红书笔记",
  description: "在小红书主站搜索笔记/视频内容，返回标题、作者、点赞数等信息",
  inputSchema: {
    keyword: z.string().min(1),
    sort_by: z.enum(["general", "most_popular", "most_forwarded", "latest"]).optional().default("general"),
    note_type: z.enum(["all", "video", "note"]).optional().default("all"),
  },
}, async ({ keyword, sort_by, note_type }) => {
  try {
    const page = await ensureBrowser();
    const results = await searchFeeds(page, keyword, sort_by, note_type);
    return ok({ results } as any);
  } catch (e: any) { return err(e.message); }
});

server.registerTool("xhs_logout", {
  title: "退出小红书登录",
  description: "清除小红书登录状态（删除本地 cookie）",
  inputSchema: {},
}, async () => {
  try {
    const page = await ensureBrowser();
    loginState = false;
    await logout(page);
    await bm.close();
    return ok({ success: true, message: "已退出登录" });
  } catch (e: any) { return err(e.message); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[xiaohongshu-mcp] Server started (stdio, headed)");
}

main().catch((err) => { console.error("[xiaohongshu-mcp] Fatal:", err); process.exit(1); });

async function shutdown() {
  try { await bm.persistState(); } catch {}
  await bm.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);