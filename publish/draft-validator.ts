import { validateDraft, type ValidationError } from "../api/validation.ts";

/**
 * Validate a draft against platform schema. Each field is checked
 * independently and any field marked undefined is skipped — used by
 * draft_save partial-update mode where the caller only sends the
 * fields they're changing.
 *
 * Returns errors in the SAME shape as api/validation.ts:
 *   [{ field: "title", message: "标题超过限制(40/30字)" }, ...]
 *
 * Messages are human-readable but the LLM can parse numeric limits
 * from the parenthetical (current/max or min).
 */
export function validateDraftFields(args: {
  platform: string;
  contentType: string;
  title?: string;
  content?: string;
  tags?: string[];
  abstract?: string;
  images?: string[];
}): ValidationError[] {
  // Unknown platform/contentType combo is now caught inside validateDraft
  // (returns a `_root` error). No need to duplicate the check here.

  // validateDraft requires content (positional arg). For partial-update we
  // pass an empty string when content is absent — content-related errors
  // are stripped below since the field wasn't actually touched.
  const errors = validateDraft(
    args.platform,
    args.contentType,
    args.content ?? "",
    args.title,
    args.tags,
    args.abstract,
    args.images,
  );

  if (args.content === undefined) {
    return errors.filter(e => e.field !== "content");
  }

  return errors;
}