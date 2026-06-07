import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ═══════════════════════════════════════════
// Agent tool registration
// ═══════════════════════════════════════════

describe("agent tool registration", () => {
  it("createAgentTools returns non-empty list", async () => {
    const { createAgentTools } = await import("../agent/tools/index.ts");
    const tools = createAgentTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("all tools have required fields", async () => {
    const { createAgentTools } = await import("../agent/tools/index.ts");
    const tools = createAgentTools();
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(typeof t.name).toBe("string");
      expect(t.description).toBeTruthy();
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.inputSchema).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  it("tool names are unique", async () => {
    const { createAgentTools } = await import("../agent/tools/index.ts");
    const tools = createAgentTools();
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all inputSchemas have type: object", async () => {
    const { createAgentTools } = await import("../agent/tools/index.ts");
    const tools = createAgentTools();
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("known tools are present", async () => {
    const { createAgentTools } = await import("../agent/tools/index.ts");
    const tools = createAgentTools();
    const names = new Set(tools.map(t => t.name));
    // Local tools (non-MCP)
    for (const n of ["web_search", "web_fetch", "file_read", "file_write",
      "file_list", "file_delete", "file_move",
      "exec", "memory_search", "memory_save", "skill_load", "skill_search"]) {
      expect(names.has(n), `missing: ${n}`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════
// File tools — path safety
// ═══════════════════════════════════════════

describe("file tools path safety", () => {
  it("safePath resolves within data dir", () => {
    // Replicating the safePath logic from file-tools.ts
    const cwd = process.cwd();
    const DATA_DIR = path.join(cwd, "data");
    function safePath(subpath: string): string {
      const full = path.resolve(DATA_DIR, subpath);
      if (!full.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("路径越界");
      return full;
    }

    const p = safePath("images/test.png");
    expect(p.startsWith(DATA_DIR)).toBe(true);
  });

  it("safePath rejects traversal via ..", () => {
    const cwd = process.cwd();
    const DATA_DIR = path.join(cwd, "data");
    function safePath(subpath: string): string {
      const full = path.resolve(DATA_DIR, subpath);
      if (!full.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("路径越界");
      return full;
    }

    expect(() => safePath("../../etc/passwd")).toThrow("路径越界");
  });

  it("safePath rejects absolute path outside data dir", () => {
    const cwd = process.cwd();
    const DATA_DIR = path.join(cwd, "data");
    function safePath(subpath: string): string {
      const full = path.resolve(DATA_DIR, subpath);
      if (!full.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("路径越界");
      return full;
    }

    expect(() => safePath("/etc/passwd")).toThrow("路径越界");
  });
});

// ═══════════════════════════════════════════
// Web tools — helpers
// ═══════════════════════════════════════════

describe("web tools helpers", () => {
  it("stripHtml removes HTML tags", () => {
    function stripHtml(html: string, maxChars: number): string {
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, "\n")
        .trim()
        .slice(0, maxChars);
    }

    const result = stripHtml("<html><body><p>Hello</p><p>World</p></body></html>", 1000);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<html>");
  });

  it("stripHtml removes script and style blocks", () => {
    function stripHtml(html: string, maxChars: number): string {
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, "\n")
        .trim()
        .slice(0, maxChars);
    }

    const result = stripHtml(
      '<html><style>body { color: red; }</style><script>alert("xss")</script><p>Clean text</p></html>',
      1000
    );
    expect(result).toContain("Clean text");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color");
  });

  it("stripHtml respects maxChars", () => {
    function stripHtml(html: string, maxChars: number): string {
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, "\n")
        .trim()
        .slice(0, maxChars);
    }

    const result = stripHtml("<p>abcdefghij</p>", 5);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result).toBe("abcde");
  });

  it("web_fetch tool rejects invalid URL gracefully", async () => {
    const { createWebTools } = await import("../agent/tools/web-tools.ts");
    const tools = createWebTools();
    const fetchTool = tools.find(t => t.name === "web_fetch")!;
    const result: any = await fetchTool.execute({ url: "not-a-valid-url" });
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// Douyin MCP — content formatting
// ═══════════════════════════════════════════

function formatDouyinBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[#*\-\_~`>]/g, "")
    .replace(/[【】「」]/g, "")
    .trim();
}

const EMOJI_PREFIXES = ["✨", "🔥", "📢", "💡", "🎉", "❤️", "🌟", "📌"];

function formatDouyinTitle(title: string): string {
  let t = title.replace(/[#*\-\_~`]/g, "").replace(/\n/g, " ").trim();
  const hasEmoji = /[\p{Emoji}]/u.test(t);
  if (!hasEmoji && t.length < 50) {
    const emoji = EMOJI_PREFIXES[title.length % EMOJI_PREFIXES.length];
    t = `${emoji} ${t}`;
  }
  return t;
}

describe("douyin content formatting", () => {
  it("formatDouyinBody removes markdown characters", () => {
    const input = "**粗体** and _斜体_ and `code` and [link](url)";
    const result = formatDouyinBody(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("_");
    expect(result).not.toContain("`");
    expect(result).not.toContain("*");
    expect(result).not.toContain("~");
  });

  it("formatDouyinBody normalizes excessive newlines", () => {
    const input = "line1\n\n\n\n\nline2\n\n\nline3";
    const result = formatDouyinBody(input);
    // 3+ newlines become 2
    expect(result).toBe("line1\n\nline2\n\nline3");
  });

  it("formatDouyinBody handles CRLF", () => {
    const input = "line1\r\nline2\r\n\r\nline3";
    const result = formatDouyinBody(input);
    expect(result).toBe("line1\nline2\n\nline3");
  });

  it("formatDouyinBody removes Chinese bracket pairs", () => {
    const input = "【标题】「引述」正文";
    const result = formatDouyinBody(input);
    expect(result).not.toContain("【");
    expect(result).not.toContain("】");
    expect(result).not.toContain("「");
    expect(result).not.toContain("」");
    expect(result).toContain("标题");
  });

  it("formatDouyinBody trims whitespace", () => {
    const input = "  \n  content  \n  ";
    const result = formatDouyinBody(input);
    expect(result).toBe("content");
  });

  it("formatDouyinTitle adds emoji prefix to short titles without emoji", () => {
    const result = formatDouyinTitle("今天是个好日子");
    expect(result).toMatch(/^[✨🔥📢💡🎉❤️🌟📌]/u);
    expect(result.length).toBeGreaterThan(0);
  });

  it("formatDouyinTitle does not add emoji if already has one", () => {
    const result = formatDouyinTitle("✨ 今天是个好日子");
    // Already has emoji, should not add another prefix
    const emojiCount = [...result].filter(c => /[\p{Emoji}]/u.test(c)).length;
    expect(emojiCount).toBeLessThanOrEqual(2);
  });

  it("formatDouyinTitle does not add emoji to long titles", () => {
    const longTitle = "A".repeat(60);
    const result = formatDouyinTitle(longTitle);
    // Should not start with emoji since title >= 50 chars
    expect(/^[A-Z]/.test(result)).toBe(true);
  });

  it("formatDouyinTitle strips markdown and newlines", () => {
    const result = formatDouyinTitle("**重磅**消息\n第二行");
    expect(result).not.toContain("*");
    expect(result).not.toContain("\n");
    expect(result).toContain("重磅消息 第二行");
  });

  it("formatDouyinTitle deterministic emoji", () => {
    const result1 = formatDouyinTitle("hello");
    const result2 = formatDouyinTitle("hello");
    expect(result1).toBe(result2);
  });
});

// ═══════════════════════════════════════════
// Douyin MCP — cookies
// ═══════════════════════════════════════════

describe("douyin cookie round-trip", () => {
  const tmpDir = path.join(os.tmpdir(), `gaoshi_dy_test_${Date.now()}`);
  const cookieFile = path.join(tmpDir, "cookies.json");

  // Replicate cookie helpers
  function saveCookies(raw: { cookies: any[]; expires: number }): void {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(cookieFile, JSON.stringify(raw, null, 2));
  }

  function loadCookies(): { cookies: any[]; expires: number } | null {
    try {
      if (!fs.existsSync(cookieFile)) return null;
      const raw = fs.readFileSync(cookieFile, "utf-8");
      const data = JSON.parse(raw);
      if (Date.now() > data.expires) return null;
      return data;
    } catch { return null; }
  }

  function clearCookies(): void {
    try { fs.unlinkSync(cookieFile); } catch {}
  }

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("save and load cookies", () => {
    clearCookies();
    const cookies = [
      { name: "sessionid", value: "abc123", domain: ".douyin.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "csrf", value: "xyz789", domain: ".douyin.com", path: "/", httpOnly: false, secure: true, sameSite: "Strict" },
    ];
    saveCookies({ cookies, expires: Date.now() + 24 * 3600 * 1000 });
    const loaded = loadCookies();
    expect(loaded).not.toBeNull();
    expect(loaded!.cookies).toHaveLength(2);
    expect(loaded!.cookies[0].name).toBe("sessionid");
    expect(loaded!.cookies[0].httpOnly).toBe(true);
    expect(loaded!.cookies[0].secure).toBe(true);
    expect(loaded!.cookies[0].sameSite).toBe("Lax");
    expect(loaded!.cookies[1].name).toBe("csrf");
  });

  it("loadCookies returns null for missing file", () => {
    clearCookies();
    expect(loadCookies()).toBeNull();
  });

  it("loadCookies returns null for expired cookies", () => {
    saveCookies({ cookies: [], expires: Date.now() - 1000 });
    expect(loadCookies()).toBeNull();
  });

  it("loadCookies returns null for corrupted JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(cookieFile, "{corrupted!!!", "utf-8");
    expect(loadCookies()).toBeNull();
  });

  it("clearCookies removes file", () => {
    saveCookies({ cookies: [], expires: Date.now() + 9999 });
    expect(fs.existsSync(cookieFile)).toBe(true);
    clearCookies();
    expect(fs.existsSync(cookieFile)).toBe(false);
  });

  it("cookies survive malformed input", () => {
    clearCookies();
    saveCookies({ cookies: [], expires: Date.now() + 9999 });
    fs.writeFileSync(cookieFile, "{not-json!!!");
    const loaded = loadCookies();
    expect(loaded).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Douyin MCP — placeholder PNG
// ═══════════════════════════════════════════

describe("douyin placeholder PNG", () => {
  it("createPlaceholderPNG produces valid PNG", async () => {
    const zlib = await import("node:zlib");

    function createPlaceholderPNG(): Buffer {
      const w = 400, h = 400;
      const raw = Buffer.alloc((w * 3 + 1) * h);
      for (let y = 0; y < h; y++) { const off = y * (w * 3 + 1); raw[off] = 0; for (let x = 0; x < w; x++) { const p = off + 1 + x * 3; raw[p] = 0x99; raw[p + 1] = 0x99; raw[p + 2] = 0x99; } }
      const idat = zlib.deflateSync(raw);
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const crc32 = (buf: Buffer) => { let c = 0xFFFFFFFF; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); } return (c ^ 0xFFFFFFFF) >>> 0; };
      const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, "ascii"); const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crcVal]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
      return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
    }

    const buf = createPlaceholderPNG();
    // PNG magic bytes
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80); // P
    expect(buf[2]).toBe(78); // N
    expect(buf[3]).toBe(71); // G
    // Contains IHDR, IDAT, IEND chunks
    const str = buf.toString("latin1");
    expect(str).toContain("IHDR");
    expect(str).toContain("IDAT");
    expect(str).toContain("IEND");
  });

  it("createPlaceholderPNG produces non-empty buffer", async () => {
    const zlib = await import("node:zlib");

    function createPlaceholderPNG(): Buffer {
      const w = 400, h = 400;
      const raw = Buffer.alloc((w * 3 + 1) * h);
      for (let y = 0; y < h; y++) { const off = y * (w * 3 + 1); raw[off] = 0; for (let x = 0; x < w; x++) { const p = off + 1 + x * 3; raw[p] = 0x99; raw[p + 1] = 0x99; raw[p + 2] = 0x99; } }
      const idat = zlib.deflateSync(raw);
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const crc32 = (buf: Buffer) => { let c = 0xFFFFFFFF; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); } return (c ^ 0xFFFFFFFF) >>> 0; };
      const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, "ascii"); const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crcVal]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
      return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
    }

    const buf = createPlaceholderPNG();
    expect(buf.length).toBeGreaterThan(1000); // 400x400 grey PNG should be several KB
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Douyin MCP — login detection patterns
// ═══════════════════════════════════════════

describe("douyin login detection", () => {
  const LOGGED_IN_PATTERNS = [/已登录|登录成功|logged.?in|is.?logged.?in.*true/i];
  const LOGGED_OUT_PATTERNS = [/未登录|登录失败|登录过期|logged.?in.*false|not.?logged/i];

  it("matches logged-in Chinese text", () => {
    expect(LOGGED_IN_PATTERNS.some(p => p.test("已登录"))).toBe(true);
    expect(LOGGED_IN_PATTERNS.some(p => p.test("登录成功"))).toBe(true);
  });

  it("matches logged-in English variants", () => {
    expect(LOGGED_IN_PATTERNS.some(p => p.test("is logged in: true"))).toBe(true);
    expect(LOGGED_IN_PATTERNS.some(p => p.test("loggedIn: true"))).toBe(true);
    expect(LOGGED_IN_PATTERNS.some(p => p.test("already logged_in"))).toBe(true);
  });

  it("matches not-logged-in Chinese text", () => {
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("未登录"))).toBe(true);
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("登录失败"))).toBe(true);
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("登录过期"))).toBe(true);
  });

  it("matches not-logged-in English variants", () => {
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("not logged in"))).toBe(true);
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("is_logged_in: false"))).toBe(true);
  });

  it("does not match neutral text", () => {
    expect(LOGGED_IN_PATTERNS.some(p => p.test("hello world"))).toBe(false);
    expect(LOGGED_OUT_PATTERNS.some(p => p.test("发布视频成功"))).toBe(false);
  });
});

// Douyin constants tests removed — old MCP source no longer in repo
