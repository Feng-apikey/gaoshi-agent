import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { safePath } from "../agent/tools/file-tools.ts";
import { stripHtml } from "../agent/tools/web-tools.ts";

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
  const testDataDir = path.join(os.tmpdir(), `gaoshi_safe_test_${Date.now()}`);
  const testSafe = (p: string) => safePath(p, testDataDir);

  beforeAll(() => { fs.mkdirSync(testDataDir, { recursive: true }); });
  afterAll(() => { try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch {} });

  it("safePath resolves within data dir", () => {
    const p = testSafe("images/test.png");
    expect(p.startsWith(testDataDir)).toBe(true);
  });

  it("safePath rejects traversal via ..", () => {
    expect(() => testSafe("../../etc/passwd")).toThrow("路径越界");
  });

  it("safePath rejects absolute path outside data dir", () => {
    expect(() => testSafe("/etc/passwd")).toThrow("路径越界");
  });
});

// ═══════════════════════════════════════════
// Web tools — helpers
// ═══════════════════════════════════════════

describe("web tools helpers", () => {
  it("stripHtml removes HTML tags", () => {
    const result = stripHtml("<html><body><p>Hello</p><p>World</p></body></html>", 1000);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<html>");
  });

  it("stripHtml removes script and style blocks", () => {
    const result = stripHtml(
      '<html><style>body { color: red; }</style><script>alert("xss")</script><p>Clean text</p></html>',
      1000
    );
    expect(result).toContain("Clean text");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color");
  });

  it("stripHtml respects maxChars", () => {
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

// Douyin/Bilibili/XHS MCP tests removed — old MCP source no longer in repo (commit acf4813)
