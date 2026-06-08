import { getMCPClientManager } from "../mcp/mcp-client.ts";
import { checkLogin as douyinCheckLogin, dispatch as douyinDispatch } from "./douyin.ts";
import { checkLogin as biliCheckLogin, dispatch as biliDispatch } from "./bilibili.ts";
import { checkLogin as xhsCheckLogin, dispatch as xhsDispatch } from "./xiaohongshu.ts";
import type { DraftData } from "./types.ts";

type PublishFn = (draft: DraftData) => Promise<{ success: boolean; message: string }>;

const platforms: Record<string, { dispatch: Record<string, PublishFn>; checkLogin: () => Promise<boolean>; label: string }> = {
  "抖音": { dispatch: douyinDispatch, checkLogin: douyinCheckLogin, label: "抖音创作者平台" },
  "B站":  { dispatch: biliDispatch,    checkLogin: biliCheckLogin,    label: "B站创作中心" },
  "小红书": { dispatch: xhsDispatch,    checkLogin: xhsCheckLogin,    label: "小红书创作者平台" },
};

const PUBLISH_TIMEOUT_MS = 180_000; // 3 minutes

async function getDraft(draftId: string): Promise<{ draft: DraftData | null; error?: string }> {
  try {
    const mcp = getMCPClientManager();
    const result = await mcp.callTool("gaoshi", "draft_get", { id: draftId });
    if (!result || result.error) {
      return { draft: null, error: result?.error || "MCP 返回空结果" };
    }
    if (typeof result.id !== "string") {
      return { draft: null, error: "草稿数据缺少 id 字段" };
    }
    return { draft: result as DraftData };
  } catch (err: any) {
    return { draft: null, error: `MCP 连接失败：${err.message || "未知错误"}` };
  }
}

export async function publish(
  platform: string,
  content_type: string,
  draft_id: string,
): Promise<{ success: boolean; message: string; stage?: string }> {
  const p = platforms[platform];
  if (!p) return { success: false, message: `不支持的平台：${platform}。可选：${Object.keys(platforms).join("、")}`, stage: "platform_lookup" };

  const action = p.dispatch[content_type];
  if (!action) {
    const types = Object.keys(p.dispatch).join("、");
    return { success: false, message: `${platform} 不支持内容类型 ${content_type}。可选：${types}`, stage: "content_type_lookup" };
  }

  const { draft, error } = await getDraft(draft_id);
  if (!draft) return { success: false, message: error || `草稿不存在或读取失败：${draft_id}`, stage: "draft_fetch" };

  const loggedIn = await p.checkLogin();
  if (!loggedIn) return { success: false, message: `未登录${platform}，请在 Edge 浏览器中打开${p.label}手动登录后重试`, stage: "login_check" };

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("发布超时")), PUBLISH_TIMEOUT_MS)
    );
    const result = await Promise.race([action(draft), timeoutPromise]);
    return { ...result, stage: "publish_complete" };
  } catch (err: any) {
    return { success: false, message: `${platform} 发布异常：${err.message || "未知错误"}`, stage: "publish_action" };
  }
}

export async function checkLogin(platform: string): Promise<{ success: boolean; message: string }> {
  const p = platforms[platform];
  if (!p) return { success: false, message: `不支持的平台：${platform}` };
  try {
    const loggedIn = await p.checkLogin();
    return { success: true, message: loggedIn ? "已登录" : "未登录" };
  } catch (err: any) {
    return { success: false, message: `检查登录状态失败：${err.message}` };
  }
}
