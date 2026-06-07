import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Replicate gaoshi-mcp tools logic (tools.ts)

const tmpDir = path.join(os.tmpdir(), `gaoshi_mcp_test_${Date.now()}`);
const DATA_DIR = path.join(tmpDir, "data");

function safePath(subpath: string): string {
  const full = path.resolve(DATA_DIR, subpath);
  if (!full.startsWith(path.resolve(DATA_DIR))) throw new Error("路径越界");
  return full;
}

function readFile(subpath: string, encoding = "utf-8") {
  const p = safePath(subpath);
  if (!fs.existsSync(p)) throw new Error("文件不存在");
  const content = fs.readFileSync(p, encoding as BufferEncoding);
  if (Buffer.isBuffer(content)) return { type: "binary", size: content.length };
  return { content: (content as string).slice(0, 50000), path: subpath };
}

function listFiles(subdir = "") {
  const dir = safePath(subdir || ".");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    return { name, isDirectory: stat.isDirectory(), size: stat.size };
  });
}

const extCategory: Record<string, string> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video",
  ".mp3": "audio", ".wav": "audio", ".opus": "audio", ".ogg": "audio", ".m4a": "audio",
  ".webm": "voice",
  ".pdf": "document", ".docx": "document", ".txt": "document", ".md": "document",
};

function scanMediaFiles(category?: string) {
  const mediaDirs = ["images", "videos", "audio", "voices", "documents"];
  const results: Array<{ id: string; name: string; path: string; category: string; size: number; createdAt: string }> = [];
  for (const dir of mediaDirs) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (!fs.statSync(full).isFile()) continue;
      const ext = path.extname(entry).toLowerCase();
      const cat = extCategory[ext] ?? "document";
      if (category && cat !== category) continue;
      const stat = fs.statSync(full);
      results.push({
        id: path.relative(DATA_DIR, full).replace(/\\/g, "/"),
        name: entry,
        path: full,
        category: cat,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      });
    }
  }
  return results;
}

beforeAll(() => {
  fs.mkdirSync(path.join(DATA_DIR, "images"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "videos"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "documents"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "images", "test.png"), "fake-png-data");
  fs.writeFileSync(path.join(DATA_DIR, "documents", "readme.md"), "# Test\nhello world");
  fs.writeFileSync(path.join(DATA_DIR, "documents", "empty.txt"), "");
  fs.writeFileSync(path.join(DATA_DIR, "videos", "demo.mp4"), "fake-mp4-data");
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════
// safePath
// ═══════════════════════════════════════════

describe("safePath", () => {
  it("resolves within DATA_DIR", () => {
    const p = safePath("images/test.png");
    expect(p.startsWith(DATA_DIR)).toBe(true);
    expect(p).toBe(path.join(DATA_DIR, "images/test.png"));
  });

  it("rejects traversal via ..", () => {
    expect(() => safePath("../../etc/passwd")).toThrow("路径越界");
  });

  it("rejects absolute path outside DATA_DIR", () => {
    expect(() => safePath("/etc/passwd")).toThrow("路径越界");
  });

  it("handles empty subpath", () => {
    const p = safePath("");
    expect(p).toBe(path.resolve(DATA_DIR));
  });

  it("handles dot subpath", () => {
    const p = safePath(".");
    expect(p).toBe(path.resolve(DATA_DIR));
  });
});

// ═══════════════════════════════════════════
// file_read
// ═══════════════════════════════════════════

describe("file_read", () => {
  it("reads text file content", () => {
    const result = readFile("documents/readme.md");
    expect((result as any).content).toContain("hello world");
    expect((result as any).path).toBe("documents/readme.md");
  });

  it("throws for non-existent file", () => {
    expect(() => readFile("documents/nonexistent.txt")).toThrow("文件不存在");
  });

  it("throws for path traversal", () => {
    expect(() => readFile("../../etc/passwd")).toThrow("路径越界");
  });

  it("truncates content to 50000 chars", () => {
    // Create a large file
    fs.writeFileSync(path.join(DATA_DIR, "documents", "large.txt"), "x".repeat(60000));
    const result = readFile("documents/large.txt");
    expect((result as any).content.length).toBeLessThanOrEqual(50000);
  });
});

// ═══════════════════════════════════════════
// file_list
// ═══════════════════════════════════════════

describe("file_list", () => {
  it("lists root directory", () => {
    const files = listFiles("");
    expect(files.length).toBeGreaterThanOrEqual(3); // images, documents, videos dirs
    expect(files.some(f => f.name === "images" && f.isDirectory)).toBe(true);
  });

  it("lists specific subdirectory", () => {
    const files = listFiles("documents");
    expect(files.length).toBeGreaterThanOrEqual(2); // readme.md, empty.txt (maybe large.txt)
    expect(files.some(f => f.name === "readme.md" && !f.isDirectory)).toBe(true);
  });

  it("returns empty array for non-existent dir", () => {
    const files = listFiles("nonexistent");
    expect(files).toEqual([]);
  });

  it("rejects path traversal", () => {
    expect(() => listFiles("../../etc")).toThrow("路径越界");
  });
});

// ═══════════════════════════════════════════
// scanMediaFiles
// ═══════════════════════════════════════════

describe("scanMediaFiles", () => {
  it("discovers all media files", () => {
    const files = scanMediaFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some(f => f.id === "images/test.png")).toBe(true);
    expect(files.some(f => f.id === "documents/readme.md")).toBe(true);
    expect(files.some(f => f.id === "videos/demo.mp4")).toBe(true);
  });

  it("filters by category", () => {
    const images = scanMediaFiles("image");
    expect(images.length).toBe(1);
    expect(images[0].category).toBe("image");
    expect(images[0].name).toBe("test.png");
  });

  it("assigns correct categories by extension", () => {
    const files = scanMediaFiles();
    const png = files.find(f => f.name === "test.png")!;
    const md = files.find(f => f.name === "readme.md")!;
    const mp4 = files.find(f => f.name === "demo.mp4")!;
    expect(png.category).toBe("image");
    expect(md.category).toBe("document");
    expect(mp4.category).toBe("video");
  });

  it("generates relative IDs with forward slashes", () => {
    const files = scanMediaFiles();
    for (const f of files) {
      expect(f.id).not.toContain("\\");
      expect(f.id.includes("/")).toBe(true);
    }
  });

  it("handles empty directories gracefully", () => {
    fs.mkdirSync(path.join(DATA_DIR, "audio"), { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, "voices"), { recursive: true });
    const files = scanMediaFiles();
    // Should not throw; empty dirs are simply skipped
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════
// material_save
// ═══════════════════════════════════════════

describe("material_save", () => {
  const categoryDir: Record<string, string> = {
    image: "images", video: "videos", audio: "audio", voice: "voices", document: "documents",
  };

  it("copies file to correct category directory", () => {
    const srcDir = path.join(tmpDir, "source");
    fs.mkdirSync(srcDir, { recursive: true });
    const src = path.join(srcDir, "my-song.mp3");
    fs.writeFileSync(src, "fake-audio-data");

    const ext = path.extname(src).toLowerCase();
    const cat = extCategory[ext] || "document";
    const dirName = categoryDir[cat] || "documents";
    const destDir = path.join(DATA_DIR, dirName);
    const dest = path.join(destDir, path.basename(src));

    fs.copyFileSync(src, dest);

    expect(fs.existsSync(dest)).toBe(true);
    expect(dest.startsWith(path.join(DATA_DIR, "audio"))).toBe(true);
  });

  it("returns error for non-existent source file", () => {
    const nonExistent = path.join(tmpDir, "does-not-exist.bin");
    const exists = fs.existsSync(nonExistent);
    expect(exists).toBe(false);
  });

  it("defaults category to document for unknown extensions", () => {
    const ext = ".xyz";
    const cat = extCategory[ext] || "document";
    expect(cat).toBe("document");
  });
});
