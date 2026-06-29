import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  tags: text("tags").default("[]"),           // JSON array
  platform: text("platform").default("小红书"), // 小红书 / B站 / 抖音
  contentType: text("content_type").notNull().default("article"), // article / image_text / video
  images: text("images").default("[]"),         // JSON array of material IDs
  video: text("video").default(""),             // material ID
  cover: text("cover").default(""),             // material ID
  header: text("header").default(""),           // material ID (头图，推荐流)
  abstract: text("abstract").default(""),       // 长文摘要
  status: text("status").notNull().default("draft"), // draft / pushed / push_failed
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const publishLog = sqliteTable("publish_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  draftId: text("draft_id").notNull().references(() => drafts.id),
  platform: text("platform").notNull(),
  status: text("status").notNull(),           // success / failed
  url: text("url").default(""),
  publishedAt: text("published_at").notNull(),
});

export const providerConfig = sqliteTable("provider_config", {
  id: text("id").primaryKey(),                // "deepseek", "minimax", etc.
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().default(""),
  baseURL: text("base_url").notNull(),
  enabled: integer("enabled").notNull().default(0),
  isCustom: integer("is_custom").default(0),
  customModels: text("custom_models").default("[]"), // JSON array
});

export const modelRouting = sqliteTable("model_routing", {
  capability: text("capability").primaryKey(), // text / vision / video / image / tts / music
  providerId: text("provider_id").default(""),
  model: text("model").notNull().default(""),
  baseURL: text("base_url").default(""),
  apiKey: text("api_key").default(""),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("新对话"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const materials = sqliteTable("materials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  category: text("category").notNull(),         // image / audio / video / document
  mimeType: text("mime_type").default(""),
  size: integer("size").notNull().default(0),
  width: integer("width").default(0),
  height: integer("height").default(0),
  tags: text("tags").default("[]"),             // JSON array, AI-generated
  description: text("description").default(""),
  generatedBy: text("generated_by").default(""), // model name if AI-generated
  useCount: integer("use_count").default(0),     // access count
  contentHash: text("content_hash").default(""), // sha256 of file content, used by sync to detect rename/move
  createdAt: text("created_at").notNull(),
});
