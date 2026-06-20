import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Temp DB setup ──

const tmpDir = path.join(os.tmpdir(), `gaoshi_test_${Date.now()}`);
const dbPath = path.join(tmpDir, "test.db");

const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  tags: text("tags").default("[]"),
  platform: text("platform").default("小红书"),
  contentType: text("content_type").notNull().default("article"),
  images: text("images").default("[]"),
  video: text("video").default(""),
  cover: text("cover").default(""),
  header: text("header").default(""),
  abstract: text("abstract").default(""),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const publishLog = sqliteTable("publish_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  draftId: text("draft_id").notNull().references(() => drafts.id),
  platform: text("platform").notNull(),
  status: text("status").notNull(),
  url: text("url").default(""),
  publishedAt: text("published_at").notNull(),
});

const materials = sqliteTable("materials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  category: text("category").notNull(),
  mimeType: text("mime_type").default(""),
  size: integer("size").notNull().default(0),
  tags: text("tags").default("[]"),
  description: text("description").default(""),
  createdAt: text("created_at").notNull(),
});

let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      tags TEXT DEFAULT '[]', platform TEXT DEFAULT '小红书', content_type TEXT NOT NULL DEFAULT 'article',
      images TEXT DEFAULT '[]', video TEXT DEFAULT '', cover TEXT DEFAULT '',
      header TEXT DEFAULT '', abstract TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publish_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id TEXT NOT NULL REFERENCES drafts(id),
      platform TEXT NOT NULL, status TEXT NOT NULL, url TEXT DEFAULT '', published_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, category TEXT NOT NULL,
      mime_type TEXT DEFAULT '', size INTEGER NOT NULL DEFAULT 0, tags TEXT DEFAULT '[]',
      description TEXT DEFAULT '', created_at TEXT NOT NULL
    );
  `);
  db = drizzle(sqlite, { schema: { drafts, publishLog, materials } });
});

afterAll(() => {
  try { (db as any).$client?.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── Helpers ──

const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function parseJSON(v: any) { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; } }

function transformDraft(row: any) {
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

// ── Validation (imported from real module) ──

import { validateDraft } from "../api/validation.ts";

// ═══════════════════════════════════════════
// Drafts
// ═══════════════════════════════════════════

describe("drafts CRUD", () => {
  it("creates a draft with all fields", () => {
    const id = uid("draft");
    const createdAt = now();
    db.insert(drafts).values({
      id, title: "测试标题", content: "正文内容",
      tags: '["财经","科技"]', platform: "小红书", contentType: "image_text",
      images: '["mat_1","mat_2"]', video: "", cover: "mat_3",
      header: "", abstract: "摘要文字",
      status: "draft", createdAt, updatedAt: createdAt,
    }).run();

    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(row).not.toBeNull();
    const d = transformDraft(row);
    expect(d.title).toBe("测试标题");
    expect(d.content).toBe("正文内容");
    expect(d.tags).toEqual(["财经", "科技"]);
    expect(d.images).toEqual(["mat_1", "mat_2"]);
    expect(d.cover).toBe("mat_3");
    expect(d.abstract).toBe("摘要文字");
    expect(d.platform).toBe("小红书");
    expect(d.status).toBe("draft");
  });

  it("creates a draft with minimal fields", () => {
    const id = uid("draft");
    const createdAt = now();
    db.insert(drafts).values({
      id, title: "", content: "",
      tags: "[]", platform: "抖音", contentType: "video",
      images: "[]", status: "draft",
      createdAt, updatedAt: createdAt,
    }).run();

    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(row).not.toBeNull();
    expect(transformDraft(row).platform).toBe("抖音");
  });

  it("lists all drafts", () => {
    const rows = db.select().from(drafts).all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("gets a draft by ID", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "target", content: "x", tags: "[]", platform: "B站",
      contentType: "article", status: "draft", createdAt: now(), updatedAt: now(),
    }).run();

    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(row).not.toBeNull();
    expect(transformDraft(row).title).toBe("target");
  });

  it("returns undefined for missing draft", () => {
    const row = db.select().from(drafts).where(eq(drafts.id, "nonexistent")).get();
    expect(row).toBeUndefined();
  });

  it("updates a draft", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "old", content: "old", tags: "[]", platform: "小红书",
      contentType: "image_text", status: "draft", createdAt: now(), updatedAt: now(),
    }).run();

    db.update(drafts).set({ title: "new", content: "updated" }).where(eq(drafts.id, id)).run();

    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(transformDraft(row).title).toBe("new");
    expect(transformDraft(row).content).toBe("updated");
  });

  it("deletes a draft without publish_log", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "x", content: "x", tags: "[]", status: "draft",
      createdAt: now(), updatedAt: now(),
    }).run();

    db.delete(drafts).where(eq(drafts.id, id)).run();

    expect(db.select().from(drafts).where(eq(drafts.id, id)).get()).toBeUndefined();
  });

  it("cascade deletes publish_log before draft", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "x", content: "x", tags: "[]", status: "pushed",
      createdAt: now(), updatedAt: now(),
    }).run();
    db.insert(publishLog).values({
      draftId: id, platform: "小红书", status: "success",
      url: "https://example.com/post/1", publishedAt: now(),
    }).run();

    // Delete publish_log first, then draft
    db.delete(publishLog).where(eq(publishLog.draftId, id)).run();
    db.delete(drafts).where(eq(drafts.id, id)).run();

    expect(db.select().from(drafts).where(eq(drafts.id, id)).get()).toBeUndefined();
    expect(db.select().from(publishLog).where(eq(publishLog.draftId, id)).get()).toBeUndefined();
  });

  it("fails to delete draft with FK constraint if publish_log not deleted first", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "x", content: "x", tags: "[]", status: "pushed",
      createdAt: now(), updatedAt: now(),
    }).run();
    db.insert(publishLog).values({
      draftId: id, platform: "小红书", status: "success",
      url: "", publishedAt: now(),
    }).run();

    expect(() => {
      db.delete(drafts).where(eq(drafts.id, id)).run();
    }).toThrow();
  });
});

describe("draft validation", () => {
  it("passes content within limits", () => {
    const errors = validateDraft("小红书", "image_text", "短内容");
    expect(errors).toHaveLength(0);
  });

  it("rejects content exceeding body limit", () => {
    const long = "字".repeat(1500);
    const errors = validateDraft("小红书", "image_text", long);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe("content");
    expect(errors[0].message).toContain("字数超过限制");
  });

  it("rejects too many images in content", () => {
    const images = Array.from({ length: 20 }, (_, i) => `![img${i}](url${i})`).join("\n");
    const errors = validateDraft("小红书", "image_text", images);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.includes("图片超过限制"))).toBe(true);
  });

  it("counts HTML img tags as images", () => {
    const content = "<img src='a.jpg'><img src='b.jpg'>".repeat(10);
    const errors = validateDraft("小红书", "image_text", content);
    expect(errors.some(e => e.message.includes("图片超过限制"))).toBe(true);
  });

  it("skips validation for unknown platform", () => {
    const errors = validateDraft("未知平台", "article", "x".repeat(100000));
    expect(errors).toHaveLength(0);
  });

  it("skips validation for unknown content type", () => {
    const errors = validateDraft("小红书", "unknown_type", "x".repeat(100000));
    expect(errors).toHaveLength(0);
  });

  it("B站 article allows 50000 chars", () => {
    const content = "字".repeat(50000);
    const errors = validateDraft("B站", "article", content);
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("B站 article rejects content exceeding 100000 chars", () => {
    const content = "字".repeat(100001);
    const errors = validateDraft("B站", "article", content);
    expect(errors.some(e => e.field === "content")).toBe(true);
  });
});

describe("draft fields parsing", () => {
  it("parses valid JSON tags array", () => {
    const row = { tags: '["a","b"]', images: "[]", contentType: "article" };
    const d = transformDraft(row);
    expect(d.tags).toEqual(["a", "b"]);
  });

  it("returns raw value for malformed JSON tags", () => {
    const row = { tags: "{broken", images: "[]", contentType: "article" };
    const d = transformDraft(row);
    expect(d.tags).toBe("{broken");
  });

  it("parses valid JSON images array", () => {
    const row = { tags: "[]", images: '["id1","id2"]', contentType: "article" };
    const d = transformDraft(row);
    expect(d.images).toEqual(["id1", "id2"]);
  });

  it("defaults images to empty array when missing", () => {
    const row = { tags: "[]", images: undefined, contentType: "article" };
    const d = transformDraft(row);
    expect(d.images).toEqual([]);
  });

  it("maps content_type to contentType", () => {
    const row = { tags: "[]", images: "[]", content_type: "video" };
    const d = transformDraft(row);
    expect(d.contentType).toBe("video");
  });

  it("prefers contentType over content_type", () => {
    const row = { tags: "[]", images: "[]", contentType: "image_text", content_type: "article" };
    const d = transformDraft(row);
    expect(d.contentType).toBe("image_text");
  });

  it("defaults missing fields to empty values", () => {
    const row = { tags: "[]" };
    const d = transformDraft(row);
    expect(d.video).toBe("");
    expect(d.cover).toBe("");
    expect(d.header).toBe("");
    expect(d.abstract).toBe("");
  });
});

// ═══════════════════════════════════════════
// Materials
// ═══════════════════════════════════════════

describe("materials CRUD", () => {
  it("inserts a material", () => {
    const id = uid("mat");
    db.insert(materials).values({
      id, name: "test.png", path: "/data/images/test.png",
      category: "image", mimeType: "image/png", size: 1024,
      tags: '["产品","截图"]', description: "测试图片",
      createdAt: now(),
    }).run();

    const row = db.select().from(materials).where(eq(materials.id, id)).get();
    expect(row).not.toBeNull();
    expect(row!.name).toBe("test.png");
    expect(row!.category).toBe("image");
    expect(row!.size).toBe(1024);
    const tags = parseJSON(row!.tags);
    expect(tags).toEqual(["产品", "截图"]);
  });

  it("lists all materials", () => {
    const rows = db.select().from(materials).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("gets a material by ID", () => {
    const id = uid("mat");
    db.insert(materials).values({
      id, name: "target.mp4", path: "/data/videos/target.mp4",
      category: "video", mimeType: "video/mp4", size: 9999,
      tags: "[]", description: "", createdAt: now(),
    }).run();

    const row = db.select().from(materials).where(eq(materials.id, id)).get();
    expect(row).not.toBeNull();
    expect(row!.name).toBe("target.mp4");
    expect(row!.category).toBe("video");
  });

  it("returns undefined for missing material", () => {
    const row = db.select().from(materials).where(eq(materials.id, "nonexistent")).get();
    expect(row).toBeUndefined();
  });

  it("deletes a material", () => {
    const id = uid("mat");
    db.insert(materials).values({
      id, name: "delete_me.txt", path: "/data/documents/delete_me.txt",
      category: "document", size: 0, tags: "[]", description: "", createdAt: now(),
    }).run();

    db.delete(materials).where(eq(materials.id, id)).run();
    expect(db.select().from(materials).where(eq(materials.id, id)).get()).toBeUndefined();
  });
});

describe("materials categories", () => {
  it("handles all material categories", () => {
    const categories = ["image", "audio", "video", "document"] as const;
    for (const cat of categories) {
      const id = uid("mat");
      db.insert(materials).values({
        id, name: `test.${cat}`, path: `/data/${cat}s/test.${cat}`,
        category: cat, size: 100, tags: "[]", description: "", createdAt: now(),
      }).run();
      const row = db.select().from(materials).where(eq(materials.id, id)).get();
      expect(row!.category).toBe(cat);
    }
  });

  it("stores and retrieves mime types correctly", () => {
    const cases = [
      { name: "a.jpg", mime: "image/jpeg" },
      { name: "b.mp3", mime: "audio/mpeg" },
      { name: "c.mp4", mime: "video/mp4" },
      { name: "d.pdf", mime: "application/pdf" },
    ];
    for (const c of cases) {
      const id = uid("mat");
      db.insert(materials).values({
        id, name: c.name, path: `/data/tmp/${c.name}`, category: "document",
        mimeType: c.mime, size: 0, tags: "[]", description: "", createdAt: now(),
      }).run();
      const row = db.select().from(materials).where(eq(materials.id, id)).get();
      expect(row!.mimeType).toBe(c.mime);
    }
  });
});

describe("draft status lifecycle", () => {
  it("transitions draft → pushed", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "x", content: "x", tags: "[]", status: "draft",
      createdAt: now(), updatedAt: now(),
    }).run();

    db.update(drafts).set({ status: "pushed", updatedAt: now() }).where(eq(drafts.id, id)).run();
    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(transformDraft(row).status).toBe("pushed");
  });

  it("transitions draft → push_failed", () => {
    const id = uid("draft");
    db.insert(drafts).values({
      id, title: "x", content: "x", tags: "[]", status: "draft",
      createdAt: now(), updatedAt: now(),
    }).run();

    db.update(drafts).set({ status: "push_failed", updatedAt: now() }).where(eq(drafts.id, id)).run();
    const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
    expect(transformDraft(row).status).toBe("push_failed");
  });

  it("publish_log records successful push", () => {
    const draftId = uid("draft");
    db.insert(drafts).values({
      id: draftId, title: "x", content: "x", tags: "[]", status: "pushed",
      createdAt: now(), updatedAt: now(),
    }).run();
    db.insert(publishLog).values({
      draftId, platform: "抖音", status: "success",
      url: "https://creator.douyin.com/post/abc", publishedAt: now(),
    }).run();

    const log = db.select().from(publishLog).where(eq(publishLog.draftId, draftId)).get();
    expect(log).not.toBeNull();
    expect(log!.platform).toBe("抖音");
    expect(log!.status).toBe("success");
    expect(log!.url).toBe("https://creator.douyin.com/post/abc");
  });

  it("publish_log records failed push", () => {
    const draftId = uid("draft");
    db.insert(drafts).values({
      id: draftId, title: "x", content: "x", tags: "[]", status: "push_failed",
      createdAt: now(), updatedAt: now(),
    }).run();
    db.insert(publishLog).values({
      draftId, platform: "B站", status: "failed",
      url: "", publishedAt: now(),
    }).run();

    const log = db.select().from(publishLog).where(eq(publishLog.draftId, draftId)).get();
    expect(log).not.toBeNull();
    expect(log!.status).toBe("failed");
  });
});

describe("draft platform field", () => {
  it("accepts all supported platforms", () => {
    const platforms = ["小红书", "B站", "抖音", "公众号", "微博", "知乎", "头条号"];
    for (const p of platforms) {
      const id = uid("draft");
      db.insert(drafts).values({
        id, title: p, content: "", tags: "[]", platform: p,
        contentType: "article", status: "draft", createdAt: now(), updatedAt: now(),
      }).run();
      const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
      expect(transformDraft(row).platform).toBe(p);
    }
  });
});
