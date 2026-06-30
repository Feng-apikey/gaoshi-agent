// ── Single source of truth for media type categorization ──
//
// All ext↔category, ext↔mime, and category↔directory mappings live here.
// Other modules (api/routes/upload.ts, api/routes/materials.ts,
// tools/gaoshi-mcp/server.ts, agent/tools/media-tools.ts) import from
// this file rather than redefining their own copies.
//
// Adding a new supported file type? Update EXT_TO_CATEGORY + EXT_TO_MIME.
// Adding a new storage directory? Update MEDIA_DIRS + CATEGORY_TO_DIR.

export type MaterialCategory =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "templates";

/** Extension → material category.
 *
 *  Note: `.webm` is categorized as `"voice"` (browser-recorded voice
 *  memos, the typical source). The MIME for `.webm` is still `video/webm`,
 *  so `analyze_video()` correctly handles it as video input. */
export const EXT_TO_CATEGORY: Record<string, MaterialCategory> = {
  // images
  ".png":  "image",
  ".jpg":  "image",
  ".jpeg": "image",
  ".gif":  "image",
  ".webp": "image",
  ".svg":  "image",
  // videos
  ".mp4":  "video",
  ".mov":  "video",
  ".avi":  "video",
  ".mkv":  "video",
  // voices — .webm intentionally separate from video category
  ".webm": "voice",
  // audio
  ".mp3":  "audio",
  ".wav":  "audio",
  ".opus": "audio",
  ".ogg":  "audio",
  ".m4a":  "audio",
  ".aac":  "audio",
  // documents
  ".pdf":  "document",
  ".docx": "document",
  ".doc":  "document",
  ".txt":  "document",
  ".md":   "document",
  ".html": "document",
};

/** Extension → MIME type. Used by static file serving and LLM input prep. */
export const EXT_TO_MIME: Record<string, string> = {
  // images
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  // videos
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".mov":  "video/quicktime",
  ".avi":  "video/x-msvideo",
  ".mkv":  "video/x-matroska",
  // audio
  ".mp3":  "audio/mpeg",
  ".wav":  "audio/wav",
  ".ogg":  "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a":  "audio/mp4",
  ".aac":  "audio/aac",
  // documents
  ".pdf":  "application/pdf",
  ".md":   "text/plain; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc":  "application/msword",
};

/** Subdirectories under `data/` that get auto-synced into the materials DB
 *  on every list call. Adding a new archive dir? Append here AND to
 *  CATEGORY_TO_DIR if it accepts uploads. */
export const MEDIA_DIRS: readonly string[] = [
  "images",
  "videos",
  "audio",
  "voices",
  "documents",
  "docs",
  "templates",
];

/** Material category → storage subdirectory under `data/`. */
export const CATEGORY_TO_DIR: Record<string, string> = {
  image:     "images",
  video:     "videos",
  audio:     "audio",
  voice:     "voices",
  document:  "documents",
  templates: "templates",
};

/** Look up material category by extension (case-insensitive).
 *  Returns `null` for unknown extensions — callers should reject those. */
export function extToCategory(ext: string): string | null {
  if (!ext) return null;
  return EXT_TO_CATEGORY[ext.toLowerCase()] ?? null;
}

/** Look up MIME type by extension (case-insensitive).
 *  Falls back to `application/octet-stream` for unknown extensions. */
export function extToMime(ext: string): string {
  if (!ext) return "application/octet-stream";
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}