import * as fs from "node:fs";
import * as path from "node:path";

const LIMITS_PATH = path.join(process.cwd(), "config", "platform-limits.json");

function loadLimits(): Record<string, Record<string, { title?: number; minBody?: number; body?: number; maxImages?: number; maxTags?: number }>> {
  try {
    if (fs.existsSync(LIMITS_PATH)) return JSON.parse(fs.readFileSync(LIMITS_PATH, "utf-8"));
  } catch {}
  return {};
}

export type ValidationError = { field: string; message: string };

function countImages(content: string): number {
  const md = content.match(/!\[.*?\]\(.*?\)/g)?.length ?? 0;
  const html = content.match(/<img\s/g)?.length ?? 0;
  return md + html;
}

export function validateDraft(platform: string, type: string, content: string, title?: string, tags?: string[], abstract?: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const limits = loadLimits();
  const platformLimits = limits[platform];
  if (!platformLimits) return errors;

  const typeLimits = platformLimits[type];
  if (!typeLimits) return errors;

  if (typeLimits.title !== undefined && title !== undefined && title.length > typeLimits.title) {
    errors.push({ field: "title", message: `标题超过限制（${title.length}/${typeLimits.title}字）` });
  }

  const chars = content.replace(/\s/g, "").length;
  const images = countImages(content);

  if (typeLimits.minBody !== undefined && chars < typeLimits.minBody) {
    errors.push({ field: "content", message: `内容不能为空（最少${typeLimits.minBody}字）` });
  }
  if (typeLimits.body && chars > typeLimits.body) {
    errors.push({ field: "content", message: `字数超过限制（${chars}/${typeLimits.body}）` });
  }
  if (typeLimits.maxImages !== undefined && images > typeLimits.maxImages) {
    errors.push({ field: "content", message: `图片超过限制（${images}/${typeLimits.maxImages}）` });
  }
  if (typeLimits.maxTags !== undefined && Array.isArray(tags) && tags.filter(Boolean).length > typeLimits.maxTags) {
    errors.push({ field: "tags", message: `标签超过限制（最多${typeLimits.maxTags}个）` });
  }

  if (typeLimits.abstract !== undefined && abstract !== undefined && abstract.length > typeLimits.abstract) {
    errors.push({ field: "abstract", message: `摘要超过限制（${abstract.length}/${typeLimits.abstract}字）` });
  }

  return errors;
}
