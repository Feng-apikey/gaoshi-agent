import { Hono } from "hono";
import { getDB } from "../../storage/db.ts";
import { materials, drafts } from "../../storage/schema.ts";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { extToCategory, extToMime, MEDIA_DIRS } from "../../storage/media-types.ts";

export function transformMaterial(row: any) {
  return {
    ...row,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
  };
}

export const materialsRouter = new Hono();

const DATA_DIR = path.resolve(path.join(process.cwd(), "data"));

// Merge filesystem files into DB — returns all materials
let _syncCache: { time: number; data: any[]; mtimeCache: Map<string, number> } | null = null;

// Skip hashing files larger than this to avoid loading 100MB+ into memory.
// Files above this size fall back to path-only matching (still work, just no rename detection).
const MAX_HASH_SIZE = 50 * 1024 * 1024; // 50MB

function syncAndList() {
  if (_syncCache && Date.now() - _syncCache.time < 5 * 60 * 1000) {
    return _syncCache.data;
  }

  const db = getDB();
  const existing = new Map<string, any>();
  const existingPaths = new Set<string>();
  for (const row of db.select().from(materials).all()) {
    existing.set(row.id as string, row);
    existingPaths.add((row.path as string).replace(/\\/g, "/"));
  }

  // Build hash index for "old friend, new path" detection (rename/move)
  const existingHashes = new Map<string, any>();
  for (const row of existing.values()) {
    if (row.contentHash) existingHashes.set(row.contentHash as string, row);
  }

  // mtime cache from previous sync — skip hashing files whose mtime is unchanged
  const prevMtime = _syncCache?.mtimeCache;
  const mtimeCache = new Map<string, number>();
  // When we skip a hash because of mtime cache, we still need the hash for index lookups,
  // so we also carry forward the last-known hash for unchanged files.
  const prevHashByPath = (_syncCache as any)?.hashByPath as Map<string, string> | undefined;
  const hashByPath = new Map<string, string>();

  // Scan data/ for files not yet in DB
  for (const dir of MEDIA_DIRS) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (!fs.statSync(full).isFile()) continue;
      const normalizedPath = full.replace(/\\/g, "/");
      if (existingPaths.has(normalizedPath)) continue;

      const ext = path.extname(entry).toLowerCase();
      const category = extToCategory(ext) ?? "document";
      const stat = fs.statSync(full);
      mtimeCache.set(normalizedPath, stat.mtimeMs);

      // Hash this file (skip if mtime unchanged AND we have a prior hash for it)
      let hash = "";
      if (stat.size <= MAX_HASH_SIZE) {
        if (prevMtime?.get(normalizedPath) === stat.mtimeMs && prevHashByPath?.get(normalizedPath)) {
          hash = prevHashByPath.get(normalizedPath)!;
        } else {
          try {
            hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
          } catch {}
        }
      }
      if (hash) hashByPath.set(normalizedPath, hash);

      // Old friend, new path: hash matches an existing row → just update path
      if (hash && existingHashes.has(hash)) {
        const oldRow = existingHashes.get(hash)!;
        if ((oldRow.path as string).replace(/\\/g, "/") !== normalizedPath) {
          db.update(materials)
            .set({ path: full, name: entry })
            .where(eq(materials.id, oldRow.id))
            .run();
          console.log(`[materials] hash-matched rename: ${oldRow.id} ${oldRow.path} -> ${full}`);
          // Refresh in-memory state so orphan cleanup doesn't kill it
          existing.set(oldRow.id, { ...oldRow, path: full, name: entry });
          existingPaths.add(normalizedPath);
          existingPaths.delete((oldRow.path as string).replace(/\\/g, "/"));
        }
        continue;
      }

      // Brand new file: assign a stable hex id (NOT derived from filename, so rename doesn't change id)
      const id = randomBytes(8).toString("hex");
      try {
        db.insert(materials).values({
          id,
          name: entry,
          path: full,
          category,
          mimeType: extToMime(ext),
          size: stat.size,
          tags: "[]",
          description: "",
          generatedBy: "",
          useCount: 0,
          contentHash: hash,
          createdAt: stat.birthtime.toISOString(),
        }).run();
        existing.set(id, { id, path: full, contentHash: hash, name: entry });
        existingPaths.add(normalizedPath);
        if (hash) existingHashes.set(hash, { id, path: full, contentHash: hash });
        console.log("[materials] synced:", id);
      } catch (err: any) {
        if (!err.message?.includes("UNIQUE constraint")) {
          console.error("[materials] sync failed:", id, err.message);
        }
      }
    }
  }

  // Clean up orphaned DB records where file no longer exists on disk
  for (const [id, row] of existing) {
    if (!fs.existsSync((row as any).path)) {
      try {
        db.delete(materials).where(eq(materials.id, id)).run();
        console.log("[materials] cleaned orphan:", id);
      } catch {}
    }
  }

  const data = db.select().from(materials).all();
  _syncCache = { time: Date.now(), data, mtimeCache };
  // Stash hashByPath on the cache (sneaky, but avoids widening the type for one internal use)
  (_syncCache as any).hashByPath = hashByPath;
  return data;
}

// GET /api/materials — list all
materialsRouter.get("/", (c) => {
  return c.json(syncAndList().map(transformMaterial));
});

// GET /api/materials/:id — get one
materialsRouter.get("/:id{.+}", (c) => {
  const db = getDB();
  const row = db.select().from(materials).where(eq(materials.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(transformMaterial(row));
});

// PATCH /api/materials/:id — rename or update tags
materialsRouter.patch("/:id{.+}", async (c) => {
  _syncCache = null;
  const db = getDB();
  const id = c.req.param("id");
  const row = db.select().from(materials).where(eq(materials.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{ name?: string; tags?: string[] }>();
  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const ext = path.extname(row.path);
    const dir = path.dirname(row.path);
    const safeName = path.basename(body.name);
    const newName = safeName.includes(".") ? safeName : safeName + ext;
    updates.path = path.join(dir, newName);
    updates.name = newName;
  }
  if (body.tags !== undefined) {
    updates.tags = JSON.stringify(body.tags);
  }

  if (Object.keys(updates).length === 0) return c.json(transformMaterial(row));

  const oldPath = row.path;
  db.update(materials).set(updates).where(eq(materials.id, id)).run();

  if (updates.path && updates.path !== oldPath) {
    try {
      fs.renameSync(oldPath, updates.path as string);
    } catch {
      db.update(materials).set({ path: oldPath, name: row.name }).where(eq(materials.id, id)).run();
      return c.json({ error: "file rename failed" }, 500);
    }
  }

  const updated = db.select().from(materials).where(eq(materials.id, id)).get();
  return c.json(transformMaterial(updated));
});

// DELETE /api/materials/:id
materialsRouter.delete("/:id{.+}", (c) => {
  _syncCache = null;
  const db = getDB();
  const id = c.req.param("id");
  const row = db.select().from(materials).where(eq(materials.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  // Delete file from disk
  try { fs.unlinkSync(row.path); } catch {}

  db.delete(materials).where(eq(materials.id, id)).run();

  // Cascade: clean up draft references to the deleted material
  const allDrafts = db.select().from(drafts).all() as any[];
  for (const d of allDrafts) {
    const images: string[] = JSON.parse(d.images ?? "[]");
    const filteredImages = images.filter((mid: string) => mid !== id);
    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    let changed = false;
    if (filteredImages.length !== images.length) { updates.images = JSON.stringify(filteredImages); changed = true; }
    if (d.video === id) { updates.video = ""; changed = true; }
    if (d.cover === id) { updates.cover = ""; changed = true; }
    if (d.header === id) { updates.header = ""; changed = true; }
    if (changed) {
      db.update(drafts).set(updates).where(eq(drafts.id, d.id)).run();
    }
  }

  return c.json({ deleted: true, id });
});

const IMAGE_ANALYSIS_PROMPT = `分析这张图片，返回 JSON：{"tags": [...]}

tags：3-8 个中文标签，每个不超过 6 个汉字，覆盖内容主题、视觉风格、适用场景。

只返回 JSON，不要其他内容。`;

const DOC_ANALYSIS_PROMPT = `分析以下文档，返回 JSON：{"tags": [...]}

tags：3-8 个中文标签，每个不超过 6 个汉字，覆盖文档主题、内容类型、适用场景。

只返回 JSON，不要其他内容。

文档内容：`;

// ── POST /api/materials/:id/analyze ──

materialsRouter.post("/:id{.+}/analyze", async (c) => {
  _syncCache = null;
  const db = getDB();
  const id = c.req.param("id");
  const row = db.select().from(materials).where(eq(materials.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  if (row.category !== "image" && row.category !== "document" && row.category !== "video") {
    return c.json({ error: "只有图片、文档、视频素材支持 AI 分析" }, 400);
  }

  try {
    const { getModel } = await import("../../agent/providers/router.ts");
    const { generateText } = await import("ai");

    let messages: any[] = [];  // default for type narrowing; all branches assign
    let modelType: any;        // narrowed at line 364 via getModel, kept as any to avoid union narrowing issues

    if (row.category === "image") {
      // Try vision model; fallback to filename-based text analysis
      try {
        getModel("vision");
        modelType = "vision";
        const buffer = fs.readFileSync(row.path);
        const ext = path.extname(row.path).toLowerCase();
        messages = [{
          role: "user",
          content: [
            { type: "text", text: IMAGE_ANALYSIS_PROMPT },
            { type: "image", image: buffer.toString("base64"), mimeType: extToMime(ext) },
          ],
        }];
      } catch {
        modelType = "text";
        const name = row.name ?? path.basename(row.path);
        messages = [{
          role: "user",
          content: `根据图片文件名推测内容，返回 JSON：{"tags": [...]}。tags 3-8 个中文标签不超 6 字。只返回 JSON。\n\n文件名：${name}`,
        }];
      }
    } else if (row.category === "video") {
      // Tiered fallback: video model → ffmpeg frames + vision → filename + text
      let videoAnalyzed = false;

      // 1. Try native video model
      try {
        getModel("video");
        modelType = "video";
        messages = [{
          role: "user",
          content: "分析这个视频的内容和风格。返回 JSON：{\"tags\": [...]}。tags 3-8 个中文标签不超 6 字。只返回 JSON。",
        }];
        videoAnalyzed = true;
      } catch {}

      // 2. Fallback: ffmpeg key frames → vision model
      if (!videoAnalyzed) {
        try {
          const { spawn } = await import("node:child_process");
          const os = await import("node:os");
          const crypto = await import("node:crypto");
          const tmpDir = path.join(os.tmpdir(), `gaoshi_frames_${crypto.randomUUID()}`);
          fs.mkdirSync(tmpDir, { recursive: true });

          const frames: Buffer[] = await new Promise((resolve, reject) => {
            const ff = spawn("ffmpeg", [
              "-i", row.path, "-vf", "fps=1/5", "-vframes", "6", "-f", "image2",
              path.join(tmpDir, "frame_%02d.jpg"),
            ], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
            ff.on("close", (code) => {
              const bufs: Buffer[] = [];
              try {
                for (const f of fs.readdirSync(tmpDir).sort()) bufs.push(fs.readFileSync(path.join(tmpDir, f)));
              } catch {}
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
              if (code === 0 && bufs.length > 0) resolve(bufs);
              else reject(new Error(`ffmpeg 退出码 ${code}，提取到 ${bufs.length} 帧`));
            });
            ff.on("error", (err) => {
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
              reject(new Error(`ffmpeg 未找到: ${err.message}`));
            });
          });

          if (frames.length > 0) {
            modelType = "vision";
            const imageParts = frames.map(f => ({ type: "image" as const, image: f.toString("base64"), mimeType: "image/jpeg" as const }));
            messages = [{
              role: "user",
              content: [
                { type: "text", text: "这是同一视频的连续关键帧。分析视频内容、风格和用途。返回 JSON：{\"tags\": [...]}。tags 3-8 个中文标签不超 6 字。只返回 JSON。" },
                ...imageParts,
              ],
            }];
            videoAnalyzed = true;
          }
        } catch {}
      }

      // 3. Last resort: filename + metadata → text model
      if (!videoAnalyzed) {
        modelType = "text";
        const name = row.name ?? path.basename(row.path);
        const sizeMB = Math.round((row.size ?? 0) / 1024 / 1024);
        messages = [{
          role: "user",
          content: `根据视频文件名推测内容，返回 JSON：{"tags": [...]}。tags 3-8 个中文标签不超 6 字。只返回 JSON。\n\n文件名：${name}\n大小：${sizeMB}MB`,
        }];
      }
    } else {
      modelType = "text";
      const raw = fs.readFileSync(row.path, "utf-8").slice(0, 8000);
      messages = [{ role: "user", content: DOC_ANALYSIS_PROMPT + raw }];
    }

    const { text } = await generateText({
      model: getModel(modelType),
      temperature: 0.3,
      messages,
    });

    let tags: string[] = [];

    // Strip markdown fences and extract the JSON object
    let cleaned = text.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "")
      .trim();

    // If the model wrapped JSON in any text, find the first { ... } block
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.tags)) {
        tags = parsed.tags.filter((t: unknown) => typeof t === "string" && t.length <= 6).slice(0, 8);
      }
    } catch {
      const tagMatch = text.match(/\[([^\]]+)\]/);
      if (tagMatch) {
        tags = tagMatch[1].split(",").map((s: string) => s.trim().replace(/[""]/g, "")).filter((s: string) => s.length <= 6).slice(0, 8);
      }
    }

    const setData: Record<string, any> = {};
    if (tags.length > 0) setData.tags = JSON.stringify(tags);

    if (Object.keys(setData).length > 0) {
      db.update(materials).set(setData).where(eq(materials.id, id)).run();
    }

    const updated = db.select().from(materials).where(eq(materials.id, id)).get();
    return c.json(transformMaterial(updated));
  } catch (err: any) {
    return c.json({ error: `analysis failed: ${err.message}` }, 500);
  }
});
