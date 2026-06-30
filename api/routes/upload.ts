import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import { getDB } from "../../storage/db.ts";
import { materials } from "../../storage/schema.ts";
import { extToCategory, extToMime, CATEGORY_TO_DIR } from "../../storage/media-types.ts";

export { extToCategory } from "../../storage/media-types.ts";

export const uploadRouter = new Hono();

const UPLOAD_DIR = path.join(process.cwd(), "data");
const MAX_SIZE = 100 * 1024 * 1024; // 100MB

// ── POST /api/upload — upload a file ──

uploadRouter.post("/", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "no file" }, 400);

  if (file.size > MAX_SIZE) {
    return c.json({ error: `文件过大，最大 ${MAX_SIZE / 1024 / 1024}MB` }, 400);
  }

  const ext = path.extname(file.name);
  const category = extToCategory(ext);
  if (!category) {
    return c.json({ error: `不支持的文件类型: ${ext}` }, 400);
  }

  const subDir = path.join(UPLOAD_DIR, CATEGORY_TO_DIR[category] || category + "s");
  fs.mkdirSync(subDir, { recursive: true });

  const id = crypto.randomBytes(8).toString("hex");
  const storedName = `${id}${ext}`;
  const filePath = path.join(subDir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  // content hash for sync rename/move detection (sha256 of full file)
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

  let imageWidth = 0;
  let imageHeight = 0;
  if (category === "image") {
    try {
      const dims = imageSize(buffer);
      imageWidth = dims.width ?? 0;
      imageHeight = dims.height ?? 0;
    } catch {}
  }

  const result: any = {
    id,
    // SSOT: name 默认 = `<id><ext>`, 跟磁盘 basename 一致.
    // 原文件名存到 description(可检索), 用户后续改素材名走 PATCH name.
    name: storedName,
    path: filePath,
    category,
    mimeType: file.type,
    size: file.size,
    width: imageWidth,
    height: imageHeight,
    createdAt: new Date().toISOString(),
  };

  // Auto-analysis removed — use POST /api/materials/:id/analyze to tag manually

  // ── Video: flag as analyzable ──
  if (category === "video") {
    result.videoAnalysisHint = "可调用 analyze_video 分析（优先 video 模型，无则 ffmpeg 抽帧降级）";
  }

  // ── Write to materials table ──
  try {
    const db = getDB();
    db.insert(materials).values({
      id,
      name: storedName,
      path: filePath,
      category,
      mimeType: file.type || "",
      size: file.size,
      width: imageWidth,
      height: imageHeight,
      tags: "[]",
      // 原始上传文件名存到 description, 便于"按文件名搜"
      description: file.name ?? "",
      generatedBy: "",
      useCount: 0,
      contentHash,
      createdAt: result.createdAt,
    }).run();
  } catch {
    // Clean up orphaned file if DB insert fails
    try { fs.unlinkSync(filePath); } catch {}
    return c.json({ error: "failed to save material record" }, 500);
  }

  return c.json(result);
});

// ── GET /api/upload — list uploads ──

uploadRouter.get("/", (c) => {
  const files: any[] = [];
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const entry of fs.readdirSync(UPLOAD_DIR)) {
        const stat = fs.statSync(path.join(UPLOAD_DIR, entry));
        files.push({ name: entry, size: stat.size, createdAt: stat.birthtime.toISOString() });
      }
    }
  } catch {}
  return c.json({ files });
});

// ── GET /api/upload/:id — serve uploaded file ──

uploadRouter.get("/:id{.*}", (c) => {
  const id = c.req.param("id");
  const db = getDB();
  const row = db.select().from(materials).where(eq(materials.id, id)).get();

  let filePath: string;
  if (row) {
    filePath = row.path;
  } else {
    // Fallback: try id as relative path under data/ (handles material_save files)
    const p = path.resolve(UPLOAD_DIR, id);
    if (!p.startsWith(path.resolve(UPLOAD_DIR))) return c.json({ error: "not found" }, 404);
    if (!fs.existsSync(p)) return c.json({ error: "not found" }, 404);
    filePath = p;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = extToMime(ext);

  // Force inline for text and PDF; HTML/SVG always attachment (prevents same-origin XSS)
  const inlineTypes = new Set(["text/plain", "application/pdf"]);
  const isInline = inlineTypes.has(mime.split(";")[0]);

  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = c.req.header("Range");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Number(parts[0]);
      const end = parts[1] ? Number(parts[1]) : NaN;

      if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
        return new Response("Range Not Satisfiable", { status: 416 });
      }

      const chunkEnd = Number.isFinite(end) && end >= start
        ? Math.min(end, fileSize - 1)
        : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = chunkEnd - start + 1;

      const buf = Buffer.alloc(chunkSize);
      let fd = -1;
      try {
        fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, chunkSize, start);
      } finally {
        if (fd !== -1) try { fs.closeSync(fd); } catch {}
      }

      try { db.update(materials).set({ useCount: (row?.useCount ?? 0) + 1 }).where(eq(materials.id, id)).run(); } catch {}
      const rangeHeaders: Record<string, string> = {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${chunkEnd}/${fileSize}`,
        "Content-Length": String(chunkSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "max-age=86400",
      };
      if (isInline) rangeHeaders["Content-Disposition"] = "inline";
      return new Response(buf, { status: 206, headers: rangeHeaders });
    }

    try { db.update(materials).set({ useCount: (row?.useCount ?? 0) + 1 }).where(eq(materials.id, id)).run(); } catch {}
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "max-age=86400",
    };
    if (isInline) headers["Content-Disposition"] = "inline";
    return new Response(Readable.toWeb(fs.createReadStream(filePath)) as any, { headers });
  } catch {
    return c.json({ error: "file not found on disk" }, 404);
  }
});
