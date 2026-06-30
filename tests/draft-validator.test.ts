import { describe, it, expect } from "vitest";
import { validateDraftFields } from "../publish/draft-validator.ts";

// ═══════════════════════════════════════════
// Unknown platform / content type
// ═══════════════════════════════════════════

describe("validateDraftFields — unknown inputs", () => {
  it("returns _root error for unknown platform", () => {
    const errs = validateDraftFields({
      platform: "知乎",
      contentType: "article",
      content: "x".repeat(500),
    });
    expect(errs).toHaveLength(1);
    expect(errs[0].field).toBe("_root");
    expect(errs[0].message).toContain("知乎");
  });

  it("returns _root error for unknown content type on known platform", () => {
    const errs = validateDraftFields({
      platform: "小红书",
      contentType: "podcast",
      content: "x".repeat(500),
    });
    expect(errs[0].field).toBe("_root");
    expect(errs[0].message).toContain("podcast");
  });

  it("lists valid platforms in the error message", () => {
    const errs = validateDraftFields({
      platform: "知乎",
      contentType: "article",
      content: "x",
    });
    // Message should hint at the valid enum so LLM can self-correct
    expect(errs[0].message).toMatch(/抖音.*B站.*小红书|抖音\/B站\/小红书/);
  });
});

// ═══════════════════════════════════════════
// Title validation
// ═══════════════════════════════════════════

describe("validateDraftFields — title", () => {
  it("flags title over limit for 抖音 image_text (max 20)", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      title: "x".repeat(25),
      content: "正文",
    });
    expect(errs.some(e => e.field === "title")).toBe(true);
    expect(errs.find(e => e.field === "title")?.message).toMatch(/20/);
  });

  it("passes title at exactly the limit", () => {
    expect(validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      title: "x".repeat(20),
      content: "正文",
    })).toHaveLength(0);
  });

  it("skips title check when title is undefined (partial update)", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      content: "正文",
      // title intentionally omitted
    });
    expect(errs.filter(e => e.field === "title")).toHaveLength(0);
  });

  it("flags title over 30 for 抖音 article (max 30)", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "article",
      title: "x".repeat(35),
      content: "y".repeat(300),
    });
    expect(errs.some(e => e.field === "title")).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Content validation (minBody / body / images)
// ═══════════════════════════════════════════

describe("validateDraftFields — content", () => {
  it("flags 抖音 article below minBody (300)", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "article",
      content: "x".repeat(100),
    });
    expect(errs.some(e => e.field === "content" && /不能为空|最少/.test(e.message))).toBe(true);
  });

  it("passes 抖音 article at exactly minBody boundary", () => {
    expect(validateDraftFields({
      platform: "抖音",
      contentType: "article",
      content: "x".repeat(300),
    }).filter(e => e.field === "content")).toHaveLength(0);
  });

  it("flags 抖音 image_text over body limit (1000)", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      content: "x".repeat(1100),
    });
    expect(errs.some(e => e.field === "content" && /字数超过/.test(e.message))).toBe(true);
  });

  it("flags 抖音 image_text with too many markdown images", () => {
    const content = Array.from({ length: 40 }, (_, i) => `![img](http://x.com/${i})`).join("\n");
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      content,
    });
    expect(errs.some(e => e.field === "content" && /图片超过/.test(e.message))).toBe(true);
  });

  it("strips content errors when content is undefined (partial update)", () => {
    // Even though 抖音 article has minBody 300, partial-update shouldn't
    // complain about content because caller didn't touch it.
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "article",
      title: "新标题",
      // content intentionally omitted
    });
    expect(errs.filter(e => e.field === "content")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Tags validation
// ═══════════════════════════════════════════

describe("validateDraftFields — tags", () => {
  it("flags 抖音 image_text with > 5 tags", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      tags: ["a", "b", "c", "d", "e", "f"],
      content: "正文",
    });
    expect(errs.some(e => e.field === "tags")).toBe(true);
  });

  it("passes at boundary (5 tags)", () => {
    expect(validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      tags: ["a", "b", "c", "d", "e"],
      content: "正文",
    }).filter(e => e.field === "tags")).toHaveLength(0);
  });

  it("passes when tags is undefined (no tag check)", () => {
    expect(validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      content: "正文",
    }).filter(e => e.field === "tags")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Abstract validation
// ═══════════════════════════════════════════

describe("validateDraftFields — abstract", () => {
  it("flags 抖音 article abstract over 30 chars", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "article",
      abstract: "x".repeat(40),
      content: "y".repeat(300),
    });
    expect(errs.some(e => e.field === "abstract")).toBe(true);
  });

  it("passes abstract at boundary", () => {
    expect(validateDraftFields({
      platform: "抖音",
      contentType: "article",
      abstract: "x".repeat(30),
      content: "y".repeat(300),
    }).filter(e => e.field === "abstract")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Multi-field aggregation (real-world LLM output)
// ═══════════════════════════════════════════

describe("validateDraftFields — multi-field failures", () => {
  it("returns ALL violations in one shot (not just first)", () => {
    // Use 抖音 image_text which has all four limits active (title 20,
    // body 1000, maxImages 35, maxTags 5) — article lacks maxTags.
    const content = "x".repeat(1100);  // over body limit
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      title: "x".repeat(25),    // over 20
      content,
      tags: ["a", "b", "c", "d", "e", "f"], // over 5
    });
    const fields = new Set(errs.map(e => e.field));
    expect(fields.has("title")).toBe(true);
    expect(fields.has("content")).toBe(true);
    expect(fields.has("tags")).toBe(true);
  });

  it("error messages contain the numeric limit for LLM parsing", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      title: "x".repeat(25),
      content: "正文",
    });
    const titleErr = errs.find(e => e.field === "title")!;
    // LLM should be able to extract 25 (current) and 20 (max) from message
    expect(titleErr.message).toMatch(/25/);
    expect(titleErr.message).toMatch(/20/);
  });
});

// ═══════════════════════════════════════════
// Shape contract — what LLM will receive
// ═══════════════════════════════════════════

describe("validateDraftFields — error shape", () => {
  it("every error has field and message string", () => {
    const errs = validateDraftFields({
      platform: "抖音",
      contentType: "image_text",
      title: "x".repeat(25),
      content: "正文",
      tags: ["a", "b", "c", "d", "e", "f"],
    });
    for (const e of errs) {
      expect(typeof e.field).toBe("string");
      expect(typeof e.message).toBe("string");
      expect(e.field.length).toBeGreaterThan(0);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════
// Material images array validation
// ═══════════════════════════════════════════

describe("validateDraftFields — material images array", () => {
  it("flags 小红书 image_text with > 18 material IDs", () => {
    const images = Array.from({ length: 19 }, (_, i) => `img_${i}`);
    const errs = validateDraftFields({
      platform: "小红书",
      contentType: "image_text",
      content: "正文",
      images,
    });
    expect(errs.some(e => e.field === "images" && /18/.test(e.message))).toBe(true);
  });

  it("passes 小红书 image_text with exactly 18 material IDs", () => {
    const images = Array.from({ length: 18 }, (_, i) => `img_${i}`);
    const errs = validateDraftFields({
      platform: "小红书",
      contentType: "image_text",
      content: "正文",
      images,
    });
    expect(errs.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("skips material images check when images is undefined", () => {
    // Partial update that doesn't touch images shouldn't flag this field.
    const errs = validateDraftFields({
      platform: "小红书",
      contentType: "image_text",
      content: "正文",
      title: "新标题",
      // images intentionally omitted
    });
    expect(errs.filter(e => e.field === "images")).toHaveLength(0);
  });
});