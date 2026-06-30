import { describe, it, expect } from "vitest";
import { validateDraft } from "../api/validation.ts";
import { validateDraftFields } from "../publish/draft-validator.ts";
import { getLimits, PLATFORM_SCHEMA, toLimitsJSON } from "../schemas/platform-schema.ts";
import { appendHashtagsToContent } from "../tools/gaoshi-mcp/server.ts";

// ════════════════════════════════════════════════════════════════════════════
// Draft format validation — schema-driven test suite
// ════════════════════════════════════════════════════════════════════════════
//
// 这套测试把 PLATFORM_SCHEMA 当作"被测输入",自动覆盖每个平台×内容类型
// 的所有字段限制。改 schema 加新平台或新字段时,只需要更新 fixtures;
// 测试用例本身会跟着 schema 演化。
//
// 覆盖范围:
//   1. 每个 platform × content_type 组合的 baseline(空内容/刚好满足限制)
//   2. 每个字段超限 1 字符/1 张图/1 个标签 的边界测试
//   3. 修复回归:V7(unknown combo)、V14(images 数组)、V19(标签分支)
//   4. 错误结构:field 名 + message 含数字(LLM 可解析)
// ════════════════════════════════════════════════════════════════════════════

// 工具:把 schema 元数据抽成可用的 fixtures
interface LimitSnapshot {
  platform: string;
  contentType: string;
  title?: number;
  body?: number;
  minBody?: number;
  maxImages?: number;
  maxTags?: number;
  abstract?: number;
}

function snapshotAll(): LimitSnapshot[] {
  const out: LimitSnapshot[] = [];
  for (const [platform, types] of Object.entries(PLATFORM_SCHEMA)) {
    for (const [contentType, def] of Object.entries(types)) {
      out.push({ platform, contentType, ...def });
    }
  }
  return out;
}

// 工具:校验并按 field 分组
function errorsByField(errors: Array<{ field: string; message: string }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of errors) {
    if (!map.has(e.field)) map.set(e.field, []);
    map.get(e.field)!.push(e.message);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Schema 元数据自检 (catch silent edits)
// ─────────────────────────────────────────────────────────────────────

describe("PLATFORM_SCHEMA — invariants", () => {
  it("every entry with minBody also has body (and body ≥ minBody)", () => {
    for (const s of snapshotAll()) {
      if (s.minBody !== undefined) {
        expect(s.body, `${s.platform}/${s.contentType}: minBody requires body`).toBeDefined();
        expect(s.body!, `${s.platform}/${s.contentType}: body ≥ minBody`).toBeGreaterThanOrEqual(s.minBody!);
      }
    }
  });

  it("every title limit is in [1, 200]", () => {
    for (const s of snapshotAll()) {
      if (s.title !== undefined) {
        expect(s.title, `${s.platform}/${s.contentType}: title`).toBeGreaterThanOrEqual(1);
        expect(s.title, `${s.platform}/${s.contentType}: title`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("every body limit is in [100, 100000]", () => {
    for (const s of snapshotAll()) {
      if (s.body !== undefined) {
        expect(s.body, `${s.platform}/${s.contentType}: body`).toBeGreaterThanOrEqual(100);
        expect(s.body, `${s.platform}/${s.contentType}: body`).toBeLessThanOrEqual(100000);
      }
    }
  });

  it("every maxImages is in [1, 100]", () => {
    for (const s of snapshotAll()) {
      if (s.maxImages !== undefined) {
        expect(s.maxImages, `${s.platform}/${s.contentType}: maxImages`).toBeGreaterThanOrEqual(1);
        expect(s.maxImages, `${s.platform}/${s.contentType}: maxImages`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("every maxTags is in [0, 50]", () => {
    for (const s of snapshotAll()) {
      if (s.maxTags !== undefined) {
        expect(s.maxTags, `${s.platform}/${s.contentType}: maxTags`).toBeGreaterThanOrEqual(0);
        expect(s.maxTags, `${s.platform}/${s.contentType}: maxTags`).toBeLessThanOrEqual(50);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. 每种 platform × content_type 的 baseline 测试
// ─────────────────────────────────────────────────────────────────────

describe("validateDraft — baseline pass for every platform × content_type", () => {
  for (const s of snapshotAll()) {
    it(`${s.platform}/${s.contentType} — minimum valid input passes`, () => {
      // 构造"恰好满足限制"的最小输入
      const title = s.title !== undefined ? "标题" : undefined;
      const content = "字".repeat(s.minBody ?? 1);
      const tags = s.maxTags !== undefined ? ["标签"] : undefined;
      const abstract = s.abstract !== undefined ? "摘要" : undefined;
      const images = s.maxImages !== undefined ? ["mat_1"] : undefined;

      const errors = validateDraft(
        s.platform, s.contentType, content,
        title, tags, abstract, images,
      );
      const fields = errorsByField(errors);

      // 不能有 _root 错(说明 platform/contentType 合法)
      expect(fields.has("_root"), `${s.platform}/${s.contentType}: _root 错=${JSON.stringify(errors)}`).toBe(false);
      // 不能有 title/body/content 错(都是最小合法值)
      expect(fields.has("title"), `${s.platform}/${s.contentType}: 不应报 title=${JSON.stringify(errors)}`).toBe(false);
      expect(fields.has("content"), `${s.platform}/${s.contentType}: 不应报 content=${JSON.stringify(errors)}`).toBe(false);
      // 不能有 images/tags/abstract 错
      expect(fields.has("images"), `${s.platform}/${s.contentType}: 不应报 images=${JSON.stringify(errors)}`).toBe(false);
      expect(fields.has("tags"), `${s.platform}/${s.contentType}: 不应报 tags=${JSON.stringify(errors)}`).toBe(false);
      expect(fields.has("abstract"), `${s.platform}/${s.contentType}: 不应报 abstract=${JSON.stringify(errors)}`).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 3. 边界:每个字段超限 1,必报对应 field
// ─────────────────────────────────────────────────────────────────────

describe("validateDraft — boundary check (over-limit by 1)", () => {
  for (const s of snapshotAll()) {
    if (s.title !== undefined) {
      it(`${s.platform}/${s.contentType} — title over by 1 → flags "title"`, () => {
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.minBody ?? 1),
          "字".repeat(s.title + 1),
        );
        const fields = errorsByField(errors);
        expect(fields.has("title")).toBe(true);
        // 错误消息必须含上限数字,LLM 才能 parse
        expect(fields.get("title")![0]).toContain(String(s.title + 1));
        expect(fields.get("title")![0]).toContain(String(s.title));
      });
    }

    if (s.body !== undefined) {
      it(`${s.platform}/${s.contentType} — body over by 1 → flags "content"`, () => {
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.body + 1),
        );
        const fields = errorsByField(errors);
        expect(fields.has("content")).toBe(true);
        expect(fields.get("content")![0]).toMatch(/字数超过/);
      });
    }

    if (s.minBody !== undefined) {
      it(`${s.platform}/${s.contentType} — body under minBody → flags "content"`, () => {
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.minBody - 1),
        );
        const fields = errorsByField(errors);
        expect(fields.has("content")).toBe(true);
        expect(fields.get("content")![0]).toMatch(/内容不能为空|最少/);
      });
    }

    if (s.maxImages !== undefined) {
      it(`${s.platform}/${s.contentType} — material images over by 1 → flags "images"`, () => {
        const images = Array.from({ length: s.maxImages + 1 }, (_, i) => `img_${i}`);
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.minBody ?? 1),
          undefined, undefined, undefined,
          images,
        );
        const fields = errorsByField(errors);
        expect(fields.has("images"), `${s.platform}/${s.contentType}: 应报 images,实际=${JSON.stringify(errors)}`).toBe(true);
        expect(fields.get("images")![0]).toContain(String(s.maxImages + 1));
      });
    }

    if (s.maxTags !== undefined) {
      it(`${s.platform}/${s.contentType} — tags over by 1 → flags "tags"`, () => {
        const tags = Array.from({ length: s.maxTags + 1 }, (_, i) => `tag_${i}`);
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.minBody ?? 1),
          undefined, tags,
        );
        const fields = errorsByField(errors);
        expect(fields.has("tags")).toBe(true);
      });
    }

    if (s.abstract !== undefined) {
      it(`${s.platform}/${s.contentType} — abstract over by 1 → flags "abstract"`, () => {
        const errors = validateDraft(
          s.platform, s.contentType,
          "字".repeat(s.minBody ?? 1),
          "标题", undefined,
          "字".repeat(s.abstract + 1),
        );
        const fields = errorsByField(errors);
        expect(fields.has("abstract")).toBe(true);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4. inline 图片 vs material ID 数组 双重校验
// ─────────────────────────────────────────────────────────────────────

describe("validateDraft — inline content images vs material ID array", () => {
  it("小红书 image_text: inline 18 张 + 0 material ID 通过", () => {
    const content = Array.from({ length: 18 }, (_, i) => `![i](u${i})`).join("\n");
    const errors = validateDraft("小红书", "image_text", content, undefined, undefined, undefined, []);
    expect(errors.filter(e => e.field === "content" && /图片/.test(e.message))).toHaveLength(0);
    expect(errors.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("小红书 image_text: inline 19 张 + 0 material ID 报 content 字段", () => {
    const content = Array.from({ length: 19 }, (_, i) => `![i](u${i})`).join("\n");
    const errors = validateDraft("小红书", "image_text", content, undefined, undefined, undefined, []);
    expect(errors.some(e => e.field === "content" && /图片超过/.test(e.message))).toBe(true);
  });

  it("小红书 image_text: inline 0 张 + 19 material ID 报 images 字段", () => {
    const images = Array.from({ length: 19 }, (_, i) => `img_${i}`);
    const errors = validateDraft("小红书", "image_text", "纯文本", undefined, undefined, undefined, images);
    expect(errors.some(e => e.field === "images" && /图片超过/.test(e.message))).toBe(true);
  });

  it("小红书 image_text: inline 19 张 + material 19 张,两个字段各自超限 → 两个错都报", () => {
    // 校验是分别独立的(inline vs material ID 数组),不交叉累加
    // 各自超 → 各自报错,字段分别是 content 和 images
    const inline = Array.from({ length: 19 }, (_, i) => `![i](u${i})`).join("\n");
    const images = Array.from({ length: 19 }, (_, i) => `img_${i}`);
    const errors = validateDraft("小红书", "image_text", inline, undefined, undefined, undefined, images);
    const fields = errorsByField(errors);
    expect(fields.has("content")).toBe(true);
    expect(fields.has("images")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. V7 回归:unknown platform / content_type → _root 错误
// ─────────────────────────────────────────────────────────────────────

describe("V7 regression — unknown platform/contentType returns _root error", () => {
  const unknownCases = [
    { platform: "知乎", contentType: "article" },
    { platform: "微博", contentType: "image_text" },
    { platform: "公众号", contentType: "article" },
    { platform: "头条号", contentType: "video" },
    { platform: "小红书", contentType: "podcast" },        // 已知平台,未知 type
    { platform: "抖音", contentType: "dynamic" },           // 已知平台,未知 type
    { platform: "B站", contentType: "live_stream" },        // 已知平台,未知 type
    { platform: "", contentType: "article" },                // 空字符串
  ];

  for (const c of unknownCases) {
    it(`platform="${c.platform}" contentType="${c.contentType}" → _root`, () => {
      const errors = validateDraft(c.platform, c.contentType, "正常内容");
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("_root");
      expect(errors[0].message).toMatch(/未知平台/);
    });

    it(`validateDraftFields also surfaces _root for "${c.platform}/${c.contentType}"`, () => {
      const errors = validateDraftFields({
        platform: c.platform, contentType: c.contentType, content: "正常内容",
      });
      expect(errors.some(e => e.field === "_root")).toBe(true);
    });
  }

  it("_root 错误 message 含合法 platform 列表,LLM 可自我修正", () => {
    const errors = validateDraft("知乎", "article", "x");
    expect(errors[0].message).toMatch(/抖音.*B站.*小红书|抖音\/B站\/小红书/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. V14 回归:material images 数组校验
// ─────────────────────────────────────────────────────────────────────

describe("V14 regression — material images array length check", () => {
  it("小红书 image_text: 18 张 ID 边界通过", () => {
    const images = Array.from({ length: 18 }, (_, i) => `i${i}`);
    const errors = validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, images);
    expect(errors.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("小红书 image_text: 19 张 ID 报 images 字段", () => {
    const images = Array.from({ length: 19 }, (_, i) => `i${i}`);
    const errors = validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, images);
    expect(errors.some(e => e.field === "images" && /19.*18/.test(e.message))).toBe(true);
  });

  it("抖音 image_text: 35 张 ID 通过(上限定制)", () => {
    const images = Array.from({ length: 35 }, (_, i) => `i${i}`);
    const errors = validateDraft("抖音", "image_text", "x", undefined, undefined, undefined, images);
    expect(errors.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("抖音 image_text: 36 张 ID 报错", () => {
    const images = Array.from({ length: 36 }, (_, i) => `i${i}`);
    const errors = validateDraft("抖音", "image_text", "x", undefined, undefined, undefined, images);
    expect(errors.some(e => e.field === "images")).toBe(true);
  });

  it("B站 video: 50 张 images 不报(无 maxImages 限制)", () => {
    const images = Array.from({ length: 50 }, (_, i) => `i${i}`);
    const errors = validateDraft("B站", "video", "x", undefined, undefined, undefined, images);
    expect(errors.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("小红书 article: 50 张 images 不报(article 不支持 images 字段)", () => {
    const images = Array.from({ length: 50 }, (_, i) => `i${i}`);
    const errors = validateDraft("小红书", "article", "x".repeat(100), undefined, undefined, undefined, images);
    expect(errors.filter(e => e.field === "images")).toHaveLength(0);
  });

  it("空字符串 / 空数组 / undefined 都视为未提供 images,不报错", () => {
    expect(validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, undefined).filter(e => e.field === "images")).toHaveLength(0);
    expect(validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, []).filter(e => e.field === "images")).toHaveLength(0);
    expect(validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, ["", "", ""]).filter(e => e.field === "images")).toHaveLength(0);
  });

  it("images 数组超 limit 报错同时,字数超 limit 也独立报错(多错聚合)", () => {
    const images = Array.from({ length: 50 }, (_, i) => `i${i}`);
    const errors = validateDraft("小红书", "image_text", "x".repeat(2000), undefined, undefined, undefined, images);
    const fields = errorsByField(errors);
    expect(fields.has("images")).toBe(true);
    expect(fields.has("content")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. validateDraftFields — partial update 语义
// ─────────────────────────────────────────────────────────────────────

describe("validateDraftFields — partial update semantics", () => {
  it("content === undefined 时,不报 content 字段错(哪怕有 minBody)", () => {
    // 抖音 article 要求 minBody 300,但 partial update 只改 title 不应报错
    const errors = validateDraftFields({
      platform: "抖音", contentType: "article", title: "新标题",
    });
    expect(errors.filter(e => e.field === "content")).toHaveLength(0);
  });

  it("content === undefined 时,其它字段错仍正常报", () => {
    const errors = validateDraftFields({
      platform: "小红书", contentType: "image_text", title: "x".repeat(100),
    });
    expect(errors.some(e => e.field === "title")).toBe(true);
  });

  it("content 传了则所有字段都查(完整模式)", () => {
    const errors = validateDraftFields({
      platform: "抖音", contentType: "article",
      content: "字".repeat(50),  // 低于 minBody
    });
    expect(errors.some(e => e.field === "content" && /不能为空/.test(e.message))).toBe(true);
  });

  it("全部字段都传时,multi-field 错误聚合返回", () => {
    const errors = validateDraftFields({
      platform: "抖音", contentType: "image_text",
      title: "x".repeat(50),     // 超 20
      content: "x".repeat(2000), // 超 1000
      tags: ["a", "b", "c", "d", "e", "f", "g"], // 超 5
    });
    const fields = errorsByField(errors);
    expect(fields.has("title")).toBe(true);
    expect(fields.has("content")).toBe(true);
    expect(fields.has("tags")).toBe(true);
  });

  it("未知 platform 不区分 contentType 是否传入,都报 _root", () => {
    const a = validateDraftFields({ platform: "知乎", contentType: "article", content: "x" });
    const b = validateDraftFields({ platform: "知乎", contentType: "article" });
    expect(a.some(e => e.field === "_root")).toBe(true);
    expect(b.some(e => e.field === "_root")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. V19 回归:抖音 article 不进 inline #tags 分支
// ─────────────────────────────────────────────────────────────────────

describe("V19 regression — appendHashtagsToContent per platform×type", () => {
  // Matrix:每种平台×类型 → 是否应该往 content 追加 #tags
  const shouldAppend: Array<[string, string, boolean]> = [
    ["小红书", "image_text", true],
    ["小红书", "video", true],
    ["小红书", "article", false],
    ["抖音", "image_text", true],
    ["抖音", "video", true],
    ["抖音", "article", false],     // V19 修复点:抖音长文用独立话题字段
    ["B站", "video", false],
    ["B站", "dynamic", false],
    ["B站", "article", false],
  ];

  for (const [platform, contentType, expectAppend] of shouldAppend) {
    it(`${platform}/${contentType} → ${expectAppend ? "追加" : "不追加"} #tags`, () => {
      const out = appendHashtagsToContent("原文内容", ["美食", "旅行"], platform, contentType);
      const hasHash = out.includes("#美食");
      if (expectAppend) {
        expect(hasHash, `${platform}/${contentType} 应追加 #tags,实际=${out}`).toBe(true);
      } else {
        expect(hasHash, `${platform}/${contentType} 不应追加 #tags,实际=${out}`).toBe(false);
        expect(out, `${platform}/${contentType} content 应不变`).toBe("原文内容");
      }
    });
  }

  it("已有 #标签 行被替换而非累积", () => {
    const out = appendHashtagsToContent("原文\n\n#旧标签", ["新标签"], "小红书", "image_text");
    expect(out).not.toContain("#旧标签");
    expect(out).toContain("#新标签");
  });

  it("tags 已有 # 前缀不重复添加", () => {
    const out = appendHashtagsToContent("原文", ["#美食"], "小红书", "image_text");
    expect(out).not.toContain("##美食");
  });

  it("空 tags 数组不改 content", () => {
    expect(appendHashtagsToContent("原文", [], "小红书", "image_text")).toBe("原文");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. 错误消息格式:L 可解析数字
// ─────────────────────────────────────────────────────────────────────

describe("validateDraft — error messages are LLM-parseable", () => {
  it("title 错误含 '当前/上限' 两个数字", () => {
    const errors = validateDraft("小红书", "image_text", "x", "字".repeat(25));
    const titleErr = errors.find(e => e.field === "title")!;
    expect(titleErr.message).toMatch(/25/);  // 当前
    expect(titleErr.message).toMatch(/20/);  // 上限
  });

  it("content 字数超限错误含 '当前/上限'", () => {
    const errors = validateDraft("小红书", "image_text", "字".repeat(1100));
    const bodyErr = errors.find(e => e.field === "content" && /字数超过/.test(e.message))!;
    expect(bodyErr.message).toMatch(/1100/);
    expect(bodyErr.message).toMatch(/1000/);
  });

  it("images 数组超限错误含数字", () => {
    const images = Array.from({ length: 50 }, (_, i) => `i${i}`);
    const errors = validateDraft("小红书", "image_text", "x", undefined, undefined, undefined, images);
    const imgErr = errors.find(e => e.field === "images")!;
    expect(imgErr.message).toMatch(/50/);
    expect(imgErr.message).toMatch(/18/);
  });

  it("每个 error 都有 field + message 字段且非空", () => {
    const errors = validateDraft("小红书", "image_text", "字".repeat(2000), "字".repeat(50));
    for (const e of errors) {
      expect(typeof e.field).toBe("string");
      expect(e.field.length).toBeGreaterThan(0);
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. toLimitsJSON 输出契约(给前端 UI 用)
// ─────────────────────────────────────────────────────────────────────

describe("toLimitsJSON — output contract for UI consumption", () => {
  it("输出所有 platform", () => {
    const json = toLimitsJSON();
    expect(new Set(Object.keys(json))).toEqual(new Set(["小红书", "抖音", "B站"]));
  });

  it("每种 platform 输出对应 content_type", () => {
    const json = toLimitsJSON();
    expect(new Set(Object.keys(json["小红书"]))).toEqual(new Set(["image_text", "video", "article"]));
    expect(new Set(Object.keys(json["抖音"]))).toEqual(new Set(["image_text", "video", "article"]));
    expect(new Set(Object.keys(json["B站"]))).toEqual(new Set(["video", "dynamic", "article"]));
  });

  it("schema 中的数字字段原样输出", () => {
    const json = toLimitsJSON();
    expect(json["小红书"].image_text.title).toBe(20);
    expect(json["小红书"].image_text.body).toBe(1000);
    expect(json["小红书"].image_text.maxImages).toBe(18);
    expect(json["抖音"].article.minBody).toBe(300);
    expect(json["抖音"].article.abstract).toBe(30);
    expect(json["B站"].video.title).toBe(80);
  });

  it("undefined 字段不出现在输出里(节省前端 type 定义)", () => {
    const json = toLimitsJSON();
    expect("maxImages" in json["小红书"].article).toBe(false);
    expect("maxTags" in json["B站"].article).toBe(false);
    expect("abstract" in json["小红书"].image_text).toBe(false);
  });

  it("getLimits 返回值与 toLimitsJSON 同源", () => {
    for (const [platform, types] of Object.entries(PLATFORM_SCHEMA)) {
      for (const [contentType] of Object.entries(types)) {
        const L = getLimits(platform, contentType)!;
        const J = toLimitsJSON()[platform][contentType];
        // 每个 schema 字段要么未定义,要么与 toLimitsJSON 一致
        for (const key of ["title", "body", "minBody", "maxImages", "maxTags", "abstract"] as const) {
          if (L[key] !== undefined) {
            expect((J as any)[key], `${platform}/${contentType}/${key}`).toBe(L[key]);
          }
        }
      }
    }
  });
});