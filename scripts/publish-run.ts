// 端到端真实发布链路 - 调 publish/index.ts 的 publish() 函数
// 用法: npx tsx scripts/publish-run.ts <platform> <contentType> <draftId>
import { publish } from "../publish/index.ts";
import { getDB } from "../storage/db.ts";
import { drafts } from "../storage/schema.ts";
import { eq } from "drizzle-orm";

const [, , platform, contentType, draftId] = process.argv;
if (!platform || !contentType || !draftId) {
  console.error("用法: npx tsx scripts/publish-run.ts <platform> <contentType> <draftId>");
  console.error("示例: npx tsx scripts/publish-run.ts 抖音 image_text draft_1781094968848_28jrrt");
  process.exit(2);
}

// 跑前展示草稿内容 (防发错)
const db = getDB();
const row = db.select().from(drafts).where(eq(drafts.id, draftId)).get() as any;
if (!row) {
  console.error(`草稿不存在: ${draftId}`);
  process.exit(2);
}

console.log("========== 即将发布 ==========");
console.log(`平台: ${platform}`);
console.log(`类型: ${contentType}`);
console.log(`草稿 ID: ${row.id}`);
console.log(`标题: ${row.title}`);
console.log(`正文: ${(row.content || "").slice(0, 200)}${row.content && row.content.length > 200 ? "..." : ""}`);
console.log(`标签: ${row.tags}`);
console.log(`图片: ${row.images}`);
console.log(`视频: ${row.video || "(无)"}`);
console.log(`封面: ${row.cover || "(无)"}`);
console.log("==============================\n");

const t0 = Date.now();
const result = await publish(platform, contentType, draftId);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n========== 发布结果 ==========");
console.log(`耗时: ${dt}s`);
console.log(`success: ${result.success}`);
console.log(`stage:   ${result.stage}`);
console.log(`message: ${result.message}`);
console.log("==============================");

process.exit(result.success ? 0 : 1);
