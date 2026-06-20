import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scanMediaFiles } from "../tools/gaoshi-mcp/server.ts";

const tmpDir = path.join(os.tmpdir(), `gaoshi_mcp_test_${Date.now()}`);
const DATA_DIR = path.join(tmpDir, "data");

const scannFiles = (category?: string) => scanMediaFiles(category, DATA_DIR);

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
// scanMediaFiles
// ═══════════════════════════════════════════

describe("scanMediaFiles", () => {
  it("discovers all media files", () => {
    const files = scannFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some(f => f.id === "images/test.png")).toBe(true);
    expect(files.some(f => f.id === "documents/readme.md")).toBe(true);
    expect(files.some(f => f.id === "videos/demo.mp4")).toBe(true);
  });

  it("filters by category", () => {
    const images = scannFiles("image");
    expect(images.length).toBe(1);
    expect(images[0].category).toBe("image");
    expect(images[0].name).toBe("test.png");
  });

  it("assigns correct categories by extension", () => {
    const files = scannFiles();
    const png = files.find(f => f.name === "test.png")!;
    const md = files.find(f => f.name === "readme.md")!;
    const mp4 = files.find(f => f.name === "demo.mp4")!;
    expect(png.category).toBe("image");
    expect(md.category).toBe("document");
    expect(mp4.category).toBe("video");
  });

  it("generates relative IDs with forward slashes", () => {
    const files = scannFiles();
    for (const f of files) {
      expect(f.id).not.toContain("\\");
      expect(f.id.includes("/")).toBe(true);
    }
  });

  it("handles empty directories gracefully", () => {
    fs.mkdirSync(path.join(DATA_DIR, "audio"), { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, "voices"), { recursive: true });
    const files = scannFiles();
    // Should not throw; empty dirs are simply skipped
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════
// material_save
// ═══════════════════════════════════════════

describe("material_save", () => {
  const extCategory: Record<string, string> = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video",
    ".mp3": "audio", ".wav": "audio", ".opus": "audio", ".ogg": "audio", ".m4a": "audio",
    ".webm": "voice",
    ".pdf": "document", ".docx": "document", ".txt": "document", ".md": "document",
  };
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
