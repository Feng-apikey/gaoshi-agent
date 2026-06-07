import { getMCPClientManager } from "../mcp/mcp-client.ts";
import { checkLogin as douyinCheckLogin, dispatch as douyinDispatch, type DraftData } from "./douyin.ts";
import { checkLogin as biliCheckLogin, dispatch as biliDispatch } from "./bilibili.ts";
import { checkLogin as xhsCheckLogin, dispatch as xhsDispatch } from "./xiaohongshu.ts";

type PublishFn = (draft: DraftData) => Promise<{ success: boolean; message: string }>;

const platforms: Record<string, { dispatch: Record<string, PublishFn>; checkLogin: () => Promise<boolean>; label: string }> = {
  "抖音": { dispatch: douyinDispatch, checkLogin: douyinCheckLogin, label: "抖音创作者平台" },
  "B站":  { dispatch: biliDispatch,    checkLogin: biliCheckLogin,    label: "B站创作中心" },
  "小红书": { dispatch: xhsDispatch,    checkLogin: xhsCheckLogin,    label: "小红书创作者平台" },
};

async function getDraft(draftId: string): Promise<DraftData | null> {
  try {
    const mcp = getMCPClientManager();
    const result = await mcp.callTool("gaoshi", "draft_get", { id: draftId });
    if (!result || result.error) return null;
    return result as DraftData;
  } catch {
    return null;
  }
}

export async function publish(
  platform: string,
  content_type: string,
  draft_id: string,
): Promise<{ success: boolean; message: string }> {
  const p = platforms[platform];
  if (!p) return { success: false, message: `不支持的平台：${platform}。可选：${Object.keys(platforms).join("、")}` };

  const action = p.dispatch[content_type];
  if (!action) {
    const types = Object.keys(p.dispatch).join("、");
    return { success: false, message: `${platform} 不支持内容类型 ${content_type}。可选：${types}` };
  }

  const draft = await getDraft(draft_id);
  if (!draft) return { success: false, message: `草稿不存在或读取失败：${draft_id}` };

  const loggedIn = await p.checkLogin();
  if (!loggedIn) return { success: false, message: `未登录${platform}，请在 Edge 浏览器中打开${p.label}手动登录后重试` };

  try {
    return await action(draft);
  } catch (err: any) {
    return { success: false, message: `${platform} 发布异常：${err.message || "未知错误"}` };
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
