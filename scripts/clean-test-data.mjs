// scripts/clean-test-data.mjs
// 一次性脚本:清测试草稿 / 测试素材 / 测试对话 / 老 AI 生成脏文件
// 不可逆,但执行前自动备份 DB + 即将删的磁盘文件到 data/.backup-<date>/
//
// 用法: node scripts/clean-test-data.mjs [--no-backup]

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = "D:/gaoshi-pure";
const DB_PATH = path.join(ROOT, "data", "gaoshi.db");
const BACKUP_DIR = path.join(ROOT, "data", `.backup-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);

const noBackup = process.argv.includes("--no-backup");

// === 0. 备份 ===
if (!noBackup) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const f of ["gaoshi.db", "gaoshi.db-shm", "gaoshi.db-wal"]) {
    const src = path.join(ROOT, "data", f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BACKUP_DIR, f));
      console.log(`[backup] ${f} -> ${BACKUP_DIR}/${f}`);
    }
  }
  // 备份要删的磁盘脏文件
  const dirtyFiles = [
    "data/images/gaoshi_img_1781007077381.png",
    "data/images/gaoshi_img_1781007098832.png",
    "data/images/xhs-test.png",
    "data/videos/test-video.mp4",
    "data/videos/test_video.mp4",   // 下划线版 (残留清理后已删, 但保持 dirty list 完整)
  ];
  fs.mkdirSync(path.join(BACKUP_DIR, "dirty-files", "images"), { recursive: true });
  fs.mkdirSync(path.join(BACKUP_DIR, "dirty-files", "videos"), { recursive: true });
  for (const rel of dirtyFiles) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BACKUP_DIR, "dirty-files", rel.replace(/^data\//, "")));
      console.log(`[backup] ${rel} -> .backup/dirty-files/${rel.replace(/^data\//, "")}`);
    }
  }
}

// === 1. 打开 DB,开 FK ===
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// === 2. 计数(清前) ===
const before = {
  drafts: db.prepare("SELECT COUNT(*) AS c FROM drafts").get().c,
  materials: db.prepare("SELECT COUNT(*) AS c FROM materials").get().c,
  threads: db.prepare("SELECT COUNT(*) AS c FROM threads").get().c,
  publish_log: db.prepare("SELECT COUNT(*) AS c FROM publish_log").get().c,
};
console.log("\n[BEFORE]", before);

// === 3. 列出要删的(展示用) ===
const draftIds = db.prepare("SELECT id FROM drafts").all().map(r => r.id);
const materialIds = db.prepare("SELECT id FROM materials").all().map(r => r.id);
const threadIds = db.prepare("SELECT id FROM threads").all().map(r => r.id);
console.log("\n[TO-DELETE]");
console.log(`  drafts (${draftIds.length}):`, draftIds);
console.log(`  materials (${materialIds.length}):`, materialIds);
console.log(`  threads (${threadIds.length}):`, threadIds);

// === 4. 删 DB 行 ===
const delDrafts = db.prepare("DELETE FROM drafts").run();
const delMaterials = db.prepare("DELETE FROM materials").run();
const delThreads = db.prepare("DELETE FROM threads").run();
console.log("\n[DELETE-RESULT]", {
  drafts: delDrafts.changes,
  materials: delMaterials.changes,
  threads: delThreads.changes,
});

// === 5. 删磁盘脏文件 ===
const dirtyFiles = [
  "data/images/gaoshi_img_1781007077381.png",
  "data/images/gaoshi_img_1781007098832.png",
  "data/images/xhs-test.png",
  "data/videos/test-video.mp4",
  "data/videos/test_video.mp4",
];
for (const rel of dirtyFiles) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`[unlink] ${rel}`);
  }
}

// === 6. VACUUM ===
db.exec("VACUUM");
console.log("\n[VACUUM] done");

// === 7. 计数(清后) ===
const after = {
  drafts: db.prepare("SELECT COUNT(*) AS c FROM drafts").get().c,
  materials: db.prepare("SELECT COUNT(*) AS c FROM materials").get().c,
  threads: db.prepare("SELECT COUNT(*) AS c FROM threads").get().c,
  publish_log: db.prepare("SELECT COUNT(*) AS c FROM publish_log").get().c,
};
console.log("\n[AFTER]", after);

db.close();

console.log(`\n[DONE] backup at ${BACKUP_DIR}`);
console.log(`[DONE] backup 3 天后请手动 mavis-trash ${BACKUP_DIR}`);
