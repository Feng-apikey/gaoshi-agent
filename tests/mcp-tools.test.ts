import { describe, it, expect } from "vitest";
import { appendHashtagsToContent } from "../tools/gaoshi-mcp/server.ts";

// ═══════════════════════════════════════════
// appendHashtagsToContent — tag transformation for draft_save
// ═══════════════════════════════════════════

describe("appendHashtagsToContent", () => {
  it("appends #tags to 小红书 image_text content", () => {
    const out = appendHashtagsToContent("正文内容", ["美食", "旅行"], "小红书", "image_text");
    expect(out).toContain("#美食");
    expect(out).toContain("#旅行");
    expect(out.endsWith("#美食 #旅行")).toBe(true);
  });

  it("appends #tags to 小红书 video content", () => {
    const out = appendHashtagsToContent("正文", ["vlog"], "小红书", "video");
    expect(out.endsWith("#vlog")).toBe(true);
  });

  it("appends #tags to 抖音 image_text content", () => {
    const out = appendHashtagsToContent("正文", ["美食"], "抖音", "image_text");
    expect(out.endsWith("#美食")).toBe(true);
  });

  it("appends #tags to 抖音 video content", () => {
    const out = appendHashtagsToContent("正文", ["日常"], "抖音", "video");
    expect(out.endsWith("#日常")).toBe(true);
  });

  // V19 regression: 抖音长文 has its own topic field, must NOT receive
  // inline hashtags appended to content body.
  it("does NOT append #tags to 抖音 article content (long-form has own topic field)", () => {
    const out = appendHashtagsToContent("这是长文正文", ["美食", "旅行"], "抖音", "article");
    expect(out).toBe("这是长文正文");
    expect(out).not.toContain("#");
  });

  it("does NOT append #tags to 小红书 article content", () => {
    const out = appendHashtagsToContent("小红书长文", ["笔记"], "小红书", "article");
    expect(out).toBe("小红书长文");
    expect(out).not.toContain("#");
  });

  it("does NOT append #tags to B站 video content (uses tags field, not inline)", () => {
    const out = appendHashtagsToContent("B站正文", ["游戏"], "B站", "video");
    expect(out).toBe("B站正文");
    expect(out).not.toContain("#");
  });

  it("preserves existing trailing hashtag line and replaces it", () => {
    // Existing #标签 line should be removed before appending new tags,
    // so the content doesn't accumulate stale hashtags.
    const out = appendHashtagsToContent("正文\n\n#旧标签", ["新标签"], "小红书", "image_text");
    expect(out).not.toContain("#旧标签");
    expect(out).toContain("#新标签");
  });

  it("handles tags already starting with # without doubling", () => {
    const out = appendHashtagsToContent("正文", ["#美食"], "小红书", "image_text");
    expect(out).not.toContain("##美食");
    expect(out).toContain("#美食");
  });

  it("returns content unchanged when tags array is empty", () => {
    const out = appendHashtagsToContent("正文", [], "小红书", "image_text");
    expect(out).toBe("正文");
  });
});
