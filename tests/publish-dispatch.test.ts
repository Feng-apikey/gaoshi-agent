import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all heavy dependencies BEFORE importing publish/index ──
//
// publish() walks through: platform lookup → content_type lookup →
// draft fetch (MCP) → tag validation → material validation → login check
// (Playwright) → action dispatch (Playwright). We mock the browser-touching
// layers (MCP + checkLogin + dispatch) and exercise the pure validation
// branches only.

vi.mock("../mcp/mcp-client.ts", () => ({
  getMCPClientManager: () => ({
    callTool: vi.fn(async (server: string, tool: string, args: any) => {
      if (tool === "draft_get") {
        return mockDraftResponse(args.id);
      }
      return null;
    }),
  }),
}));

// Per-test mockDraftResponse override. Defaults: success with valid content.
let mockDraftResponse: (id: string) => any = () => ({
  id: "draft_test",
  title: "测试",
  content: "正文内容 #标签1 #标签2",
  tags: ["标签1", "标签2"],
  images: [],
  video: "",
  cover: "",
  header: "",
  abstract: "",
  platform: "抖音",
  contentType: "image_text",
});

vi.mock("../publish/douyin.ts", () => ({
  checkLogin: vi.fn(async () => true),
  dispatch: {
    image_text: vi.fn(async () => ({ success: true, message: "已发布" })),
    video: vi.fn(async () => ({ success: true, message: "已发布" })),
    article: vi.fn(async () => ({ success: true, message: "已发布" })),
  },
}));

vi.mock("../publish/bilibili.ts", () => ({
  checkLogin: vi.fn(async () => true),
  dispatch: {
    dynamic: vi.fn(async () => ({ success: true, message: "已发布" })),
    image_text: vi.fn(async () => ({ success: true, message: "已发布" })),
    video: vi.fn(async () => ({ success: true, message: "已发布" })),
    article: vi.fn(async () => ({ success: true, message: "已发布" })),
  },
}));

vi.mock("../publish/xiaohongshu.ts", () => ({
  checkLogin: vi.fn(async () => true),
  dispatch: {
    image_text: vi.fn(async () => ({ success: true, message: "已发布" })),
    video: vi.fn(async () => ({ success: true, message: "已发布" })),
    article: vi.fn(async () => ({ success: true, message: "已发布" })),
  },
}));

const { publish, checkLogin } = await import("../publish/index.ts");

beforeEach(() => {
  vi.clearAllMocks();
  mockDraftResponse = () => ({
    id: "draft_test",
    title: "测试",
    content: "正文内容 #标签1 #标签2",
    tags: ["标签1", "标签2"],
    images: [],
    video: "",
    cover: "",
    header: "",
    abstract: "",
    platform: "抖音",
    contentType: "image_text",
  });
});

// ═══════════════════════════════════════════
// Stage 1: platform lookup
// ═══════════════════════════════════════════

describe("publish — platform_lookup", () => {
  it("rejects unknown platform", async () => {
    const r = await publish("知乎", "article", "draft_test");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("platform_lookup");
    expect(r.message).toContain("不支持的平台");
  });
});

// ═══════════════════════════════════════════
// Stage 2: content_type lookup
// ═══════════════════════════════════════════

describe("publish — content_type_lookup", () => {
  it("rejects unsupported content_type for 抖音", async () => {
    const r = await publish("抖音", "dynamic", "draft_test");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("content_type_lookup");
  });

  it("rejects 'video' for 小红书 article-style (only image_text/video/article allowed)", async () => {
    // 小红书 dispatch has image_text/video/article but not dynamic — fine
    // Use a truly unsupported type to confirm error path
    const r = await publish("小红书", "podcast", "draft_test");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("content_type_lookup");
  });
});

// ═══════════════════════════════════════════
// Stage 3: draft fetch (MCP)
// ═══════════════════════════════════════════

describe("publish — draft_fetch", () => {
  it("rejects when MCP returns error", async () => {
    mockDraftResponse = () => ({ error: "草稿不存在" });
    const r = await publish("抖音", "image_text", "draft_missing");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("draft_fetch");
    expect(r.message).toContain("草稿不存在");
  });

  it("rejects when MCP returns null", async () => {
    mockDraftResponse = () => null;
    const r = await publish("抖音", "image_text", "draft_x");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("draft_fetch");
  });

  it("rejects when draft missing id field", async () => {
    mockDraftResponse = () => ({ title: "x", content: "y" });
    const r = await publish("抖音", "image_text", "draft_x");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("draft_fetch");
    expect(r.message).toContain("id");
  });
});

// ═══════════════════════════════════════════
// Stage 4: tag validation
// ═══════════════════════════════════════════

describe("publish — validate_tags", () => {
  it("rejects 抖音 image_text without inline #tags", async () => {
    mockDraftResponse = () => ({
      id: "d1", title: "t", content: "纯文本内容没有任何标签",
      tags: [], images: [], video: "", cover: "", header: "", abstract: "",
      platform: "抖音", contentType: "image_text",
    });
    const r = await publish("抖音", "image_text", "d1");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("validate_tags");
    expect(r.message).toMatch(/#标签/);
  });

  // V19 regression guard: 抖音长文 has its own topic field, no maxTags.
  // tags 数组为空时 validateTags 应该放过 (返回 stage !== "validate_tags").
  // 见 tests/platform-schema.test.ts:69 + tests/mcp-tools.test.ts:31-37.
  it("passes 抖音 article with empty tags (V19: 独立话题字段)", async () => {
    mockDraftResponse = () => ({
      id: "d1", title: "t", content: "x".repeat(300),
      tags: [], images: [], video: "", cover: "", header: "", abstract: "",
      platform: "抖音", contentType: "article",
    });
    const r = await publish("抖音", "article", "d1");
    expect(r.stage).not.toBe("validate_tags");
  });

  it("rejects B站 video without tags array", async () => {
    mockDraftResponse = () => ({
      id: "d1", title: "t", content: "y",
      tags: [], images: [], video: "mat_x", cover: "", header: "", abstract: "",
      platform: "B站", contentType: "video",
    });
    const r = await publish("B站", "video", "d1");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("validate_tags");
  });

  it("passes tag check when content has inline #tag (login mocked → reach publish_complete)", async () => {
    // Default mockDraftResponse has content with #标签1 #标签2; checkLogin mocked
    // to return true; dispatch.image_text mocked to return success. So the full
    // pipeline runs and we end at publish_complete — proving tag validation
    // did NOT block.
    const douyinMod = await import("../publish/douyin.ts");
    (douyinMod.dispatch.image_text as any).mockResolvedValueOnce({ success: true, message: "mock-done" });
    const r = await publish("抖音", "image_text", "draft_test");
    expect(r.stage).toBe("publish_complete");
    expect(r.success).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Stage 5: login check
// ═══════════════════════════════════════════

describe("publish — login_check", () => {
  it("rejects when 抖音 checkLogin returns false", async () => {
    const douyinMod = await import("../publish/douyin.ts");
    (douyinMod.checkLogin as any).mockResolvedValueOnce(false);
    const r = await publish("抖音", "image_text", "draft_test");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("login_check");
    expect(r.message).toContain("未登录抖音");
  });

  it("rejects when B站 checkLogin returns false", async () => {
    const biliMod = await import("../publish/bilibili.ts");
    (biliMod.checkLogin as any).mockResolvedValueOnce(false);
    const r = await publish("B站", "dynamic", "draft_test");
    expect(r.stage).toBe("login_check");
    expect(r.message).toContain("未登录B站");
  });

  it("rejects when 小红书 checkLogin returns false", async () => {
    const xhsMod = await import("../publish/xiaohongshu.ts");
    (xhsMod.checkLogin as any).mockResolvedValueOnce(false);
    const r = await publish("小红书", "image_text", "draft_test");
    expect(r.stage).toBe("login_check");
    expect(r.message).toContain("未登录小红书");
  });
});

// ═══════════════════════════════════════════
// Stage 6: successful publish (mocked dispatch)
// ═══════════════════════════════════════════

describe("publish — happy path (mocked action)", () => {
  it("reaches dispatch and returns action result for 抖音", async () => {
    const douyinMod = await import("../publish/douyin.ts");
    (douyinMod.dispatch.image_text as any).mockResolvedValueOnce({ success: true, message: "抖音测试成功" });
    const r = await publish("抖音", "image_text", "draft_test");
    expect(r.success).toBe(true);
    expect(r.message).toBe("抖音测试成功");
    expect(douyinMod.dispatch.image_text).toHaveBeenCalledOnce();
  });

  it("reaches dispatch for B站 dynamic", async () => {
    const biliMod = await import("../publish/bilibili.ts");
    (biliMod.dispatch.dynamic as any).mockResolvedValueOnce({ success: true, message: "B站动态成功" });
    const r = await publish("B站", "dynamic", "draft_test");
    expect(r.success).toBe(true);
    expect(biliMod.dispatch.dynamic).toHaveBeenCalledOnce();
  });

  it("reaches dispatch for 小红书 article", async () => {
    const xhsMod = await import("../publish/xiaohongshu.ts");
    (xhsMod.dispatch.article as any).mockResolvedValueOnce({ success: true, message: "小红书长文成功" });
    const r = await publish("小红书", "article", "draft_test");
    expect(r.success).toBe(true);
    expect(xhsMod.dispatch.article).toHaveBeenCalledOnce();
  });

  it("wraps dispatch errors in publish_action stage", async () => {
    const douyinMod = await import("../publish/douyin.ts");
    (douyinMod.dispatch.video as any).mockRejectedValueOnce(new Error("页面卡死"));
    const r = await publish("抖音", "video", "draft_test");
    expect(r.success).toBe(false);
    expect(r.stage).toBe("publish_action");
    expect(r.message).toContain("页面卡死");
  });
});

// ═══════════════════════════════════════════
// checkLogin wrapper
// ═══════════════════════════════════════════

describe("checkLogin wrapper", () => {
  it("rejects unknown platform", async () => {
    const r = await checkLogin("知乎");
    expect(r.success).toBe(false);
    expect(r.message).toContain("不支持的平台");
  });

  it("returns 已登录 when platform checkLogin returns true", async () => {
    const r = await checkLogin("抖音");
    expect(r.success).toBe(true);
    expect(r.message).toBe("已登录");
  });
});