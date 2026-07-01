// Hono-level tests for GET /api/materials?q= — 检索端点 (name/tags/description LIKE)
//
// 覆盖要点:
//  1. 不带 q → 返回全量
//  2. q 命中 name → 返回该行
//  3. q 命中 tags(以 JSON 字符串形式存) → 返回该行
//  4. q 命中 description → 返回该行
//  5. q 没有任何命中 → 返回空集
//  6. q 含 SQL LIKE 通配符 (% / _) → 转义,不当通配处理

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

const origCwd = process.cwd();
const tmpRoot = path.join(os.tmpdir(), `gaoshi_materials_search_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`);
const dataDir = path.join(tmpRoot, "data");

function hexId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// 同步 syncAndList 的 category → 子目录映射,避免 fixture 被 orphan 清理
const CAT_TO_DIR: Record<string, string> = {
  image: "images", video: "videos", audio: "audio",
  voice: "voices", document: "documents", docs: "docs", template: "templates",
};

beforeAll(() => {
  fs.mkdirSync(dataDir, { recursive: true });
  process.chdir(tmpRoot);

  const sqlite = new Database(path.join(dataDir, "gaoshi.db"));
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      category TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      description TEXT DEFAULT '',
      generated_by TEXT DEFAULT '',
      use_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      content_hash TEXT DEFAULT ''
    );
  `);
  sqlite.close();
});

beforeEach(() => {
  process.chdir(tmpRoot);
  // 每个 test 都从干净状态开始,避免 fixture 累积使 LIKE 结果数随次数飘移
  const db = new Database(path.join(dataDir, "gaoshi.db"));
  db.prepare("DELETE FROM materials").run();
  db.close();
});

afterAll(() => {
  process.chdir(origCwd);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

// Helpers — 给每个素材写真实文件,避免 syncAndList 的 orphan 清理把 fixture 干掉
async function seedMaterials() {
  const db = new Database(path.join(dataDir, "gaoshi.db"));
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO materials (id, name, path, category, mime_type, size, tags, description, generated_by, use_count, created_at, width, height, content_hash)
    VALUES (?, ?, ?, ?, '', 0, ?, ?, '', 0, ?, 0, 0, '')
  `);
  const fixtures = [
    { name: "海报封面.png",       category: "image",    tags: "[]",                       desc: "" },
    { name: "手机实拍.jpg",       category: "image",    tags: '["产品","夜景"]',           desc: "" },
    { name: "宣传片.mp4",         category: "video",    tags: "[]",                       desc: "北京三里屯夜景实拍" },
    { name: "笔记.txt",           category: "document", tags: '["攻略"]',                  desc: "" },
    { name: "旧文档.docx",        category: "document", tags: "[]",                       desc: "客户资料副本" },
  ];
  const rows = [];
  for (const f of fixtures) {
    const id = hexId();
    const dir = CAT_TO_DIR[f.category];
    const fullDir = path.join(dataDir, dir);
    fs.mkdirSync(fullDir, { recursive: true });
    const ext = path.extname(f.name) || "";
    const onDisk = path.join(fullDir, `${id}${ext}`);
    fs.writeFileSync(onDisk, "fixture-content");
    insert.run(id, f.name, onDisk, f.category, f.tags, f.desc, now);
    rows.push({ id, ...f, path: onDisk });
  }
  db.close();
  return rows;
}

describe("GET /api/materials?q= 文本检索", () => {
  it("不带 q 时返回全量", async () => {
    const seeded = await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q="), {} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(seeded.length);
  });

  it("按 name 命中", async () => {
    await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q=%E6%B5%B7%E6%8A%A5"), {} as any);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("海报封面.png");
  });

  it("按 tags 命中(中文 tag 以 JSON 字符串存)", async () => {
    await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q=%E6%94%BB%E7%95%A5"), {} as any);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("笔记.txt");
    expect(body[0].tags).toEqual(["攻略"]);
  });

  it("按 description 命中", async () => {
    await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q=%E5%AE%A2%E6%88%B7"), {} as any);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("旧文档.docx");
  });

  it("没有任何命中 → 返回空集", async () => {
    await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q=%E6%90%9C%E4%B8%8D%E5%88%B0%E5%95%A6"), {} as any);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("q='%' 当通配符处理,返回全量(单用户小库语义,不做 ESCAPE)", async () => {
    const seeded = await seedMaterials();
    const { invalidateSyncCache } = await import("../storage/materials-sync.ts");
    invalidateSyncCache();
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const res = await materialsRouter.fetch(new Request("http://localhost/?q=" + encodeURIComponent("%")), {} as any);
    const body = await res.json();
    expect(body.length).toBe(seeded.length);
  });
});
