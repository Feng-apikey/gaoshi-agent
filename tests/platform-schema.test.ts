import { describe, it, expect } from "vitest";
import { getLimits, PLATFORM_SCHEMA, toLimitsJSON } from "../schemas/platform-schema.ts";

// ═══════════════════════════════════════════
// getLimits — every platform × content-type combo
// ═══════════════════════════════════════════

describe("getLimits", () => {
  it("returns null for unknown platform", () => {
    expect(getLimits("未知平台", "article")).toBeNull();
  });

  it("returns null for unknown content type on known platform", () => {
    expect(getLimits("小红书", "video_with_intro")).toBeNull();
  });

  it("小红书 image_text: 20 title / 1000 body / 18 images / 10 tags", () => {
    const L = getLimits("小红书", "image_text")!;
    expect(L.title).toBe(20);
    expect(L.body).toBe(1000);
    expect(L.maxImages).toBe(18);
    expect(L.maxTags).toBe(10);
    expect(L.aspectRatio).toBe("3:4");
    expect(L.cover).toBe(true);
  });

  it("小红书 video: 20 title, no maxImages (single video field)", () => {
    const L = getLimits("小红书", "video")!;
    expect(L.title).toBe(20);
    expect(L.maxImages).toBeUndefined();
    expect(L.body).toBe(1000);
  });

  it("小红书 article: 64 title (long-form) / 8000 body, no images", () => {
    const L = getLimits("小红书", "article")!;
    expect(L.title).toBe(64);
    expect(L.body).toBe(8000);
    expect(L.maxImages).toBeUndefined();
    expect(L.maxTags).toBeUndefined();
  });

  it("抖音 image_text: 20 title / 1000 body / 35 images / 5 tags", () => {
    const L = getLimits("抖音", "image_text")!;
    expect(L.title).toBe(20);
    expect(L.maxImages).toBe(35);
    expect(L.maxTags).toBe(5);
  });

  it("抖音 video: 30 title (longer than image_text)", () => {
    const L = getLimits("抖音", "video")!;
    expect(L.title).toBe(30);
    expect(L.body).toBe(1000);
    expect(L.aspectRatio).toBe("9:16");
  });

  it("抖音 article: requires minBody 300, abstract 30, header+cover", () => {
    const L = getLimits("抖音", "article")!;
    expect(L.minBody).toBe(300);
    expect(L.abstract).toBe(30);
    expect(L.header).toBe(true);
    expect(L.cover).toBe(true);
    expect(L.body).toBe(8000);
  });

  // Regression guard: 抖音长文 has its own topic field on Douyin's creator center
  // (未在 publish 端实现). Adding maxTags here would re-render the tag input
  // in the draft editor and silently drop the value at publish time.
  // See publish/douyin.ts:262,306 and tests/mcp-tools.test.ts:31-37.
  it("抖音 article has no maxTags (V19 regression guard)", () => {
    const L = getLimits("抖音", "article")!;
    expect(L.maxTags).toBeUndefined();
  });

  it("B站 dynamic: 20 title / 1000 body / 18 images (no abstract)", () => {
    const L = getLimits("B站", "dynamic")!;
    expect(L.title).toBe(20);
    expect(L.body).toBe(1000);
    expect(L.maxImages).toBe(18);
    expect(L.abstract).toBeUndefined();
  });

  it("B站 video: 80 title (longest) / 16:9 / cover required", () => {
    const L = getLimits("B站", "video")!;
    expect(L.title).toBe(80);
    expect(L.body).toBe(2000);
    expect(L.aspectRatio).toBe("16:9");
    expect(L.cover).toBe(true);
  });

  it("B站 article: 30 title / 100000 body (huge — long-form)", () => {
    const L = getLimits("B站", "article")!;
    expect(L.title).toBe(30);
    expect(L.body).toBe(100000);
  });
});

// ═══════════════════════════════════════════
// toLimitsJSON — schema export surface
// ═══════════════════════════════════════════

describe("toLimitsJSON", () => {
  it("emits all platforms", () => {
    const json = toLimitsJSON();
    expect(new Set(Object.keys(json))).toEqual(new Set(["B站", "抖音", "小红书"]));
  });

  it("emits all content types per platform", () => {
    const json = toLimitsJSON();
    expect(new Set(Object.keys(json["小红书"]))).toEqual(new Set(["article", "image_text", "video"]));
    expect(new Set(Object.keys(json["抖音"]))).toEqual(new Set(["article", "image_text", "video"]));
    expect(new Set(Object.keys(json["B站"]))).toEqual(new Set(["article", "dynamic", "video"]));
  });

  it("converts boolean flags to 1", () => {
    const json = toLimitsJSON();
    expect(json["抖音"].article.header).toBe(1);
    expect(json["抖音"].article.cover).toBe(1);
    expect(json["小红书"].image_text.cover).toBe(1);
  });

  it("omits undefined fields", () => {
    const json = toLimitsJSON();
    expect("maxImages" in json["小红书"].article).toBe(false);
    expect("maxTags" in json["B站"].article).toBe(false);
  });
});

// ═══════════════════════════════════════════
// Schema invariants (catch silent edits)
// ═══════════════════════════════════════════

describe("PLATFORM_SCHEMA invariants", () => {
  it("every entry with minBody also has body", () => {
    for (const types of Object.values(PLATFORM_SCHEMA)) {
      for (const def of Object.values(types)) {
        if (def.minBody !== undefined) {
          expect(def.body).toBeDefined();
          expect(def.body!).toBeGreaterThanOrEqual(def.minBody!);
        }
      }
    }
  });

  it("every entry's title is between 1 and 200 chars", () => {
    for (const types of Object.values(PLATFORM_SCHEMA)) {
      for (const def of Object.values(types)) {
        if (def.title !== undefined) {
          expect(def.title).toBeGreaterThanOrEqual(1);
          expect(def.title).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it("抖音 image_text maxImages (35) > 小红书 image_text maxImages (18)", () => {
    // Documents the intentional difference; if you change one, double-check the other.
    const dy = getLimits("抖音", "image_text")!.maxImages!;
    const xhs = getLimits("小红书", "image_text")!.maxImages!;
    expect(dy).toBeGreaterThan(xhs);
  });
});