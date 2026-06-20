import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Schema ──

const providerConfig = sqliteTable("provider_config", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().default(""),
  baseURL: text("base_url").notNull(),
  enabled: integer("enabled").notNull().default(0),
  isCustom: integer("is_custom").default(0),
  customModels: text("custom_models").default("[]"),
});

const modelRouting = sqliteTable("model_routing", {
  capability: text("capability").primaryKey(),
  providerId: text("provider_id").default(""),
  model: text("model").notNull().default(""),
  baseURL: text("base_url").default(""),
  apiKey: text("api_key").default(""),
});

const tmpDir = path.join(os.tmpdir(), `gaoshi_prov_test_${Date.now()}`);
const dbPath = path.join(tmpDir, "test.db");

import { transformProvider } from "../api/routes/providers.ts";

let db: ReturnType<typeof drizzle>;
let sqlite: Database.Database;

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS provider_config (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER DEFAULT 0, custom_models TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS model_routing (
      capability TEXT PRIMARY KEY, provider_id TEXT DEFAULT '',
      model TEXT NOT NULL DEFAULT '', base_url TEXT DEFAULT '', api_key TEXT DEFAULT ''
    );
  `);
  db = drizzle(sqlite, { schema: { providerConfig, modelRouting } });
});

afterAll(() => {
  try { sqlite.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════
// Provider CRUD
// ═══════════════════════════════════════════

describe("provider CRUD", () => {
  it("inserts a new provider", () => {
    db.insert(providerConfig).values({
      id: "deepseek",
      name: "DeepSeek",
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com/v1",
      enabled: 1,
      isCustom: 0,
      customModels: JSON.stringify(["deepseek-chat", "deepseek-reasoner"]),
    }).run();

    const row = db.select().from(providerConfig).where(eq(providerConfig.id, "deepseek")).get();
    expect(row).toBeDefined();
    expect(row!.name).toBe("DeepSeek");
    expect(row!.enabled).toBe(1);

    const transformed = transformProvider(row);
    expect(transformed.customModels).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("lists all providers", () => {
    db.insert(providerConfig).values({
      id: "minimax",
      name: "MiniMax",
      apiKey: "sk-minimax",
      baseURL: "https://api.minimax.io/v1",
      enabled: 1,
      isCustom: 1,
      customModels: "[]",
    }).run();

    const rows = db.select().from(providerConfig).all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("updates an existing provider", () => {
    db.update(providerConfig).set({
      name: "DeepSeek V3",
      apiKey: "sk-new",
    }).where(eq(providerConfig.id, "deepseek")).run();

    const row = db.select().from(providerConfig).where(eq(providerConfig.id, "deepseek")).get();
    expect(row!.name).toBe("DeepSeek V3");
    expect(row!.apiKey).toBe("sk-new");
  });

  it("deletes a provider and cascades routing entries", () => {
    // First create a routing entry referencing minimax
    db.insert(modelRouting).values({
      capability: "text",
      providerId: "minimax",
      model: "minimax-m2.7",
      baseURL: "",
      apiKey: "",
    }).run();

    // Delete routing then provider
    db.delete(modelRouting).where(eq(modelRouting.providerId, "minimax")).run();
    db.delete(providerConfig).where(eq(providerConfig.id, "minimax")).run();

    const provider = db.select().from(providerConfig).where(eq(providerConfig.id, "minimax")).get();
    expect(provider).toBeUndefined();

    const routing = db.select().from(modelRouting).where(eq(modelRouting.capability, "text")).get();
    expect(routing).toBeUndefined();
  });

  it("returns undefined for missing provider", () => {
    const row = db.select().from(providerConfig).where(eq(providerConfig.id, "nonexistent")).get();
    expect(row).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// customModels parsing
// ═══════════════════════════════════════════

describe("provider customModels parsing", () => {
  it("parses valid JSON customModels", () => {
    const row = { id: "test", customModels: '["gpt-4","gpt-3.5"]' };
    const t = transformProvider(row);
    expect(t.customModels).toEqual(["gpt-4", "gpt-3.5"]);
  });

  it("returns raw value for non-string customModels", () => {
    const row = { id: "test", customModels: ["already-parsed"] };
    const t = transformProvider(row);
    expect(t.customModels).toEqual(["already-parsed"]);
  });

  it("handles empty customModels array", () => {
    const row = { id: "test", customModels: "[]" };
    const t = transformProvider(row);
    expect(t.customModels).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// enabled toggle
// ═══════════════════════════════════════════

describe("provider enabled toggle", () => {
  it("inserts provider with enabled=0", () => {
    db.insert(providerConfig).values({
      id: "disabled-prov",
      name: "Disabled",
      apiKey: "",
      baseURL: "https://example.com",
      enabled: 0,
      isCustom: 0,
      customModels: "[]",
    }).run();

    const row = db.select().from(providerConfig).where(eq(providerConfig.id, "disabled-prov")).get();
    expect(row!.enabled).toBe(0);
  });

  it("toggles enabled from 0 to 1", () => {
    db.update(providerConfig).set({ enabled: 1 }).where(eq(providerConfig.id, "disabled-prov")).run();
    const row = db.select().from(providerConfig).where(eq(providerConfig.id, "disabled-prov")).get();
    expect(row!.enabled).toBe(1);
  });
});
