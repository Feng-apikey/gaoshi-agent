import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setMemoryDir, loadAll, get, save, remove } from "../agent/memory/manager.ts";
import { search, buildIndex } from "../agent/memory/indexer.ts";
import { tokenize } from "../agent/memory/tokenizer.ts";
import { isExpired } from "../agent/memory/types.ts";
import type { MemoryEntry } from "../agent/memory/types.ts";

const tmpDir = path.join(os.tmpdir(), `gaoshi_mem_test_${Date.now()}`);
const MEMORY_DIR = path.join(tmpDir, "memory");

// ── Setup: redirect memory system to temp directory ──
setMemoryDir(MEMORY_DIR);

// Ensure subdirs for project/reference types
fs.mkdirSync(path.join(MEMORY_DIR, "projects"), { recursive: true });
fs.mkdirSync(path.join(MEMORY_DIR, "reference"), { recursive: true });

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// Helper: force-clear the module cache for clean state between tests
function cleanAll() {
  const dirs = [MEMORY_DIR, path.join(MEMORY_DIR, "projects"), path.join(MEMORY_DIR, "reference")];
  for (const d of dirs) {
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d)) {
        try { fs.unlinkSync(path.join(d, f)); } catch {}
      }
    }
  }
  // Reset module-level cache by re-importing — for test isolation we re-set the dir
  setMemoryDir(MEMORY_DIR);
}

// ═══════════════════════════════════════════
// Tokenizer
// ═══════════════════════════════════════════

describe("memory tokenizer", () => {
  it("tokenizes Chinese text into bigrams + single chars", () => {
    const tokens = tokenize("你好世界");
    expect(tokens).toContain("你好");
    expect(tokens).toContain("好世");
    expect(tokens).toContain("世界");
    expect(tokens).toContain("你");
    expect(tokens).toContain("好");
  });

  it("tokenizes English words", () => {
    const tokens = tokenize("hello world test");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });

  it("deduplicates tokens", () => {
    const tokens = tokenize("你好 你好");
    const counts = tokens.filter(t => t === "你好").length;
    expect(counts).toBe(1);
  });

  it("removes punctuation", () => {
    const tokens = tokenize("你好！世界？");
    expect(tokens.every(t => !t.includes("！") && !t.includes("？"))).toBe(true);
  });

  it("handles mixed Chinese-English", () => {
    const tokens = tokenize("AI助手");
    expect(tokens).toContain("ai");
    expect(tokens).toContain("助手");
    expect(tokens).toContain("i助");
  });

  it("handles empty string", () => {
    const tokens = tokenize("");
    expect(tokens).toHaveLength(0);
  });

  it("handles single character", () => {
    const tokens = tokenize("中");
    expect(tokens).toContain("中");
  });
});

// ═══════════════════════════════════════════
// Indexer
// ═══════════════════════════════════════════

describe("memory indexer", () => {
  it("builds and queries index", () => {
    const entries: MemoryEntry[] = [
      { name: "brand-voice", description: "品牌调性说明", type: "project", content: "我们品牌的调性是年轻、活泼、有创意", updatedAt: "2026-01-01T00:00:00Z" },
      { name: "tech-stack", description: "技术栈文档", type: "project", content: "使用 Vue 3 + TypeScript + Hono", updatedAt: "2026-01-02T00:00:00Z" },
      { name: "competitor-x", description: "竞品分析", type: "reference", content: "竞品X主打低价策略", updatedAt: "2026-01-03T00:00:00Z" },
    ];
    buildIndex(entries);

    const results = search("品牌");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("project::brand-voice");
  });

  it("returns empty for no match", () => {
    const entries: MemoryEntry[] = [
      { name: "test", description: "测试", type: "project", content: "一些内容", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    buildIndex(entries);
    const results = search("量子力学");
    expect(results).toHaveLength(0);
  });

  it("returns empty for empty query", () => {
    const entries: MemoryEntry[] = [
      { name: "test", description: "test", type: "project", content: "test", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    buildIndex(entries);
    const results = search("");
    expect(results).toHaveLength(0);
  });

  it("ranks results by score", () => {
    const entries: MemoryEntry[] = [
      { name: "exact-match", description: "品牌策略小红书", type: "project", content: "品牌策略详细分析 小红书平台", updatedAt: "2026-01-01T00:00:00Z" },
      { name: "partial-match", description: "运营策略", type: "project", content: "小红书运营技巧", updatedAt: "2026-01-02T00:00:00Z" },
    ];
    buildIndex(entries);
    const results = search("品牌 小红书");
    expect(results[0].name).toBe("project::exact-match");
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
  });
});

// ═══════════════════════════════════════════
// Manager CRUD
// ═══════════════════════════════════════════

describe("memory manager CRUD", () => {
  it("save and get round-trip", () => {
    cleanAll();
    const entry: MemoryEntry = {
      name: "test-rt", description: "round trip test", type: "user",
      content: "This is my test content. 第二行内容。足够三十个字符的测试数据在这里。", updatedAt: "2026-01-01T00:00:00Z",
    };
    save(entry);
    const loaded = get("test-rt");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test-rt");
    expect(loaded!.type).toBe("user");
    expect(loaded!.content).toBe(entry.content);
  });

  it("get returns null for missing", () => {
    cleanAll();
    expect(get("nonexistent-memory")).toBeNull();
  });

  it("updates existing entry", () => {
    cleanAll();
    const entry: MemoryEntry = {
      name: "update-test", description: "v1", type: "project",
      content: "version 1 with enough content to pass validation check here", updatedAt: "2026-01-01T00:00:00Z",
    };
    save(entry);
    entry.content = "version 2 with enough content to pass validation check here too";
    entry.description = "v2";
    save(entry);
    const loaded = get("update-test");
    expect(loaded!.content).toBe(entry.content);
    expect(loaded!.description).toBe("v2");
  });

  it("remove deletes file", () => {
    cleanAll();
    save({ name: "delete-me", description: "x", type: "reference", content: "x".repeat(30), updatedAt: "" });
    expect(get("delete-me")).not.toBeNull();
    remove("delete-me");
    expect(get("delete-me")).toBeNull();
  });

  it("remove is idempotent", () => {
    remove("never-existed");
  });

  it("loadAll lists entries", () => {
    cleanAll();
    save({ name: "list-a", description: "a", type: "user", content: "a".repeat(30), updatedAt: "" });
    save({ name: "list-b", description: "b", type: "project", content: "b".repeat(30), updatedAt: "" });
    const all = loadAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some(e => e.name === "list-a")).toBe(true);
    expect(all.some(e => e.name === "list-b")).toBe(true);
  });

  it("loadAll returns entries sorted by updatedAt desc", () => {
    cleanAll();
    save({ name: "sort-old", description: "", type: "project", content: "o".repeat(30), updatedAt: "2025-01-01T00:00:00Z" });
    save({ name: "sort-new", description: "", type: "project", content: "n".repeat(30), updatedAt: "2027-01-01T00:00:00Z" });
    const all = loadAll().filter(e => e.name.startsWith("sort-"));
    expect(all[0].name).toBe("sort-new");
    expect(all[1].name).toBe("sort-old");
  });

  it("rejects entries without name or type in frontmatter", () => {
    cleanAll();
    fs.writeFileSync(path.join(MEMORY_DIR, "bad.md"), "no frontmatter here", "utf-8");
    const loaded = get("bad");
    expect(loaded).toBeNull();
  });

  it("saves to type-specific subdirectory", () => {
    cleanAll();
    save({ name: "proj-mem", description: "p", type: "project", content: "p".repeat(30), updatedAt: "" });
    save({ name: "ref-mem", description: "r", type: "reference", content: "r".repeat(30), updatedAt: "" });
    expect(fs.existsSync(path.join(MEMORY_DIR, "projects", "proj-mem.md"))).toBe(true);
    expect(fs.existsSync(path.join(MEMORY_DIR, "reference", "ref-mem.md"))).toBe(true);
  });

  it("rejects content shorter than 30 characters", () => {
    cleanAll();
    const entry: MemoryEntry = {
      name: "too-short", description: "x", type: "project",
      content: "short", updatedAt: "",
    };
    expect(() => save(entry)).toThrow("记忆内容不足");
  });
});

// ═══════════════════════════════════════════
// Expiry
// ═══════════════════════════════════════════

describe("memory expiry", () => {
  it("user memories never expire", () => {
    const entry: MemoryEntry = {
      name: "perm", description: "", type: "user", content: "x",
      updatedAt: "2020-01-01T00:00:00Z",
    };
    expect(isExpired(entry)).toBe(false);
  });

  it("project memories expire after 90 days", () => {
    const fresh: MemoryEntry = { name: "fresh", description: "", type: "project", content: "", updatedAt: new Date().toISOString() };
    const expired: MemoryEntry = { name: "old", description: "", type: "project", content: "", updatedAt: "2020-01-01T00:00:00Z" };
    expect(isExpired(fresh)).toBe(false);
    expect(isExpired(expired)).toBe(true);
  });

  it("reference memories expire after 60 days", () => {
    const fresh: MemoryEntry = { name: "fresh", description: "", type: "reference", content: "", updatedAt: new Date().toISOString() };
    const edge: MemoryEntry = { name: "edge", description: "", type: "reference", content: "", updatedAt: new Date(Date.now() - 59 * 24 * 3600 * 1000).toISOString() };
    expect(isExpired(fresh)).toBe(false);
    expect(isExpired(edge)).toBe(false);
  });

  it("expired entries are removed from disk on loadAll", () => {
    cleanAll();
    const expired: MemoryEntry = {
      name: "expired-proj", description: "", type: "project",
      content: "e".repeat(30),
      updatedAt: "2020-01-01T00:00:00Z",
    };
    // Save directly to disk (bypass validation for expired test entry)
    const p = path.join(MEMORY_DIR, "projects", "expired-proj.md");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      "---",
      "name: expired-proj",
      "description: x",
      "type: project",
      "updatedAt: 2020-01-01T00:00:00Z",
      "---",
      "",
      "e".repeat(30),
      "",
    ].join("\n"));
    const all = loadAll();
    expect(all.some(e => e.name === "expired-proj")).toBe(false);
    expect(fs.existsSync(p)).toBe(false);
  });
});

// ═══════════════════════════════════════════
// Search
// ═══════════════════════════════════════════

describe("memory search", () => {
  it("finds by name keyword", () => {
    cleanAll();
    save({ name: "campaign-2026", description: "年度活动方案", type: "project", content: "c".repeat(30) + " 小红书 抖音 B站", updatedAt: "2026-01-01T00:00:00Z" });
    save({ name: "user-profile", description: "用户画像", type: "user", content: "u".repeat(30), updatedAt: "2026-01-02T00:00:00Z" });
    const results = search("活动");
    expect(results.length).toBeGreaterThan(0);
  });

  it("searches across content and description", () => {
    cleanAll();
    save({ name: "hidden-gem", description: "杂项", type: "reference", content: "reference memory about content strategy " + "小红书投放策略的详细信息在这里", updatedAt: "2026-01-01T00:00:00Z" });
    const results = search("小红书投放");
    expect(results.some(r => r.name === "reference::hidden-gem")).toBe(true);
  });

  it("cross-language search works", () => {
    cleanAll();
    save({ name: "api-docs", description: "API接口文档", type: "reference", content: "REST API endpoints for content management system", updatedAt: "2026-01-01T00:00:00Z" });
    const results = search("API");
    expect(results.some(r => r.name === "reference::api-docs")).toBe(true);
  });
});
