import { getMCPClientManager } from "../mcp/mcp-client.ts";
import { checkLogin as douyinCheckLogin, dispatch as douyinDispatch } from "./douyin.ts";
import { checkLogin as biliCheckLogin, dispatch as biliDispatch } from "./bilibili.ts";
import { checkLogin as xhsCheckLogin, dispatch as xhsDispatch } from "./xiaohongshu.ts";
import type { DraftData } from "./types.ts";
import { getDB } from "../storage/db.ts";
import { materials } from "../storage/schema.ts";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { releasePage } from "./browser-manager.ts";
import { cacheMaterialPath, clearPathCache } from "./helpers.ts";
import { getLimits, usesInlineHashtags } from "../schemas/platform-schema.ts";

type PublishFn = (draft: DraftData) => Promise<{ success: boolean; message: string }>;

const platforms: Record<string, { dispatch: Record<string, PublishFn>; checkLogin: () => Promise<boolean>; label: string }> = {
  "抖音": { dispatch: douyinDispatch, checkLogin: douyinCheckLogin, label: "抖音创作者平台" },
  "B站":  { dispatch: biliDispatch,    checkLogin: biliCheckLogin,    label: "B站创作中心" },
  "小红书": { dispatch: xhsDispatch,    checkLogin: xhsCheckLogin,    label: "小红书创作者平台" },
};

const PUBLISH_TIMEOUT_MS = 480_000; // 8 minutes

function validateMaterials(draft: DraftData): string | null {
  const ids = [...(draft.images ?? []), draft.video, draft.cover, draft.header].filter(Boolean);
  if (ids.length === 0) return null;

  clearPathCache();
  try {
    const db = getDB();
    for (const id of ids) {
      const row = db.select().from(materials).where(eq(materials.id, id)).get() as any;
      if (!row) return `素材 "${id}" 未在素材库中找到，请重新上传`;
      if (!row.path || !existsSync(row.path)) return `素材 "${row.name || id}" 的文件已丢失，请重新上传`;
      cacheMaterialPath(id, row.path);
    }
  } catch (e: any) {
    return `素材校验失败：${e.message}`;
  }
  return null;
}

function ctLabel(ct: string): string {
  return ct === "image_text" ? "图文" : ct === "video" ? "视频" : ct === "article" ? "长文" : ct === "dynamic" ? "动态" : ct;
}

function validateTags(platform: string, ct: string, content: string, tags: string[]): string | null {
  // 抖音/小红书 图文+视频：标签在正文内 #tag 格式（SSOT: schemas/platform-schema.ts）
  if (usesInlineHashtags(platform, ct)) {
    if (!/#[一-鿿\w]+/.test(content)) {
      return `${platform}${ctLabel(ct)}需要在正文中添加标签（格式：#标签 用空格分隔，如 #美食 #旅行）`;
    }
    return null;
  }
  // 标签独立字段的平台/类型 — 由 PLATFORM_SCHEMA.maxTags 决定上限
  const limits = getLimits(platform, ct);
  if (limits?.maxTags !== undefined) {
    if (!tags || tags.length === 0) {
      return `${platform}${ctLabel(ct)}需要填写标签（≤${limits.maxTags}个）`;
    }
    if (tags.length > limits.maxTags) {
      return `${platform}${ctLabel(ct)}标签超过限制（${tags.length}/${limits.maxTags}）`;
    }
  }
  return null;
}

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

  const tagErr = validateTags(platform, content_type, draft.content ?? '', draft.tags ?? []);
  if (tagErr) return { success: false, message: tagErr, stage: "validate_tags" };

  const matErr = validateMaterials(draft);
  if (matErr) return { success: false, message: matErr, stage: "validate_materials" };

  const loggedIn = await p.checkLogin();
  if (!loggedIn) return { success: false, message: `未登录${platform}，请在 Edge 浏览器中打开${p.label}手动登录后重试`, stage: "login_check" };

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(async () => {
        await releasePage(platform).catch(() => {});
        reject(new Error("发布超时"));
      }, PUBLISH_TIMEOUT_MS)
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
