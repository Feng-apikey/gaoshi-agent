// ── Single source of truth for all platform × content-type field limits ──

export interface TypeDef {
  title?: number
  body?: number
  minBody?: number
  maxImages?: number
  maxTags?: number
  abstract?: number
  header?: boolean
  cover?: boolean
  aspectRatio?: string
}

export interface DraftData {
  id: string
  title: string
  content: string
  tags: string[]
  images: string[]
  video: string
  cover: string
  header: string
  abstract: string
}

export const PLATFORM_SCHEMA: Record<string, Record<string, TypeDef>> = {
  "小红书": {
    image_text: { title: 20, body: 1000, maxImages: 18, maxTags: 10, aspectRatio: "3:4", cover: true },
    video:      { title: 20, body: 1000, maxTags: 10, aspectRatio: "3:4", cover: true },
    article:    { title: 64, body: 8000 },
  },
  "抖音": {
    image_text: { title: 20, body: 1000, maxImages: 35, maxTags: 5, aspectRatio: "3:4", cover: true },
    video:      { title: 30, body: 1000, maxTags: 5, aspectRatio: "9:16", cover: true },
    article:    { title: 30, body: 8000, minBody: 300, abstract: 30, header: true, cover: true },
  },
  "B站": {
    dynamic: { title: 20, body: 1000, maxImages: 18 },
    video:   { title: 80, body: 2000, maxTags: 10, aspectRatio: "16:9", cover: true },
    article: { title: 30, body: 100000 },
  },
}

export function getLimits(platform: string, type: string): TypeDef | null {
  return PLATFORM_SCHEMA[platform]?.[type] ?? null
}

/** Platforms × content types that store tags as inline `#hashtag` lines in the
 *  content body (rather than in the dedicated `tags` field).
 *
 *  Used by:
 *  - `tools/gaoshi-mcp/server.ts:appendHashtagsToContent` — append `#tags` to body
 *  - `publish/index.ts:validateTags` — require `#tag` to be present in body
 *
 *  Single source of truth so that the append side and the validate side can
 *  never drift apart. */
export const INLINE_HASHTAG_RULES: Record<string, string[]> = {
  "抖音":   ["image_text", "video"],
  "小红书": ["image_text", "video"],
};

export function usesInlineHashtags(platform: string, contentType: string): boolean {
  return INLINE_HASHTAG_RULES[platform]?.includes(contentType) ?? false;
}

export function toLimitsJSON(): Record<string, Record<string, Record<string, number | string | undefined>>> {
  const result: Record<string, Record<string, Record<string, number | string | undefined>>> = {}
  for (const [platform, types] of Object.entries(PLATFORM_SCHEMA)) {
    result[platform] = {}
    for (const [type, def] of Object.entries(types)) {
      const entry: Record<string, number | string | undefined> = {}
      if (def.title !== undefined) entry.title = def.title
      if (def.body !== undefined) entry.body = def.body
      if (def.minBody !== undefined) entry.minBody = def.minBody
      if (def.maxImages !== undefined) entry.maxImages = def.maxImages
      if (def.maxTags !== undefined) entry.maxTags = def.maxTags
      if (def.abstract !== undefined) entry.abstract = def.abstract
      if (def.aspectRatio !== undefined) entry.aspectRatio = def.aspectRatio
      if (def.header) entry.header = 1
      if (def.cover) entry.cover = 1
      result[platform][type] = entry
    }
  }
  return result
}
