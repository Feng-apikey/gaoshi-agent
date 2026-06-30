import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDB } from "../../storage/db.ts";
import { drafts, materials } from "../../storage/schema.ts";
import { eq, desc } from "drizzle-orm";
import * as tools from "./tools.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { extToCategory, extToMime, CATEGORY_TO_DIR } from "../../storage/media-types.ts";
import { syncAndList, getDataDir, invalidateSyncCache } from "../../storage/materials-sync.ts";
import { usesInlineHashtags } from "../../schemas/platform-schema.ts";

const server = new McpServer({ name: "gaoshi-mcp", version: "0.2.0" });

function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function okList(data: unknown[]) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

/**
 * Append tags as inline `#标签` lines to content body. Only applied for
 * platform/content-type combos that use inline hashtags (抖音/小红书 image_text
 * or video). 抖音长文 has its own topic field (see publish/douyin.ts:260)
 * and must NOT receive inline hashtags.
 *
 * Pure function — exported for testability.
 */
export function appendHashtagsToContent(
  content: string,
  tags: string[],
  platform: string,
  contentType: string,
): string {
  const tagList = tags.filter(Boolean);
  // Uses platform-schema SSOT — see schemas/platform-schema.ts:INLINE_HASHTAG_RULES
  if (!usesInlineHashtags(platform, contentType)) {
    return content;
  }
  const lines = content.split('\n');
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx--;
  if (lastIdx >= 0 && /^\s*(#[一-鿿\w]+(\s+#[一-鿿\w]+)*)\s*$/.test(lines[lastIdx])) {
    lines.splice(lastIdx, 1);
  }
  let result = lines.join('\n').trimEnd();
  if (tagList.length > 0) {
    result = result + '\n\n' + tagList.map(t => t.startsWith('#') ? t : '#' + t).join(' ');
  }
  return result;
}

// ── Drafts (unified — uses storage/db.ts + storage/schema.ts) ──

server.registerTool("draft_save", {
  title: "保存草稿",
  description: "将内容保存为草稿。id 留空则新建。保存后前端草稿箱自动可见。\n\n⚠ 按 content_type 区分附件,附件字段(images/video/cover/header)必须是 material_list 返回的 16 字符 hex id(不可读,原文传入,不要拼路径、不要修改)。保存时校验 id 必须存在于素材库,缺则拒绝(防止 LLM 抄错 hex 导致 publish 时找不到素材)。\n- image_text(图文):图片通过 images 数组传 material ID\n- video(视频):视频通过 video 字段传 material ID\n- article(长文):图片内联在 content 正文 (Markdown ![描述](url)),无 images 字段。有 cover/header\n\n⚠ 更新时只修改传入的字段,未传入的字段保持不变。",
  inputSchema: {
    id: z.string().optional(),
    title: z.string().optional(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    platform: z.string().optional(),
    content_type: z.enum(["article", "image_text", "video", "dynamic"]).optional(),
    images: z.array(z.string()).optional(),
    video: z.string().optional(),
    cover: z.string().optional(),
    header: z.string().optional(),
    abstract: z.string().max(30).optional(),
  },
}, async (args) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const existing = db.select().from(drafts).where(eq(drafts.id, (args.id ?? ""))).get();

    const id = args.id || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ct = args.content_type ?? existing?.contentType ?? "article";
    const p = args.platform ?? existing?.platform ?? "小红书";

    // Title: provided > first line of content > existing > "未命名草稿"
    const title = args.title
      || (args.content || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 30).trim()
      || existing?.title
      || "未命名草稿";

    // Tag handling: only manipulate hashtags when tags was explicitly provided
    const content = args.tags !== undefined
      ? appendHashtagsToContent(args.content, args.tags, p, ct)
      : args.content;

    // 素材 id 校验 — 只校验本调实际传入的字段(partial update 友好)
    const idErrors: string[] = [];
    if (args.images !== undefined) {
      for (const mid of args.images) {
        if (!mid) continue;
        const row = db.select().from(materials).where(eq(materials.id, mid)).get();
        if (!row) idErrors.push(`images 中的素材 id "${mid}" 不存在,请用 material_list 重新查询`);
      }
    }
    if (args.video !== undefined && args.video) {
      const row = db.select().from(materials).where(eq(materials.id, args.video)).get();
      if (!row) idErrors.push(`video 字段的素材 id "${args.video}" 不存在,请用 material_list 重新查询`);
    }
    if (args.cover !== undefined && args.cover) {
      const row = db.select().from(materials).where(eq(materials.id, args.cover)).get();
      if (!row) idErrors.push(`cover 字段的素材 id "${args.cover}" 不存在,请用 material_list 重新查询`);
    }
    if (args.header !== undefined && args.header) {
      const row = db.select().from(materials).where(eq(materials.id, args.header)).get();
      if (!row) idErrors.push(`header 字段的素材 id "${args.header}" 不存在,请用 material_list 重新查询`);
    }
    if (idErrors.length > 0) {
      return err(JSON.stringify({ error: "素材 id 校验失败", errors: idErrors }));
    }

    // Schema validation — each field checked independently so partial
    // updates (only title changed, etc.) only flag what was actually sent.
    const { validateDraftFields } = await import("../../publish/draft-validator.ts");
    const validationErrors = validateDraftFields({
      platform: p,
      contentType: ct,
      title: args.title,           // undefined if not provided
      content: args.content,       // undefined if partial-update didn't touch content
      tags: args.tags,
      abstract: args.abstract,
      images: args.images,         // material ID array, undefined for non-image_text
    });
    if (validationErrors.length > 0) {
      return err(JSON.stringify({
        error: "草稿校验失败",
        errors: validationErrors,
      }));
    }

    if (existing) {
      // Partial update: only modify fields explicitly provided by caller
      const updates: Record<string, any> = { updatedAt: now };
      if (args.title !== undefined) updates.title = args.title;
      updates.content = content;
      updates.contentType = ct;
      if (args.tags !== undefined) updates.tags = JSON.stringify(args.tags);
      if (args.platform !== undefined) updates.platform = args.platform;
      if (args.images !== undefined) updates.images = JSON.stringify(ct === "image_text" ? args.images : []);
      if (args.video !== undefined) updates.video = ct === "video" ? args.video : "";
      if (args.cover !== undefined) updates.cover = args.cover;
      if (args.header !== undefined) updates.header = ct === "article" ? args.header : "";
      if (args.abstract !== undefined) updates.abstract = args.abstract;
      db.update(drafts).set(updates).where(eq(drafts.id, id)).run();
    } else {
      // Insert: fill defaults for missing fields
      const imgArr = ct === "image_text" ? (args.images ?? []) : [];
      const vid = ct === "video" ? (args.video ?? "") : "";
      const hdr = ct === "article" ? (args.header ?? "") : "";
      db.insert(drafts).values({
        id, title, content,
        tags: JSON.stringify(args.tags ?? []),
        platform: p,
        contentType: ct,
        images: JSON.stringify(imgArr),
        video: vid,
        cover: args.cover ?? "",
        header: hdr,
        abstract: args.abstract ?? "",
        status: "draft", createdAt: now, updatedAt: now,
      }).run();
    }
    return ok({ id, saved: true });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("draft_get", {
  title: "获取草稿",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const db = getDB();
    const row: any = db.select().from(drafts).where(eq(drafts.id, args.id)).get();
    if (!row) return err("草稿不存在");
    return ok({
      id: row.id, title: row.title, content: row.content,
      tags: JSON.parse(row.tags ?? "[]"),
      platform: row.platform,
      contentType: row.contentType ?? row.content_type ?? "article",
      images: JSON.parse(row.images ?? "[]"),
      video: row.video ?? "",
      cover: row.cover ?? "",
      header: row.header ?? "",
      abstract: row.abstract ?? "",
      status: row.status,
      createdAt: row.createdAt ?? (row as any).created_at,
      updatedAt: row.updatedAt ?? (row as any).updated_at,
    });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("draft_list", {
  title: "草稿列表",
  description: "列出草稿，按更新时间倒序。可按平台筛选。",
  inputSchema: {
    platform: z.string().optional(),
    limit: z.number().optional().default(20),
  },
}, async (args) => {
  try {
    const db = getDB();
    const rows: any[] = args.platform
      ? db.select().from(drafts).where(eq(drafts.platform, args.platform)).orderBy(desc(drafts.updatedAt)).limit(args.limit ?? 20).all()
      : db.select().from(drafts).orderBy(desc(drafts.updatedAt)).limit(args.limit ?? 20).all();
    return okList(rows.map((r: any) => ({
      id: r.id, title: r.title, content: r.content.slice(0, 200),
      tags: JSON.parse(r.tags ?? "[]"),
      platform: r.platform,
      contentType: r.contentType ?? r.content_type ?? "article",
      images: JSON.parse(r.images ?? "[]"),
      video: r.video ?? "",
      cover: r.cover ?? "",
      header: r.header ?? "",
      abstract: r.abstract ?? "",
      status: r.status,
      updatedAt: r.updatedAt ?? (r as any).updated_at,
    })));
  } catch (e: any) { return err(e.message); }
});

server.registerTool("draft_delete", {
  title: "删除草稿",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const db = getDB();
    const row = db.select().from(drafts).where(eq(drafts.id, args.id)).get();
    if (!row) return err("草稿不存在");
    db.delete(drafts).where(eq(drafts.id, args.id)).run();
    return ok({ deleted: true, id: args.id });
  } catch (e: any) { return err(e.message); }
});

// ── Materials ──

server.registerTool("material_update", {
  title: "更新素材信息",
  description: "更新素材的名称、标签或描述。用于给素材库中的文件添加/修改标签。id 必须是 material_list 返回的 16 字符 hex id（如 a8dbcb85ddd3c344），不能拼路径、不能改写。",
  inputSchema: {
    id: z.string(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
  },
}, async (args) => {
  try {
    const db = getDB();
    const row = db.select().from(materials).where(eq(materials.id, args.id)).get();
    if (!row) return err(`素材不存在: ${args.id}`);

    const updates: Record<string, any> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.tags !== undefined) updates.tags = JSON.stringify(args.tags);
    if (args.description !== undefined) updates.description = args.description;
    if (Object.keys(updates).length === 0) return err("没有要更新的字段");

    db.update(materials).set(updates).where(eq(materials.id, args.id)).run();
    const updated: any = db.select().from(materials).where(eq(materials.id, args.id)).get();
    return ok({
      id: updated.id, name: updated.name, tags: JSON.parse(updated.tags ?? "[]"),
      description: updated.description, category: updated.category,
    });
  } catch (e: any) { return err(e.message); }
});

// ── Materials (filesystem-synced — no separate upload step) ──

const DATA_DIR = getDataDir();
const MAX_MATERIAL_SIZE = 500 * 1024 * 1024; // 500MB — larger files go directly into data/ dir

function safePath(subpath: string): string {
  const full = path.resolve(DATA_DIR, subpath);
  if (!full.startsWith(DATA_DIR)) throw new Error("路径越界");
  return full;
}

server.registerTool("material_list", {
  title: "素材列表",
  description: "浏览素材库。从 DB 读取，自动 sync data/ 下的新文件入库（带 content hash,rename 不改 id）。返回的 id 是 16 字符 hex 字符串（不可读），引用素材时必须用此 id 原文传给 draft_save / material_get / material_update / material_delete，不要拼路径、不要修改。id 之外还会返回 name 字段供跟用户对话时说明。可按 category 筛选（image/video/audio/document）。",
  inputSchema: {
    category: z.string().optional(),
    limit: z.number().optional().default(50),
  },
}, async (args) => {
  try {
    // syncAndList 返回 DB 行,id 已经是 hex 形式
    const rows = syncAndList();
    const filtered = args.category ? rows.filter((r: any) => r.category === args.category) : rows;
    const sliced = filtered.slice(0, args.limit ?? 50);
    return okList(sliced);
  } catch (e: any) { return err(e.message); }
});

server.registerTool("material_get", {
  title: "获取素材",
  description: "查看素材详情。id 必须是 material_list 返回的 16 字符 hex id。",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const row = getDB().select().from(materials).where(eq(materials.id, args.id)).get() as any;
    if (!row) return err(`素材不存在: ${args.id}。请用 material_list 重新查询获取正确 id`);
    return ok({
      id: row.id, name: row.name, path: row.path,
      category: row.category, size: row.size,
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.createdAt,
    });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("material_delete", {
  title: "删除素材",
  description: "删除素材（同时删除磁盘文件和数据库记录,前端同步更新,自动清理草稿引用）。id 必须是 material_list 返回的 16 字符 hex id。",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const db = getDB();
    const row = db.select().from(materials).where(eq(materials.id, args.id)).get() as any;
    if (!row) return err(`素材不存在: ${args.id}`);
    // Delete file from disk
    if (fs.existsSync(row.path)) fs.unlinkSync(row.path);
    // Delete from DB
    db.delete(materials).where(eq(materials.id, args.id)).run();
    return ok({ deleted: true, id: args.id });
  } catch (e: any) { return err(e.message); }
});

// extToCategory & CATEGORY_TO_DIR imported from storage/media-types.ts (single source of truth)

server.registerTool("material_save", {
  title: "保存素材",
  description: "将文件存入素材库。传 sourcePath（源文件绝对路径）和可选 category、model（AI 生成时填模型名）、tags（每个不超 6 字，可选,默认空数组）。自动检测类型,生成不可读的 hex id(16 字符),复制到 data/ 对应目录,文件名跟 id 绑定。返回的 id 不可读不要修改,引用素材时必须用此 id 原文。用于保存生成的音乐/图片/TTS 等文件。",
  inputSchema: {
    sourcePath: z.string(),
    category: z.string().optional(),
    model: z.string().optional(),
    tags: z.array(z.string().max(6, "标签不超过 6 字")).max(8, "最多 8 个标签").optional(),
  },
}, async (args) => {
  try {
    const src = args.sourcePath;
    if (!fs.existsSync(src)) return err(`源文件不存在: ${src}`);

    const srcStat = fs.statSync(src);
    if (srcStat.size > MAX_MATERIAL_SIZE) return err(`文件过大（${(srcStat.size / 1024 / 1024).toFixed(0)}MB），最大 ${MAX_MATERIAL_SIZE / 1024 / 1024}MB。大文件请直接放入 data/ 目录`);

    const ext = path.extname(src).toLowerCase();
    const cat = args.category || extToCategory(ext) || "document";
    const dirName = CATEGORY_TO_DIR[cat] || "documents";
    const destDir = path.join(DATA_DIR, dirName);
    fs.mkdirSync(destDir, { recursive: true });

    // SSOT: id = randomBytes(8).hex,文件名跟 id 绑定。SSOT 跟 syncAndList / generate_image 一致。
    const id = crypto.randomBytes(8).toString("hex");
    const dest = path.join(destDir, `${id}${ext}`);
    fs.copyFileSync(src, dest);

    const stat = fs.statSync(dest);
    // SSOT: name 默认 = `${id}${ext}`, 跟磁盘 basename 一致.
    // 用户改素材名走 material_update(name=...), 不动磁盘.
    const name = `${id}${ext}`;

    // Compute content hash for rename stability (same logic as syncAndList)
    const cryptoMod = await import("node:crypto");
    let contentHash = "";
    if (stat.size <= 50 * 1024 * 1024) {
      try { contentHash = cryptoMod.createHash("sha256").update(fs.readFileSync(dest)).digest("hex"); } catch {}
    }

    // Also insert into materials DB table so frontend can see it
    try {
      const db = getDB();
      db.insert(materials).values({
        id,
        name,
        path: dest,
        category: cat,
        mimeType: extToMime(ext),
        size: stat.size,
        tags: JSON.stringify(args.tags ?? []),
        description: "",
        generatedBy: args.model || "",
        useCount: 0,
        contentHash,
        createdAt: new Date().toISOString(),
      }).run();
      // 触发 MCP material_list 缓存失效,保证下一次 list 看到这条
      invalidateSyncCache();
    } catch (dbErr: any) {
      // Clean up copied file on DB failure
      try { fs.unlinkSync(dest); } catch {}
      return err(`素材保存失败: ${dbErr.message}`);
    }

    return ok({ id, name, path: dest, category: cat, size: stat.size });
  } catch (e: any) { return err(e.message); }
});

// ── Files ──

// ── System ──

server.registerTool("system_status", {
  title: "系统状态",
  description: "获取草稿数量、内存占用等系统信息。",
  inputSchema: {},
}, async () => {
  try { return ok(tools.systemStatus()); }
  catch (e: any) { return err(e.message); }
});

// ── Render ──

server.registerTool("render_card", {
  title: "渲染卡片",
  description: "将 HTML 渲染为 PNG 图片。用于生成封面图、信息图等。",
  inputSchema: {
    html: z.string(),
    width: z.number().optional().default(800),
    height: z.number().optional().default(600),
  },
}, async (args) => {
  try {
    const result = await tools.renderCard(args.html, args.width, args.height);
    // SSOT: id = randomBytes(8).hex,文件名跟 id 绑定。跟 syncAndList / generate_image / material_save 一致。
    try {
      const db = getDB();
      const id = crypto.randomBytes(8).toString("hex");
      const newPath = path.join(path.dirname(result.path), `${id}.png`);
      fs.renameSync(result.path, newPath);
      const stat = fs.statSync(newPath);
      // content hash for rename stability
      const cryptoMod = await import("node:crypto");
      let contentHash = "";
      try { contentHash = cryptoMod.createHash("sha256").update(fs.readFileSync(newPath)).digest("hex"); } catch {}
      db.insert(materials).values({
        id,
        name: `${id}.png`,
        path: newPath,
        category: "image",
        mimeType: "image/png",
        size: stat.size,
        width: result.width,
        height: result.height,
        tags: "[]",
        description: "",
        generatedBy: "render_card",
        useCount: 0,
        contentHash,
        createdAt: new Date().toISOString(),
      }).run();
      invalidateSyncCache();
      return ok({ id, name: `${id}.png`, path: newPath, width: result.width, height: result.height });
    } catch (dbErr: any) {
      return err(`render_card 入库失败: ${dbErr.message}`);
    }
  } catch (e: any) { return err(e.message); }
});

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gaoshi-mcp] ready");
}

// Only auto-start when run directly (not imported by tests)
const isDirectRun = process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js");
if (isDirectRun) {
  main().catch((err) => { console.error("[gaoshi-mcp] fatal:", err); process.exit(1); });
}
