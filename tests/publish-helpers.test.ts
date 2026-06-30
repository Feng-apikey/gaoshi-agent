import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { closeDB } from "../storage/db.ts";
import { resolveMaterialPath, cacheMaterialPath, clearPathCache } from "../publish/helpers.ts";

// ── Isolated test env ──
//
// getDB() opens cwd/data/gaoshi.db with module-level singleton. We chdir to
// a temp dir before each test, closeDB() the singleton so the next getDB()
// call re-opens against the new cwd, and seed materials directly via SQL.

const tmpRoot = path.join(os.tmpdir(), `gaoshi_publish_test_${Date.now()}`);
const dataDir = path.join(tmpRoot, "data");
const dbPath = path.join(dataDir, "gaoshi.db");
const origCwd = process.cwd();

function seedMaterial(id: string, absPath: string) {
  const db = new Database(dbPath);
  db.prepare(`DELETE FROM materials WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO materials
    (id, name, path, category, mime_type, size, tags, description,
     generated_by, use_count, created_at, width, height)
    VALUES (?, ?, ?, 'image', '', 0, '[]', '', '', 0, ?, 0, 0)`)
    .run(id, path.basename(absPath), absPath, new Date().toISOString());
  db.close();
}

function clearMaterials() {
  const db = new Database(dbPath);
  db.prepare("DELETE FROM materials").run();
  db.close();
}

beforeAll(() => {
  fs.mkdirSync(dataDir, { recursive: true });
  // Pre-create empty DB so getDB()'s initTables() succeeds (uses real schema)
  process.chdir(tmpRoot);
  const sqlite = new Database(dbPath);
  // Mirror production schema (subset needed by resolveMaterialPath)
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
      description TEXT DEFAULT '', generated_by TEXT DEFAULT '', use_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0
    );
  `);
  sqlite.close();
});

beforeEach(() => {
  closeDB();                       // force getDB() to re-open against current cwd
  process.chdir(tmpRoot);
  clearMaterials();
  clearPathCache();
});

afterAll(() => {
  closeDB();
  process.chdir(origCwd);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════
// resolveMaterialPath — three-tier resolution
// ═══════════════════════════════════════════

describe("resolveMaterialPath", () => {
  it("prefers knownPath when it exists on disk", () => {
    const real = path.join(dataDir, "explicit.png");
    fs.writeFileSync(real, "x");
    expect(resolveMaterialPath("anything", real)).toBe(real);
  });

  it("ignores knownPath when file does not exist", () => {
    const cached = path.join(dataDir, "cached.png");
    fs.writeFileSync(cached, "x");
    cacheMaterialPath("mat1", cached);
    // knownPath points to non-existent file → falls through to cache
    expect(resolveMaterialPath("mat1", path.join(dataDir, "ghost.png"))).toBe(cached);
  });

  it("returns cached path when set via cacheMaterialPath", () => {
    const p = path.join(dataDir, "via-cache.png");
    fs.writeFileSync(p, "x");
    cacheMaterialPath("mat2", p);
    expect(resolveMaterialPath("mat2")).toBe(p);
  });

  it("falls back to materials table when no cache hit", () => {
    const p = path.join(dataDir, "via-db.png");
    fs.writeFileSync(p, "x");
    seedMaterial("mat3", p);
    expect(resolveMaterialPath("mat3")).toBe(p);
  });

  it("falls back to data/<id> on disk when DB has no row", () => {
    const id = "direct.png";
    const p = path.join(dataDir, id);
    fs.writeFileSync(p, "x");
    expect(resolveMaterialPath(id)).toBe(p);
  });

  it("throws when materialId resolves to nothing", () => {
    expect(() => resolveMaterialPath("nonexistent.png")).toThrow(/素材文件不存在/);
  });

  it("cache takes priority over DB row when both present", () => {
    const cached = path.join(dataDir, "cached-vs-db.png");
    const dbRow = path.join(dataDir, "db-row.png");
    fs.writeFileSync(cached, "cached");
    fs.writeFileSync(dbRow, "db");
    cacheMaterialPath("mat4", cached);
    seedMaterial("mat4", dbRow);
    expect(resolveMaterialPath("mat4")).toBe(cached);
  });

  it("ignores cache entry whose file no longer exists on disk", () => {
    const p = path.join(dataDir, "deleted.png");
    cacheMaterialPath("mat5", p);
    // Don't create the file → cache hit fails existsSync check → falls through
    seedMaterial("mat5", path.join(dataDir, "alt.png")); // alt doesn't exist either
    expect(() => resolveMaterialPath("mat5")).toThrow();
  });

  it("cacheMaterialPath / clearPathCache lifecycle", () => {
    const p = path.join(dataDir, "lifecycle.png");
    fs.writeFileSync(p, "x");
    cacheMaterialPath("lc1", p);
    expect(resolveMaterialPath("lc1")).toBe(p);
    clearPathCache();
    seedMaterial("lc1", p);  // falls back to DB now that cache is cleared
    expect(resolveMaterialPath("lc1")).toBe(p);
  });
});