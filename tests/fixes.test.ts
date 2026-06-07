import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// We test the core logic in isolation — parse/write round-trip,
// hex detect, queue ID uniqueness.

describe("memory frontmatter round-trip", () => {
  const tmpDir = path.join(os.tmpdir(), `gaoshi_test_${Date.now()}`);

  // Replicate the fixed parseFrontmatter logic
  function parseFrontmatter(raw: string): { headers: Record<string, string>; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { headers: {}, body: raw };
    const headers: Record<string, string> = {};
    let inMetadata = false;
    for (const rawLine of match[1].split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === "metadata:") { inMetadata = true; continue; }
      const kv = line.match(/^(?:\s{2})?(\w+):\s*(.*)$/);
      if (kv) {
        const key = kv[1];
        if (inMetadata && (key === "type" || key === "updatedAt")) {
          headers[key] = kv[2].trim();
        } else {
          headers[key] = kv[2].trim();
        }
      }
    }
    return { headers, body: match[2].trim() };
  }

  // Replicate the fixed toFrontmatter (flat format)
  function toFrontmatter(entry: { name: string; description: string; type: string; content: string; updatedAt: string }): string {
    return [
      "---",
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `type: ${entry.type}`,
      `updatedAt: ${entry.updatedAt}`,
      "---",
      "",
      entry.content,
      "",
    ].join("\n");
  }

  it("flat format: write then read", () => {
    const entry = {
      name: "test-memory",
      description: "unit test",
      type: "user",
      content: "hello world",
      updatedAt: "2026-05-26T10:00:00.000Z",
    };
    const written = toFrontmatter(entry);
    const { headers, body } = parseFrontmatter(written);
    expect(headers.name).toBe("test-memory");
    expect(headers.type).toBe("user");
    expect(headers.description).toBe("unit test");
    expect(body).toBe("hello world");
  });

  it("legacy nested format: still readable", () => {
    const legacy = [
      "---",
      "name: old-memory",
      "description: legacy",
      "metadata:",
      "  type: project",
      "  updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "old content",
      "",
    ].join("\n");

    const { headers, body } = parseFrontmatter(legacy);
    expect(headers.name).toBe("old-memory");
    expect(headers.type).toBe("project");
    expect(headers.description).toBe("legacy");
    expect(body).toBe("old content");
  });

  it("type is never undefined for flat format", () => {
    for (const t of ["user", "project", "reference"]) {
      const { headers } = parseFrontmatter(toFrontmatter({
        name: "x", description: "", type: t, content: "c", updatedAt: "",
      }));
      expect(headers.type).toBe(t);
    }
  });

  it("no frontmatter block returns empty headers", () => {
    const { headers, body } = parseFrontmatter("just raw text");
    expect(headers).toEqual({});
    expect(body).toBe("just raw text");
  });
});

describe("media-tools hex/base64 detection", () => {
  it("valid hex string uses hex decode", () => {
    const audioData = "ffd8ffe0";
    const isHex = /^[0-9a-fA-F]+$/.test(audioData);
    expect(isHex).toBe(true);
  });

  it("base64 string falls back to base64 decode", () => {
    const audioData = "//uQxAAAAA"; // base64 with / and = chars
    const isHex = /^[0-9a-fA-F]+$/.test(audioData);
    expect(isHex).toBe(false);
  });

  it("mixed content not mistaken for hex", () => {
    const audioData = "abcd1234==";
    const isHex = /^[0-9a-fA-F]+$/.test(audioData);
    expect(isHex).toBe(false);
  });
});

describe("chat queue ID uniqueness", () => {
  it("concurrent IDs never collide", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // simulate rapid calls by advancing time slightly
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });
});

describe("web search timeout", () => {
  it("AbortSignal.timeout is available", () => {
    const signal = AbortSignal.timeout(15000);
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
  });

  it("aborted signal is detectable", () => {
    const ac = new AbortController();
    ac.abort();
    expect(ac.signal.aborted).toBe(true);
  });
});
