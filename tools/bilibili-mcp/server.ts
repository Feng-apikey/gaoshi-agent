import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserManager } from "./browser.ts";
import { isLoggedIn, getLoginQrcode, waitForLogin, logout } from "./login.ts";
import { publishDynamic, publishVideo, publishArticle } from "./publish.ts";
import { searchVideos } from "./search.ts";
import { LIMITS } from "./constants.ts";

const bm = new BrowserManager({ headless: false });
const server = new McpServer({ name: "bilibili-mcp", version: "0.2.0" });

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
    console.error(`[bilibili-mcp] cooldown: waiting ${Math.round(wait / 1000)}s`);
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

server.registerTool("bili_check_login", {
  title: "检查B站登录状态",
  description: "检查当前是否已登录B站创作中心",
  inputSchema: {},
}, async () => {
  try {
    const page = await ensureBrowser();
    const loggedIn = await isLoggedIn(page);
    return ok({ logged_in: loggedIn });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_get_login_qrcode", {
  title: "打开B站登录页面",
  description: "打开浏览器窗口显示B站扫码登录页面。用户直接在浏览器中扫码，无需查看文件。打开后请直接告诉用户浏览器已打开，不要提及文件路径。扫码后调用 bili_wait_login。",
  inputSchema: {},
}, async () => {
  try {
    const page = await ensureBrowser();
    const result = await getLoginQrcode(page);
    return ok(result as any);
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_wait_login", {
  title: "等待B站扫码登录完成",
  description: "在浏览器打开后调用，轮询等待用户扫码登录（超时 120 秒）。返回成功后务必调用 bili_check_login 确认登录状态再发布",
  inputSchema: { timeout_seconds: z.number().optional().default(120) },
}, async ({ timeout_seconds }) => {
  try {
    const page = await ensureBrowser();
    const success = await waitForLogin(page, (timeout_seconds ?? 120) * 1000);
    if (success) { loginState = true; await bm.persistState(); }
    return ok({ success, message: success ? "登录成功" : "登录超时，请重试" });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_send_dynamic", {
  title: "发布B站图文动态",
  description: "将图文动态发布到B站创作中心。⚠️ 操作期间请勿触碰浏览器窗口。需要先登录。文本最多2000字，图片最多9张。",
  inputSchema: {
    text: z.string().min(1).max(LIMITS.dynamic.text),
    images: z.array(z.string()).optional().default([]),
    topic_id: z.number().optional().default(0),
    schedule_time: z.number().optional().default(0),
  },
}, async ({ text, images, topic_id, schedule_time }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishDynamic(page, { text, images, topic_id, schedule_time });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `图文动态已发布到B站（操作完成，可以触碰浏览器了）` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_upload_video", {
  title: "发布B站视频",
  description: "将视频文件上传到B站创作中心进行投稿。⚠️ 操作期间请勿触碰浏览器窗口。需要先登录。标题最多30字，描述最多250字，标签最多10个。",
  inputSchema: {
    video_path: z.string().min(1),
    title: z.string().min(1).max(LIMITS.video.title),
    desc: z.string().optional().default(""),
    tid: z.number().optional().default(124),
    tags: z.array(z.string()).optional().default([]),
    cover_path: z.string().optional().default(""),
  },
}, async ({ video_path, title, desc, tid, tags, cover_path }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishVideo(page, { videoPath: video_path, title, desc, tid, tags, coverPath: cover_path });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `视频已投稿到B站（操作完成，可以触碰浏览器了）：${title}` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_send_opus", {
  title: "发布B站图文专栏",
  description: "将图文专栏内容发布到B站创作中心。⚠️ 操作期间请勿触碰浏览器窗口。需要先登录。标题最多30字，正文最多20000字。",
  inputSchema: {
    title: z.string().min(1).max(LIMITS.article.title),
    content: z.string().min(1).max(LIMITS.article.body),
    images: z.array(z.string()).optional().default([]),
    category_id: z.number().optional().default(0),
  },
}, async ({ title, content, images, category_id }) => {
  try {
    const page = await ensureBrowser();
    if (!loginState && !fastLoginCheck(page)) return err("未登录，请先调用 bili_get_login_qrcode 打开浏览器扫码登录");
    await waitCooldown();
    const result = await publishArticle(page, { title, content, images, category_id });
    try { await bm.persistState(); } catch {}
    return ok({ success: true, url: result.url, message: `图文专栏已发布到B站（操作完成，可以触碰浏览器了）：${title}` });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_search", {
  title: "搜索B站视频",
  description: "在B站搜索视频，返回标题、BV号、播放量、UP主等信息",
  inputSchema: {
    keyword: z.string().min(1),
    num: z.number().optional().default(10),
    order: z.enum(["totalrank", "click", "pubdate", "dm"]).optional().default("totalrank"),
  },
}, async ({ keyword, num, order }) => {
  try {
    const page = await ensureBrowser();
    const results = await searchVideos(page, keyword, num, order);
    return ok({ results } as any);
  } catch (e: any) { return err(e.message); }
});

server.registerTool("bili_logout", {
  title: "退出B站登录",
  description: "清除B站登录状态（删除本地 cookie）",
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
  console.error("[bilibili-mcp] Server started (stdio, headed)");
}

main().catch((err) => { console.error("[bilibili-mcp] Fatal:", err); process.exit(1); });

async function shutdown() {
  try { await bm.persistState(); } catch {}
  await bm.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);