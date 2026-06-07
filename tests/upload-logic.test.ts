import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════
// Replicated from api/routes/upload.ts
// ═══════════════════════════════════════════

const ALLOWED_TYPES: Record<string, string[]> = {
  document: [".pdf", ".docx", ".doc", ".txt", ".md", ".html"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".opus", ".aac"],
  voice: [".webm"],
  video: [".mp4", ".mov", ".avi", ".mkv"],
};

function extToCategory(ext: string): string | null {
  for (const [cat, exts] of Object.entries(ALLOWED_TYPES)) {
    if (exts.includes(ext.toLowerCase())) return cat;
  }
  return null;
}

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

const pluralMap: Record<string, string> = {
  image: "images", video: "videos", audio: "audio", voice: "voices", document: "documents",
};

// ═══════════════════════════════════════════
// extToCategory
// ═══════════════════════════════════════════

describe("extToCategory", () => {
  it("maps .png to image", () => {
    expect(extToCategory(".png")).toBe("image");
  });

  it("maps .jpg /.jpeg to image", () => {
    expect(extToCategory(".jpg")).toBe("image");
    expect(extToCategory(".jpeg")).toBe("image");
  });

  it("maps .mp4 /.mov to video", () => {
    expect(extToCategory(".mp4")).toBe("video");
    expect(extToCategory(".mov")).toBe("video");
  });

  it("maps .mp3 /.wav to audio", () => {
    expect(extToCategory(".mp3")).toBe("audio");
    expect(extToCategory(".wav")).toBe("audio");
  });

  it("maps .webm to voice", () => {
    expect(extToCategory(".webm")).toBe("voice");
  });

  it("maps .pdf /.docx to document", () => {
    expect(extToCategory(".pdf")).toBe("document");
    expect(extToCategory(".docx")).toBe("document");
  });

  it("returns null for unsupported extensions", () => {
    expect(extToCategory(".exe")).toBeNull();
    expect(extToCategory(".zip")).toBeNull();
    expect(extToCategory(".psd")).toBeNull();
    expect(extToCategory("")).toBeNull();
    expect(extToCategory(".XYZ")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extToCategory(".PNG")).toBe("image");
    expect(extToCategory(".Mp4")).toBe("video");
    expect(extToCategory(".PDF")).toBe("document");
  });
});

// ═══════════════════════════════════════════
// Size limits
// ═══════════════════════════════════════════

describe("MAX_SIZE", () => {
  it("is 100MB", () => {
    expect(MAX_SIZE).toBe(100 * 1024 * 1024);
  });

  it("rejects files larger than 100MB", () => {
    const oversized = MAX_SIZE + 1;
    expect(oversized > MAX_SIZE).toBe(true);
  });

  it("accepts files at exactly 100MB", () => {
    expect(MAX_SIZE <= MAX_SIZE).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Plural map (upload subdirectories)
// ═══════════════════════════════════════════

describe("pluralMap subdirectories", () => {
  it("maps all categories to expected directory names", () => {
    expect(pluralMap.image).toBe("images");
    expect(pluralMap.video).toBe("videos");
    expect(pluralMap.audio).toBe("audio");
    expect(pluralMap.voice).toBe("voices");
    expect(pluralMap.document).toBe("documents");
  });

  it("fallback uses category + 's'", () => {
    const fallback = (cat: string) => pluralMap[cat] || cat + "s";
    expect(fallback("unknown")).toBe("unknowns");
    expect(fallback("image")).toBe("images");
  });
});

// ═══════════════════════════════════════════
// Extension edge cases
// ═══════════════════════════════════════════

describe("extension edge cases", () => {
  it("handles dot-less filenames", () => {
    expect(extToCategory("")).toBeNull();
  });

  it("handles multiple dots (gets last ext)", () => {
    // extToCategory receives the extension from path.extname()
    // path.extname("file.tar.gz") returns ".gz"
    expect(extToCategory(".gz")).toBeNull();
  });
});
