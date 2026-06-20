import { Hono } from "hono";
import { getDB } from "../../storage/db.ts";
import { drafts, publishLog } from "../../storage/schema.ts";
import { eq } from "drizzle-orm";
import { validateDraft } from "../validation.ts";

export function parseJSON(v: any) { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; } }

export function transformDraft(row: any) {
  return {
    ...row,
    tags: parseJSON(row.tags),
    images: parseJSON(row.images ?? "[]"),
    video: row.video ?? "",
    cover: row.cover ?? "",
    header: row.header ?? "",
    abstract: row.abstract ?? "",
    contentType: row.contentType ?? row.content_type ?? "article",
  };
}

export const draftsRouter = new Hono();

// GET /api/drafts — list all
draftsRouter.get("/", (c) => {
  const db = getDB();
  const rows = db.select().from(drafts).all();
  return c.json(rows.map(transformDraft));
});

// GET /api/drafts/:id
draftsRouter.get("/:id", (c) => {
  const db = getDB();
  const row = db.select().from(drafts).where(eq(drafts.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(transformDraft(row));
});

// POST /api/drafts — create
draftsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    title?: string; content?: string; tags?: string[]; platform?: string; type?: string;
    images?: string[]; video?: string; cover?: string; header?: string; abstract?: string;
  }>();
  const now = new Date().toISOString();
  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const contentType = body.type ?? "article";
  const content = body.content ?? "";
  const platform = body.platform ?? "小红书";

  // Filter attachment fields by content type
  const images = contentType === "image_text" ? (body.images ?? []) : [];
  const video = contentType === "video" ? (body.video ?? "") : "";
  const cover = body.cover ?? "";
  const header = contentType === "article" ? (body.header ?? "") : "";

  const errors = validateDraft(platform, contentType, content, body.title, body.tags, body.abstract);
  if (errors.length > 0) {
    return c.json({ error: "validation failed", errors }, 422);
  }

  const db = getDB();
  db.insert(drafts).values({
    id,
    title: body.title ?? "",
    content,
    contentType,
    tags: JSON.stringify(body.tags ?? []),
    images: JSON.stringify(images),
    video,
    cover,
    header,
    abstract: body.abstract ?? "",
    platform: body.platform ?? "小红书",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }).run();

  const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
  return c.json(transformDraft(row), 201);
});

// PATCH /api/drafts/:id — update
draftsRouter.patch("/:id", async (c) => {
  const db = getDB();
  const id = c.req.param("id");
  const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{
    title?: string; content?: string; tags?: string[]; platform?: string; type?: string;
    images?: string[]; video?: string; cover?: string; header?: string; abstract?: string;
  }>();
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };

  // Determine effective content type (new value or existing)
  const effectiveType = body.type ?? (row as any).contentType ?? "article";

  if (body.title !== undefined) updates.title = body.title;
  if (body.type !== undefined) updates.contentType = body.type;
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
  if (body.platform !== undefined) updates.platform = body.platform;

  // Filter attachment fields by content type
  if (body.images !== undefined) updates.images = JSON.stringify(effectiveType === "image_text" ? body.images : []);
  if (body.video !== undefined) updates.video = effectiveType === "video" ? body.video : "";
  if (body.cover !== undefined) updates.cover = body.cover;
  if (body.header !== undefined) updates.header = effectiveType === "article" ? body.header : "";
  if (body.abstract !== undefined) updates.abstract = body.abstract;

  if (body.content !== undefined) {
    updates.content = body.content;
  }

  // Re-validate when content, platform, type, title, tags, or abstract changes
  if (body.content !== undefined || body.platform !== undefined || body.type !== undefined ||
      body.title !== undefined || body.tags !== undefined || body.abstract !== undefined) {
    const draftContent = body.content ?? (row as any).content ?? "";
    const draftType = body.type ?? (row as any).contentType ?? "article";
    const draftPlatform = body.platform ?? (row as any).platform ?? "小红书";
    const draftTitle = body.title ?? (row as any).title ?? "";
    const draftTags = Array.isArray(body.tags) ? body.tags : parseJSON((row as any).tags ?? "[]");
    const draftAbstract = body.abstract ?? (row as any).abstract ?? "";
    const errors = validateDraft(draftPlatform, draftType, draftContent, draftTitle, draftTags, draftAbstract);
    if (errors.length > 0) {
      return c.json({ error: "validation failed", errors }, 422);
    }
  }

  db.update(drafts).set(updates).where(eq(drafts.id, id)).run();
  const updated = db.select().from(drafts).where(eq(drafts.id, id)).get();
  return c.json(transformDraft(updated));
});

// DELETE /api/drafts/:id
draftsRouter.delete("/:id", (c) => {
  const db = getDB();
  const id = c.req.param("id");
  const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  // Cascade: delete publish_log first
  db.delete(publishLog).where(eq(publishLog.draftId, id)).run();
  db.delete(drafts).where(eq(drafts.id, id)).run();
  return c.json({ deleted: true, id });
});
