import { getLimits } from "../schemas/platform-schema.ts";

export type ValidationError = { field: string; message: string };

function countImages(content: string): number {
  const md = content.match(/!\[.*?\]\(.*?\)/g)?.length ?? 0;
  const html = content.match(/<img\s/g)?.length ?? 0;
  return md + html;
}

export function validateDraft(platform: string, type: string, content: string, title?: string, tags?: string[], abstract?: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const L = getLimits(platform, type);
  if (!L) return errors;

  if (L.title !== undefined && title !== undefined && title.length > L.title) {
    errors.push({ field: "title", message: `标题超过限制（${title.length}/${L.title}字）` });
  }

  const chars = content.replace(/\s/g, "").length;
  const images = countImages(content);

  if (L.minBody !== undefined && chars < L.minBody) {
    errors.push({ field: "content", message: `内容不能为空（最少${L.minBody}字）` });
  }
  if (L.body && chars > L.body) {
    errors.push({ field: "content", message: `字数超过限制（${chars}/${L.body}）` });
  }
  if (L.maxImages !== undefined && images > L.maxImages) {
    errors.push({ field: "content", message: `图片超过限制（${images}/${L.maxImages}）` });
  }
  if (L.maxTags !== undefined && Array.isArray(tags) && tags.filter(Boolean).length > L.maxTags) {
    errors.push({ field: "tags", message: `标签超过限制（最多${L.maxTags}个）` });
  }

  if (L.abstract !== undefined && abstract !== undefined && abstract.length > L.abstract) {
    errors.push({ field: "abstract", message: `摘要超过限制（${abstract.length}/${L.abstract}字）` });
  }

  return errors;
}
