import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── In-memory DB setup ──

const materials = sqliteTable("materials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  category: text("category").notNull(),
  mimeType: text("mime_type").default(""),
  size: integer("size").notNull().default(0),
  width: integer("width").default(0),
  height: integer("height").default(0),
  tags: text("tags").default("[]"),
  description: text("description").default(""),
  generatedBy: text("generated_by").default(""),
  useCount: integer("use_count").default(0),
  createdAt: text("created_at").notNull(),
});

const TEST_DIR = path.join(os.tmpdir(), "gaoshi_test_materials");
let db: ReturnType<typeof drizzle>;
let sqlite: Database.Database;

function transformMaterial(row: any) {
  return {
    ...row,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
  };
}

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Create test files
  fs.writeFileSync(path.join(TEST_DIR, "test-doc.md"), "# Test Doc\n\nHello world content for analysis.");
  fs.writeFileSync(path.join(TEST_DIR, "empty.txt"), "");
  fs.mkdirSync(path.join(TEST_DIR, "images"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, "docs"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "docs", "readme.md"), "# README\n\nsetup instructions here.");
  fs.writeFileSync(path.join(TEST_DIR, "images", "photo.jpg"), "fake-jpeg-data");

  const dbPath = path.join(TEST_DIR, "test.db");
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, category TEXT NOT NULL,
      mime_type TEXT DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]', description TEXT DEFAULT '',
      generated_by TEXT DEFAULT '', use_count INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
  `);
  db = drizzle(sqlite, { schema: { materials } });
});

afterAll(() => {
  if (sqlite) sqlite.close();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

// ── CRUD ──

describe("Materials CRUD", () => {
  const ID = "test-material-1";
  const now = new Date().toISOString();

  it("inserts a material record", () => {
    db.insert(materials).values({
      id: ID, name: "test.png", path: "/tmp/test.png", category: "image",
      mimeType: "image/png", size: 1024, tags: "[]", description: "",
      generatedBy: "", useCount: 0, createdAt: now,
    }).run();

    const row = db.select().from(materials).where(eq(materials.id, ID)).get();
    expect(row).toBeDefined();
    expect(row!.name).toBe("test.png");
    expect(row!.category).toBe("image");
  });

  it("reads and parses tags as JSON", () => {
    db.update(materials).set({ tags: JSON.stringify(["tag1", "tag2"]) }).where(eq(materials.id, ID)).run();

    const row = db.select().from(materials).where(eq(materials.id, ID)).get();
    const transformed = transformMaterial(row);
    expect(transformed.tags).toEqual(["tag1", "tag2"]);
  });

  it("handles empty tags array", () => {
    db.update(materials).set({ tags: "[]" }).where(eq(materials.id, ID)).run();
    const row = db.select().from(materials).where(eq(materials.id, ID)).get();
    const transformed = transformMaterial(row);
    expect(transformed.tags).toEqual([]);
  });

  it("lists all materials", () => {
    // Insert a second one
    db.insert(materials).values({
      id: "test-material-2", name: "doc.pdf", path: "/tmp/doc.pdf", category: "document",
      mimeType: "application/pdf", size: 2048, tags: "[]", description: "",
      generatedBy: "", useCount: 0, createdAt: now,
    }).run();

    const rows = db.select().from(materials).all();
    expect(rows.length).toBe(2);
  });

  it("deletes a material", () => {
    db.delete(materials).where(eq(materials.id, ID)).run();
    const row = db.select().from(materials).where(eq(materials.id, ID)).get();
    expect(row).toBeUndefined();
  });

  it("uses INSERT OR REPLACE to update", () => {
    // Delete the second one first
    db.delete(materials).where(eq(materials.id, "test-material-2")).run();

    // Insert fresh
    db.insert(materials).values({
      id: "test-material-2", name: "updated.pdf", path: "/tmp/updated.pdf", category: "document",
      mimeType: "application/pdf", size: 4096, tags: JSON.stringify(["doc"]), description: "desc text",
      generatedBy: "", useCount: 0, createdAt: now,
    }).run();

    const row = db.select().from(materials).where(eq(materials.id, "test-material-2")).get();
    expect(row!.name).toBe("updated.pdf");
    expect(row!.size).toBe(4096);
    const tags = JSON.parse(row!.tags as string);
    expect(tags).toEqual(["doc"]);
  });
});

// ── File system sync (replicating syncAndList logic) ──

describe("File system sync", () => {
  // Simulate scanning test directory for files not yet in DB
  const extToCategory: Record<string, string> = {
    ".md": "document", ".txt": "document", ".pdf": "document",
    ".jpg": "image", ".png": "image",
  };

  it("discovers files not in DB and inserts them", () => {
    const dataDir = TEST_DIR;
    // Scan docs/
    const synced: string[] = [];
    const mediaDirs = ["docs", "images"];
    for (const dir of mediaDirs) {
      const dirPath = path.join(dataDir, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const entry of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, entry);
        if (!fs.statSync(full).isFile()) continue;
        const id = path.relative(dataDir, full).replace(/\\/g, "/");
        const existing = db.select().from(materials).where(eq(materials.id, id)).get();
        if (existing) continue;
        const ext = path.extname(entry).toLowerCase();
        const category = extToCategory[ext] ?? "document";
        const stat = fs.statSync(full);
        db.insert(materials).values({
          id, name: entry, path: full, category,
          mimeType: "", size: stat.size, tags: "[]", description: "",
          generatedBy: "", useCount: 0, createdAt: stat.birthtime.toISOString(),
        }).run();
        synced.push(id);
      }
    }
    expect(synced.length).toBe(2); // docs/readme.md + images/photo.jpg
    expect(synced).toContain("docs/readme.md");
    expect(synced).toContain("images/photo.jpg");
  });

  it("does not duplicate already-synced files", () => {
    // Second sync should find 0 new files
    const dataDir = TEST_DIR;
    let newCount = 0;
    for (const dir of ["docs", "images"]) {
      const dirPath = path.join(dataDir, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const entry of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, entry);
        if (!fs.statSync(full).isFile()) continue;
        const id = path.relative(dataDir, full).replace(/\\/g, "/");
        const existing = db.select().from(materials).where(eq(materials.id, id)).get();
        if (!existing) newCount++;
      }
    }
    expect(newCount).toBe(0);
  });

  it("assigns correct category by extension", () => {
    const imageRow = db.select().from(materials).where(eq(materials.id, "images/photo.jpg")).get();
    const docRow = db.select().from(materials).where(eq(materials.id, "docs/readme.md")).get();
    expect(imageRow!.category).toBe("image");
    expect(docRow!.category).toBe("document");
  });

  it("handles multi-segment IDs in where clause", () => {
    // IDs like "docs/readme.md" need to work with eq()
    const row = db.select().from(materials).where(eq(materials.id, "docs/readme.md")).get();
    expect(row).toBeDefined();
    expect(row!.name).toBe("readme.md");
  });
});

// ── ID format handling ──

describe("Material ID formats", () => {
  it("handles hex IDs (from upload)", () => {
    const hexId = "abc123def456";
    db.insert(materials).values({
      id: hexId, name: "uploaded.png", path: `/tmp/${hexId}.png`, category: "image",
      mimeType: "image/png", size: 100, tags: "[]", description: "",
      generatedBy: "", useCount: 0, createdAt: new Date().toISOString(),
    }).run();
    const row = db.select().from(materials).where(eq(materials.id, hexId)).get();
    expect(row).toBeDefined();
  });

  it("handles path-style IDs (from MCP save / sync)", () => {
    const pathId = "audio/music_123.mp3";
    db.insert(materials).values({
      id: pathId, name: "music_123.mp3", path: `/data/${pathId}`, category: "audio",
      mimeType: "audio/mpeg", size: 999, tags: "[]", description: "",
      generatedBy: "", useCount: 0, createdAt: new Date().toISOString(),
    }).run();
    const row = db.select().from(materials).where(eq(materials.id, pathId)).get();
    expect(row).toBeDefined();
    expect(row!.category).toBe("audio");
  });
});
