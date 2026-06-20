import { describe, it, expect } from "vitest";
import { validateDraft } from "../api/validation.ts";

// ═══════════════════════════════════════════
// Content validation (body limits)
// ═══════════════════════════════════════════

describe("validateDraft content limits", () => {
  it("passes content within 小红书 image_text body limit", () => {
    const errors = validateDraft("小红书", "image_text", "短内容");
    expect(errors).toHaveLength(0);
  });

  it("rejects 小红书 image_text content exceeding 1000 chars", () => {
    const errors = validateDraft("小红书", "image_text", "字".repeat(1500));
    expect(errors.some(e => e.field === "content" && e.message.includes("字数超过限制"))).toBe(true);
  });

  it("rejects 小红书 image_text with more than 18 images", () => {
    const content = Array.from({ length: 20 }, (_, i) => `![img${i}](url${i})`).join("\n");
    const errors = validateDraft("小红书", "image_text", content);
    expect(errors.some(e => e.field === "content" && e.message.includes("图片超过限制"))).toBe(true);
  });

  it("allows exactly 18 images for 小红书 image_text", () => {
    const content = Array.from({ length: 18 }, (_, i) => `![img${i}](url${i})`).join("\n");
    const errors = validateDraft("小红书", "image_text", content);
    expect(errors.filter(e => e.field === "content" && e.message.includes("图片")).length).toBe(0);
  });

  it("passes 抖音 article at exactly 8000 chars", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(8000));
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("rejects 抖音 article at 8001 chars", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(8001));
    expect(errors.some(e => e.field === "content" && e.message.includes("字数超过限制"))).toBe(true);
  });

  it("rejects 抖音 article with less than 300 chars (minBody)", () => {
    const errors = validateDraft("抖音", "article", "短".repeat(50));
    expect(errors.some(e => e.field === "content" && e.message.includes("内容不能为空"))).toBe(true);
  });

  it("passes 抖音 article at exactly 300 chars (minBody boundary)", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(300));
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("rejects 抖音 video content exceeding 1000 chars", () => {
    const errors = validateDraft("抖音", "video", "字".repeat(1100));
    expect(errors.some(e => e.field === "content" && e.message.includes("字数超过限制"))).toBe(true);
  });

  it("rejects B站 video body over 2000 chars", () => {
    const errors = validateDraft("B站", "video", "字".repeat(2100));
    expect(errors.some(e => e.field === "content" && e.message.includes("字数超过限制"))).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Title validation
// ═══════════════════════════════════════════

describe("validateDraft title limits", () => {
  it("rejects title over 20 chars for 小红书 image_text", () => {
    const errors = validateDraft("小红书", "image_text", "内容", "二".repeat(25));
    expect(errors.some(e => e.field === "title" && e.message.includes("标题超过限制"))).toBe(true);
  });

  it("passes title exactly 20 chars for 小红书", () => {
    const errors = validateDraft("小红书", "image_text", "内容", "二".repeat(20));
    expect(errors.filter(e => e.field === "title")).toHaveLength(0);
  });

  it("rejects title over 30 chars for 抖音 video", () => {
    const errors = validateDraft("抖音", "video", "内容", "三".repeat(35));
    expect(errors.some(e => e.field === "title")).toBe(true);
  });

  it("rejects title over 30 chars for 抖音 article", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(300), "三".repeat(35));
    expect(errors.some(e => e.field === "title")).toBe(true);
  });

  it("title limit not enforced when title is undefined", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(300));
    expect(errors.filter(e => e.field === "title")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Tags validation
// ═══════════════════════════════════════════

describe("validateDraft tag limits", () => {
  it("rejects more than 10 tags for 小红书 image_text", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `标签${i}`);
    const errors = validateDraft("小红书", "image_text", "内容", undefined, tags);
    expect(errors.some(e => e.field === "tags" && e.message.includes("标签超过限制"))).toBe(true);
  });

  it("allows exactly 10 tags for 小红书", () => {
    const tags = Array.from({ length: 10 }, (_, i) => `标签${i}`);
    const errors = validateDraft("小红书", "image_text", "内容", undefined, tags);
    expect(errors.filter(e => e.field === "tags")).toHaveLength(0);
  });

  it("rejects more than 5 tags for 抖音", () => {
    const tags = ["a", "b", "c", "d", "e", "f"];
    const errors = validateDraft("抖音", "image_text", "内容", undefined, tags);
    expect(errors.some(e => e.field === "tags")).toBe(true);
  });

  it("tag limit not enforced when tags is undefined", () => {
    const errors = validateDraft("小红书", "image_text", "内容");
    expect(errors.filter(e => e.field === "tags")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Abstract validation
// ═══════════════════════════════════════════

describe("validateDraft abstract limits", () => {
  it("rejects abstract over 30 chars for 抖音 article", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(300), "标题", undefined, "四".repeat(35));
    expect(errors.some(e => e.field === "abstract" && e.message.includes("摘要超过限制"))).toBe(true);
  });

  it("passes abstract exactly 30 chars for 抖音 article", () => {
    const errors = validateDraft("抖音", "article", "字".repeat(300), "标题", undefined, "四".repeat(30));
    expect(errors.filter(e => e.field === "abstract")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════

describe("validateDraft edge cases", () => {
  it("returns empty for unknown platform", () => {
    expect(validateDraft("未知平台", "article", "x".repeat(100000))).toHaveLength(0);
  });

  it("returns empty for unknown content type in known platform", () => {
    expect(validateDraft("小红书", "unknown_type", "x".repeat(100000))).toHaveLength(0);
  });

  it("counts HTML img tags as images", () => {
    const content = '<img src="a.jpg"><img src="b.jpg">'.repeat(10);
    const errors = validateDraft("小红书", "image_text", content);
    expect(errors.some(e => e.message.includes("图片超过限制"))).toBe(true);
  });

  it("whitespace is stripped from content char count", () => {
    // 1000 chars of actual content + lots of whitespace
    const content = "字".repeat(999) + " \n\r\t  ";
    const errors = validateDraft("小红书", "image_text", content);
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("returns multiple errors when multiple fields violated", () => {
    const errors = validateDraft(
      "抖音", "article",
      "字".repeat(9000), // body exceeds 8000
      "三".repeat(40),   // title exceeds 30
      ["a", "b", "c", "d", "e", "f"], // tags exceeds 5
      "四".repeat(40)    // abstract exceeds 30
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("B站 dynamic allows 1000 chars", () => {
    const errors = validateDraft("B站", "dynamic", "字".repeat(1000));
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("B站 dynamic rejects 1001 chars", () => {
    const errors = validateDraft("B站", "dynamic", "字".repeat(1001));
    expect(errors.some(e => e.field === "content")).toBe(true);
  });

  it("empty content with minBody constraint triggers error", () => {
    const errors = validateDraft("抖音", "article", "");
    expect(errors.some(e => e.field === "content" && e.message.includes("内容不能为空"))).toBe(true);
  });
});
