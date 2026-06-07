import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";
import * as path from "node:path";
import * as fs from "node:fs";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDB() {
  if (_db) return _db;

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(path.join(dataDir, "gaoshi.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  // Auto-migrate
  initTables(sqlite);

  return _db;
}

function initTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT DEFAULT '[]',
      platform TEXT DEFAULT '小红书',
      content_type TEXT NOT NULL DEFAULT 'article',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT NOT NULL REFERENCES drafts(id),
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT DEFAULT '',
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER DEFAULT 0,
      custom_models TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS model_routing (
      capability TEXT PRIMARY KEY,
      provider_id TEXT DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      base_url TEXT DEFAULT '',
      api_key TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      category TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // ── Migrations for existing DBs ──
  addColumnIfNotExists(sqlite, "drafts", "images", "TEXT DEFAULT '[]'");
  addColumnIfNotExists(sqlite, "drafts", "video", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "drafts", "cover", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "drafts", "header", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "drafts", "abstract", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "materials", "width", "INTEGER DEFAULT 0");
  addColumnIfNotExists(sqlite, "materials", "height", "INTEGER DEFAULT 0");
  addColumnIfNotExists(sqlite, "materials", "generated_by", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "materials", "use_count", "INTEGER DEFAULT 0");
  addColumnIfNotExists(sqlite, "threads", "title", "TEXT NOT NULL DEFAULT '新对话'");
  addColumnIfNotExists(sqlite, "model_routing", "base_url", "TEXT DEFAULT ''");
  addColumnIfNotExists(sqlite, "model_routing", "api_key", "TEXT DEFAULT ''");
}

function addColumnIfNotExists(db: Database.Database, table: string, column: string, colDef: string) {
  const existing = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (existing.some(c => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
  } catch (err: any) {
    console.error(`[db] migration FAILED: ALTER TABLE ${table} ADD COLUMN ${column} — ${err.message}`);
  }
}

export function closeDB() {
  if (_db) {
    try { (_db as any).$client?.close(); } catch {}
    _db = null;
  }
}
