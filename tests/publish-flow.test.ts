// 端到端 publish() 测试 — 覆盖到 validateMaterials 阶段
// 不实际打开浏览器,在 checkLogin 之前所有逻辑全跑通
//
// 策略: spy 真实 douyin/bili/xhs 模块的 checkLogin 和 dispatch,
// 这样 platform/content_type lookup 走真实 dispatch table。

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// ── 在 import 真实模块之前,用 vi.mock 替换网络/浏览器部分 ──
// 但要保留 dispatch 表 (image_text/video/article) 让 lookup 走通
vi.mock("../publish/douyin.ts", async () => {
  const real = await vi.importActual<any>("../publish/douyin.ts");
  return {
    ...real,
    checkLogin: vi.fn(async () => true),           // mock 网络,直接返回已登录
    dispatch: {
      image_text: vi.fn(async () => ({ success: true, message: "(mocked)" })),
      video:      vi.fn(async () => ({ success: true, message: "(mocked)" })),
      article:    vi.fn(async () => ({ success: true, message: "(mocked)" })),
    },
  };
});
vi.mock("../publish/bilibili.ts", async () => {
  const real = await vi.importActual<any>("../publish/bilibili.ts");
  return {
    ...real,
    checkLogin: vi.fn(async () => true),
    dispatch: {
      video:      vi.fn(async () => ({ success: true, message: "(mocked)" })),
      article:    vi.fn(async () => ({ success: true, message: "(mocked)" })),
    },
  };
});
vi.mock("../publish/xiaohongshu.ts", async () => {
  const real = await vi.importActual<any>("../publish/xiaohongshu.ts");
  return {
    ...real,
    checkLogin: vi.fn(async () => true),
    dispatch: {
      image_text: vi.fn(async () => ({ success: true, message: "(mocked)" })),
      video:      vi.fn(async () => ({ success: true, message: "(mocked)" })),
      article:    vi.fn(async () => ({ success: true, message: "(mocked)" })),
    },
  };
});
vi.mock("../mcp/mcp-client.ts", () => ({
  getMCPClientManager: () => ({
    callTool: async (_server: string, _tool: string, args: any) => {
      const Database = (await import("better-sqlite3")).default;
      const dbPath = path.join(process.cwd(), "data", "gaoshi.db");
      const db = new Database(dbPath);
      const row = db.prepare("SELECT * FROM drafts WHERE id = ?").get(args.id) as any;
      db.close();
      if (!row) return { error: "草稿不存在" };
      return {
        id: row.id, title: row.title, content: row.content,
        tags: JSON.parse(row.tags || "[]"),
        images: JSON.parse(row.images || "[]"),
        video: row.video, cover: row.cover, header: row.header,
        abstract: row.abstract,
      };
    },
  }),
}));

// ── 测试环境 ──
const tmpRoot = path.join(os.tmpdir(), `gaoshi_publish_e2e_${Date.now()}`);
const dataDir = path.join(tmpRoot, "data");
const origCwd = process.cwd();

// 随机 hex id 工厂 — fixture 不能再用 a.repeat(16) 这种"占位"字符串,
// 既不像真 hex 又容易跟其他 test 文件冲突 (cross-test 跑时 cccccccccccccccc.png 这种文件就会留下)
function hexId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function seedMaterial(id: string, absPath: string) {
  const db = new Database(path.join(dataDir, "gaoshi.db"));
  db.prepare(`DELETE FROM materials WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO materials
    (id, name, path, category, mime_type, size, tags, description,
     generated_by, use_count, created_at, width, height)
    VALUES (?, ?, ?, 'image', '', 0, '[]', '', '', 0, ?, 0, 0)`)
    .run(id, path.basename(absPath), absPath, new Date().toISOString());
  db.close();
}

function seedDraft(draft: any) {
  const db = new Database(path.join(dataDir, "gaoshi.db"));
  db.prepare(`DELETE FROM drafts WHERE id = ?`).run(draft.id);
  db.prepare(`INSERT INTO drafts
    (id, title, content, tags, platform, content_type, images, video, cover, header, abstract, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      draft.id, draft.title, draft.content,
      JSON.stringify(draft.tags ?? []),
      draft.platform, draft.contentType,
      JSON.stringify(draft.images ?? []),
      draft.video ?? "", draft.cover ?? "", draft.header ?? "",
      draft.abstract ?? "",
      draft.status ?? "draft",
      new Date().toISOString(),
      new Date().toISOString(),
    );
  db.close();
}

beforeAll(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  process.chdir(tmpRoot);

  const sqlite = new Database(path.join(dataDir, "gaoshi.db"));
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      tags TEXT DEFAULT '[]', platform TEXT DEFAULT '小红书', content_type TEXT NOT NULL DEFAULT 'article',
      images TEXT DEFAULT '[]', video TEXT DEFAULT '', cover TEXT DEFAULT '', header TEXT DEFAULT '',
      abstract TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  process.chdir(tmpRoot);
});

afterAll(() => {
  process.chdir(origCwd);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

// ── 现在 import publish, 此时 mocks 已 hoist 完毕 ──
import { publish } from "../publish/index.ts";
import { closeDB } from "../storage/db.ts";

// ═══════════════════════════════════════════
// 端到端 publish() — 反斜杠路径修复的回归保护
// ═══════════════════════════════════════════

describe("publish() 端到端 (validateMaterials 阶段)", () => {
  it("抖音视频:路径含反斜杠时,validateMaterials 通过", async () => {
    closeDB();
    process.chdir(tmpRoot);

    // SSOT: 材料 id 必须是 hex 16 字符; fixture 用 crypto.randomBytes(8).hex
    // 写文件到 tmpRoot 而不是 D:\gaoshi-pure\data\, 不污染用户真实素材库
    const imageId = hexId();
    const videoId = hexId();
    const realImagePath = path.join(dataDir, "images", `${imageId}.png`);
    const realVideoPath = path.join(dataDir, "videos", `${videoId}.mp4`);
    fs.mkdirSync(path.dirname(realImagePath), { recursive: true });
    fs.mkdirSync(path.dirname(realVideoPath), { recursive: true });
    fs.writeFileSync(realImagePath, "fake-image-content");
    fs.writeFileSync(realVideoPath, "fake-video-content");

    seedMaterial(imageId, realImagePath);
    seedMaterial(videoId, realVideoPath);

    seedDraft({
      id: "draft-douyin-1",
      title: "测试视频",
      content: "#美食 #旅行 今天分享一个好玩的地方",
      tags: [],
      platform: "抖音",
      contentType: "video",
      images: [imageId],
      video: videoId,
    });

    const result = await publish("抖音", "video", "draft-douyin-1");

    expect(result.stage).not.toBe("validate_materials");
    expect(result.message).not.toMatch(/素材文件已丢失/);
    expect(result.message).not.toMatch(/素材.*未在素材库中找到/);
  });

  it("小红书图文:含反斜杠的图片路径 validateMaterials 通过", async () => {
    closeDB();
    process.chdir(tmpRoot);

    const imageId = hexId();
    const realImagePath = path.join(dataDir, "images", `${imageId}.png`);
    fs.mkdirSync(path.dirname(realImagePath), { recursive: true });
    fs.writeFileSync(realImagePath, "x");

    seedMaterial(imageId, realImagePath);

    seedDraft({
      id: "draft-xhs-1",
      title: "小红书图文测试",
      content: "#穿搭 今日穿搭分享",
      tags: [],
      platform: "小红书",
      contentType: "image_text",
      images: [imageId],
    });

    const result = await publish("小红书", "image_text", "draft-xhs-1");

    expect(result.stage).not.toBe("validate_materials");
    expect(result.message).not.toMatch(/素材文件已丢失/);
  });

  it("B站视频:含反斜杠的视频路径 validateMaterials 通过", async () => {
    closeDB();
    process.chdir(tmpRoot);

    const videoId = hexId();
    const realVideoPath = path.join(dataDir, "videos", `${videoId}.mp4`);
    fs.mkdirSync(path.dirname(realVideoPath), { recursive: true });
    fs.writeFileSync(realVideoPath, "x");

    seedMaterial(videoId, realVideoPath);

    seedDraft({
      id: "draft-bili-1",
      title: "B站视频测试",
      content: "B站视频描述",
      tags: ["测试", "技术", "分享"],
      platform: "B站",
      contentType: "video",
      video: videoId,
    });

    const result = await publish("B站", "video", "draft-bili-1");

    expect(result.stage).not.toBe("validate_materials");
    expect(result.message).not.toMatch(/素材文件已丢失/);
  });

  it("素材文件不存在时,validateMaterials 正确报错 (负面用例)", async () => {
    closeDB();
    process.chdir(tmpRoot);

    // 不 seed material 也不 seed 文件,只 seed draft 引用了不存在的 ID
    seedDraft({
      id: "draft-missing",
      title: "缺素材测试",
      content: "#测试",
      tags: [],
      platform: "抖音",
      contentType: "image_text",
      images: [hexId()],
    });

    const result = await publish("抖音", "image_text", "draft-missing");

    expect(result.success).toBe(false);
    expect(result.stage).toBe("validate_materials");
    expect(result.message).toMatch(/素材/);
  });

  it("不支持的平台:返回 platform_lookup 阶段错误", async () => {
    closeDB();
    const result = await publish("知乎", "article", "any-id");
    expect(result.success).toBe(false);
    expect(result.stage).toBe("platform_lookup");
  });

  it("不支持的内容类型:返回 content_type_lookup 阶段错误", async () => {
    closeDB();
    const result = await publish("抖音", "live_stream", "any-id");
    expect(result.success).toBe(false);
    expect(result.stage).toBe("content_type_lookup");
  });

  it("抖音视频缺少正文 #标签:返回 validate_tags 阶段错误", async () => {
    closeDB();
    process.chdir(tmpRoot);
    // 内容里完全没有 # 字符 → validateTags 命中
    seedDraft({
      id: "draft-no-tag",
      title: "no tag",
      content: "这条内容没有任何标签",
      tags: [],
      platform: "抖音",
      contentType: "video",
      video: hexId(),
    });
    const result = await publish("抖音", "video", "draft-no-tag");
    expect(result.success).toBe(false);
    expect(result.stage).toBe("validate_tags");
  });
});

// ═══════════════════════════════════════════
// SSOT 防回归: id / path.basename / name 三字段不耦合
// ═══════════════════════════════════════════

import { syncAndList, invalidateSyncCache } from "../storage/materials-sync.ts";

describe("materials SSOT 防回归", () => {
  it("syncAndList 后所有 id 都是 hex 16 字符", async () => {
    closeDB();
    process.chdir(tmpRoot);
    invalidateSyncCache();
    const rows = syncAndList();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("syncAndList 后所有 path.basename = '<id>.<ext>'", async () => {
    closeDB();
    process.chdir(tmpRoot);
    invalidateSyncCache();
    const rows = syncAndList();
    for (const r of rows) {
      const base = path.basename(r.path);
      const ext = path.extname(r.path);
      expect(base).toBe(`${r.id}${ext}`);
    }
  });

  it("PATCH /api/materials/:id 改 body.path 字段返回 400", async () => {
    closeDB();
    process.chdir(tmpRoot);
    invalidateSyncCache();
    const rows = syncAndList();
    expect(rows.length).toBeGreaterThan(0);
    const target = rows[0];

    // 用 fetch 调本地 server (vitest 启 Hono) — 此处直接调 Hono 路由模拟
    const { materialsRouter } = await import("../api/routes/materials.ts");
    const req = new Request(`http://localhost/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "hacker/path.png" }),
    });
    const res = await materialsRouter.fetch(req, {} as any);
    expect(res.status).toBe(400);
  });
});