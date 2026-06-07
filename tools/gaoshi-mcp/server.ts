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

// ── Drafts (unified — uses storage/db.ts + storage/schema.ts) ──

server.registerTool("draft_save", {
  title: "保存草稿",
  description: "将内容保存为草稿。id 留空则新建。保存后前端草稿箱自动可见。\n\n⚠ 按 content_type 区分附件：\n- image_text（图文）：图片通过 images 数组传 material ID\n- video（视频）：视频通过 video 字段传 material ID\n- article（长文）：图片内联在 content 正文 (Markdown ![描述](url))，无 images 字段。有 cover/header",
  inputSchema: {
    id: z.string().optional(),
    title: z.string().optional(),
    content: z.string(),
    tags: z.array(z.string()).optional().default([]),
    platform: z.string().optional().default("小红书"),
    content_type: z.enum(["article", "image_text", "video"]).optional().default("article"),
    images: z.array(z.string()).optional().default([]),
    video: z.string().optional().default(""),
    cover: z.string().optional().default(""),
    header: z.string().optional().default(""),
    abstract: z.string().max(30).optional().default(""),
  },
}, async (args) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const id = args.id || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title = args.title
      || (args.content || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 30).trim()
      || "未命名草稿";

    const ct = args.content_type ?? "article";
    const imgArr = ct === "image_text" ? (args.images ?? []) : [];
    const vid = ct === "video" ? (args.video ?? "") : "";
    const hdr = ct === "article" ? (args.header ?? "") : "";

    const existing = db.select().from(drafts).where(eq(drafts.id, id)).get();
    if (existing) {
      db.update(drafts).set({
        title: args.title ?? existing.title,
        content: args.content,
        tags: JSON.stringify(args.tags ?? []),
        platform: args.platform ?? existing.platform,
        contentType: ct,
        images: JSON.stringify(imgArr),
        video: vid,
        cover: args.cover ?? "",
        header: hdr,
        abstract: args.abstract ?? "",
        updatedAt: now,
      }).where(eq(drafts.id, id)).run();
    } else {
      db.insert(drafts).values({
        id, title, content: args.content,
        tags: JSON.stringify(args.tags ?? []),
        platform: args.platform ?? "小红书",
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
  description: "更新素材的名称、标签或描述。用于给素材库中的文件添加/修改标签。id 必须使用 material_list 返回的完整 id（含目录前缀，如 images/xxx.png、videos/xxx.mp4），不能只用文件名。",
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

const DATA_DIR = path.resolve(path.join(process.cwd(), "data"));
const MEDIA_DIRS = ["images", "videos", "audio", "voices", "documents", "docs", "templates"];

function safePath(subpath: string): string {
  const full = path.resolve(DATA_DIR, subpath);
  if (!full.startsWith(DATA_DIR)) throw new Error("路径越界");
  return full;
}

function scanMediaFiles(category?: string): Array<{ id: string; name: string; path: string; category: string; size: number; createdAt: string }> {
  const results: Array<{ id: string; name: string; path: string; category: string; size: number; createdAt: string }> = [];
  const extCategory: Record<string, string> = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video",
    ".mp3": "audio", ".wav": "audio", ".opus": "audio", ".ogg": "audio", ".m4a": "audio", ".aac": "audio",
    ".webm": "voice",
    ".pdf": "document", ".docx": "document", ".doc": "document", ".txt": "document", ".md": "document", ".html": "document",
  };

  for (const dir of MEDIA_DIRS) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (!fs.statSync(full).isFile()) continue;
      const ext = path.extname(entry).toLowerCase();
      const cat = extCategory[ext] ?? "document";
      if (category && cat !== category) continue;
      const stat = fs.statSync(full);
      results.push({
        id: path.relative(DATA_DIR, full).replace(/\\/g, "/"),
        name: entry,
        path: full,
        category: cat,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      });
    }
  }
  return results;
}

server.registerTool("material_list", {
  title: "素材列表",
  description: "浏览素材库。直接扫描 data/images/、data/videos/、data/audio/、data/documents/ 目录，无需手动上传。可按 category 筛选（image/video/audio/document）。",
  inputSchema: {
    category: z.string().optional(),
    limit: z.number().optional().default(50),
  },
}, async (args) => {
  try {
    const files = scanMediaFiles(args.category);
    return okList(files.slice(0, args.limit ?? 50));
  } catch (e: any) { return err(e.message); }
});

server.registerTool("material_get", {
  title: "获取素材",
  description: "查看素材详情，返回文件路径等。id 为 data/ 下的相对路径如 music/xxx.mp3。",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const full = safePath(args.id);
    if (!fs.existsSync(full)) return err("素材不存在");
    const stat = fs.statSync(full);
    const ext = path.extname(args.id).toLowerCase();
    const catMap: Record<string, string> = { ".mp3": "audio", ".wav": "audio", ".opus": "audio", ".png": "image", ".jpg": "image", ".mp4": "video" };
    return ok({
      id: args.id, name: path.basename(args.id), path: full,
      category: catMap[ext] ?? "document",
      size: stat.size, createdAt: stat.birthtime.toISOString(),
    });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("material_delete", {
  title: "删除素材",
  description: "删除素材（同时删除磁盘文件和数据库记录，前端同步更新）。",
  inputSchema: { id: z.string() },
}, async (args) => {
  try {
    const full = safePath(args.id);
    // Delete from DB first
    getDB().delete(materials).where(eq(materials.id, args.id)).run();
    // Delete file from disk
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return ok({ deleted: true, id: args.id });
  } catch (e: any) { return err(e.message); }
});

const extToCategory: Record<string, string> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video",
  ".mp3": "audio", ".wav": "audio", ".opus": "audio", ".ogg": "audio", ".m4a": "audio",
  ".webm": "voice",
  ".pdf": "document", ".docx": "document", ".doc": "document", ".txt": "document", ".md": "document", ".html": "document",
};

const categoryDir: Record<string, string> = {
  image: "images", video: "videos", audio: "audio", voice: "voices", document: "documents", templates: "templates",
};

server.registerTool("material_save", {
  title: "保存素材",
  description: "将文件存入素材库。传 sourcePath（源文件绝对路径）和可选 category、model（AI 生成时填模型名）。自动检测类型、复制到素材目录。用于保存生成的音乐/图片/TTS 等文件。",
  inputSchema: {
    sourcePath: z.string(),
    category: z.string().optional(),
    model: z.string().optional(),
  },
}, async (args) => {
  try {
    const src = args.sourcePath;
    if (!fs.existsSync(src)) return err(`源文件不存在: ${src}`);

    const ext = path.extname(src).toLowerCase();
    const cat = args.category || extToCategory[ext] || "document";
    const dirName = categoryDir[cat] || "documents";
    const destDir = path.join(DATA_DIR, dirName);
    fs.mkdirSync(destDir, { recursive: true });

    let id = `${dirName}/${path.basename(src)}`;
    let dest = path.join(DATA_DIR, id);
    if (fs.existsSync(dest)) {
      const suffix = crypto.randomBytes(4).toString("hex");
      const ext = path.extname(src);
      const base = path.basename(src, ext);
      id = `${dirName}/${base}_${suffix}${ext}`;
      dest = path.join(DATA_DIR, id);
    }
    fs.copyFileSync(src, dest);

    const stat = fs.statSync(dest);

    // Also insert into materials DB table so frontend can see it
    let description = "";
    let tags = "[]";
    try {
      const db = getDB();
      const extToMime: Record<string, string> = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
        ".mp4": "video/mp4", ".mov": "video/quicktime",
      };

      // Auto-analyze images
      if (cat === "image") {
        try {
          const { getModel } = await import("../../agent/providers/router.ts");
          const { generateText } = await import("ai");
          const buffer = fs.readFileSync(dest);
          const mime = extToMime[ext] || "image/png";
          const { text } = await generateText({
            model: getModel("vision"),
            temperature: 0.3,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: '分析这张图片，返回 JSON：{"tags": [...], "description": "..."}。tags：3-8 个中文标签（每个不超 6 字）。description：一句话描述。只返回 JSON。' },
                { type: "image", image: buffer.toString("base64"), mimeType: mime },
              ],
            }],
          });
          const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
          const parsed = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
          if (Array.isArray(parsed.tags)) tags = JSON.stringify(parsed.tags.filter((t: unknown) => typeof t === "string" && t.length <= 6).slice(0, 8));
          if (typeof parsed.description === "string") description = parsed.description.slice(0, 100);
          console.error(`[material_save] auto-tagged: ${id}`);
        } catch (analyzeErr: any) {
          console.error(`[material_save] auto-tag failed for ${id}: ${analyzeErr.message}`);
        }
      }

      db.insert(materials).values({
        id,
        name: path.basename(src),
        path: dest,
        category: cat,
        mimeType: extToMime[ext] || "",
        size: stat.size,
        tags,
        description,
        generatedBy: args.model || "",
        useCount: 0,
        createdAt: new Date().toISOString(),
      }).run();
    } catch (dbErr: any) {
      // Clean up copied file on DB failure
      try { fs.unlinkSync(dest); } catch {}
      return err(`素材保存失败: ${dbErr.message}`);
    }

    return ok({ id, name: path.basename(src), path: dest, category: cat, size: stat.size });
  } catch (e: any) { return err(e.message); }
});

// ── Files ──

server.registerTool("file_read", {
  title: "读取文件",
  description: "读取 data/ 目录内的文件。",
  inputSchema: {
    path: z.string(),
    encoding: z.string().optional().default("utf-8"),
  },
}, async (args) => {
  try { return ok(tools.readFile(args.path, args.encoding)); }
  catch (e: any) { return err(e.message); }
});

server.registerTool("file_list", {
  title: "文件列表",
  description: "列出 data/ 目录的文件。",
  inputSchema: {
    dir: z.string().optional().default(""),
  },
}, async (args) => {
  try { return ok({ files: tools.listFiles(args.dir) }); }
  catch (e: any) { return err(e.message); }
});

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
    // Insert into materials DB so rendered images can be tagged via material_update
    try {
      const db = getDB();
      const id = `images/${path.basename(result.path)}`;
      const stat = fs.statSync(result.path);
      db.insert(materials).values({
        id,
        name: path.basename(result.path),
        path: result.path,
        category: "image",
        mimeType: "image/png",
        size: stat.size,
        width: result.width,
        height: result.height,
        tags: "[]",
        description: "",
        generatedBy: "render_card",
        useCount: 0,
        createdAt: new Date().toISOString(),
      }).run();
    } catch {}
    return ok(result);
  } catch (e: any) { return err(e.message); }
});

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gaoshi-mcp] ready");
}

main().catch((err) => { console.error("[gaoshi-mcp] fatal:", err); process.exit(1); });
