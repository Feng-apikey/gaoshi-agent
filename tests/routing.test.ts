import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Schema ──

const modelRouting = sqliteTable("model_routing", {
  capability: text("capability").primaryKey(),
  providerId: text("provider_id").default(""),
  model: text("model").notNull().default(""),
  baseURL: text("base_url").default(""),
  apiKey: text("api_key").default(""),
});

const tmpDir = path.join(os.tmpdir(), `gaoshi_routing_test_${Date.now()}`);
const dbPath = path.join(tmpDir, "test.db");

let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_routing (
      capability TEXT PRIMARY KEY, provider_id TEXT DEFAULT '',
      model TEXT NOT NULL DEFAULT '', base_url TEXT DEFAULT '', api_key TEXT DEFAULT ''
    );
  `);
  db = drizzle(sqlite, { schema: { modelRouting } });
});

afterAll(() => {
  try { (db as any).$client?.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════
// Routing CRUD
// ═══════════════════════════════════════════

describe("model routing CRUD", () => {
  it("inserts a routing entry", () => {
    db.insert(modelRouting).values({
      capability: "text",
      providerId: "deepseek",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "",
    }).run();

    const row = db.select().from(modelRouting).where(eq(modelRouting.capability, "text")).get();
    expect(row).toBeDefined();
    expect(row!.model).toBe("deepseek-chat");
    expect(row!.providerId).toBe("deepseek");
  });

  it("lists all routing entries", () => {
    db.insert(modelRouting).values({
      capability: "vision",
      providerId: "openai",
      model: "gpt-4o",
      baseURL: "",
      apiKey: "",
    }).run();

    const rows = db.select().from(modelRouting).all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("upserts existing routing entry", () => {
    // Update existing "text" capability
    db.update(modelRouting).set({
      providerId: "minimax",
      model: "minimax-m2.7",
      baseURL: "https://api.minimax.io/v1",
      apiKey: "",
    }).where(eq(modelRouting.capability, "text")).run();

    const row = db.select().from(modelRouting).where(eq(modelRouting.capability, "text")).get();
    expect(row!.model).toBe("minimax-m2.7");
    expect(row!.providerId).toBe("minimax");
  });

  it("deletes a routing entry", () => {
    db.delete(modelRouting).where(eq(modelRouting.capability, "vision")).run();
    const row = db.select().from(modelRouting).where(eq(modelRouting.capability, "vision")).get();
    expect(row).toBeUndefined();
  });

  it("returns undefined for missing routing", () => {
    const row = db.select().from(modelRouting).where(eq(modelRouting.capability, "nonexistent")).get();
    expect(row).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// Routing capabilities
// ═══════════════════════════════════════════

describe("routing capabilities", () => {
  it("supports standard capabilities: text, vision, video, image, tts, music", () => {
    const capabilities = ["text", "vision", "video", "image", "tts", "music"];
    for (const cap of capabilities) {
      const existing = db.select().from(modelRouting).where(eq(modelRouting.capability, cap)).get();
      if (existing) {
        db.delete(modelRouting).where(eq(modelRouting.capability, cap)).run();
      }

      db.insert(modelRouting).values({
        capability: cap,
        providerId: cap,
        model: `${cap}-model`,
        baseURL: "",
        apiKey: "",
      }).run();

      const row = db.select().from(modelRouting).where(eq(modelRouting.capability, cap)).get();
      expect(row).toBeDefined();
      expect(row!.model).toBe(`${cap}-model`);
    }
  });

  it("allows empty providerId for custom endpoint routing", () => {
    db.insert(modelRouting).values({
      capability: "custom-text",
      providerId: "",
      model: "local-model",
      baseURL: "http://localhost:8080/v1",
      apiKey: "sk-local",
    }).run();

    const row = db.select().from(modelRouting).where(eq(modelRouting.capability, "custom-text")).get();
    expect(row!.providerId).toBe("");
    expect(row!.baseURL).toBe("http://localhost:8080/v1");
  });
});
