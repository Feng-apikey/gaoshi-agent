import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDB } from "./db.ts";
import { materials } from "./schema.ts";
import { extToCategory, extToMime, MEDIA_DIRS } from "./media-types.ts";

const DATA_DIR = path.resolve(path.join(process.cwd(), "data"));
const MAX_HASH_SIZE = 50 * 1024 * 1024; // 50MB

export type SyncCache = {
  time: number;
  data: any[];
  mtimeCache: Map<string, number>;
  hashByPath?: Map<string, string>;
};

let _syncCache: SyncCache | null = null;

export function invalidateSyncCache() {
  _syncCache = null;
}

/**
 * Merge filesystem files into DB — returns all materials.
 *
 * SSOT: this is the ONLY way to list/sync materials. Used by both the HTTP
 * /api/materials route and the MCP material_list tool, so they always return
 * the same hex ids and same row data.
 *
 * Id format: randomBytes(8).toString("hex") — stable, immutable, decoupled
 * from filename. Rename/move is handled via content_hash match in
 * existingHashes; old friend, new path reuses the original row.
 */
export function syncAndList(): any[] {
  if (_syncCache && Date.now() - _syncCache.time < 5 * 60 * 1000) {
    return _syncCache.data;
  }

  const db = getDB();
  const existing = new Map<string, any>();
  const existingPaths = new Set<string>();
  for (const row of db.select().from(materials).all()) {
    existing.set(row.id as string, row);
    existingPaths.add((row.path as string).replace(/\\/g, "/"));
  }

  const existingHashes = new Map<string, any>();
  for (const row of existing.values()) {
    if (row.contentHash) existingHashes.set(row.contentHash as string, row);
  }

  const prevMtime = _syncCache?.mtimeCache;
  const mtimeCache = new Map<string, number>();
  const prevHashByPath = _syncCache?.hashByPath;
  const hashByPath = new Map<string, string>();

  for (const dir of MEDIA_DIRS) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (!fs.statSync(full).isFile()) continue;
      const normalizedPath = full.replace(/\\/g, "/");
      if (existingPaths.has(normalizedPath)) continue;

      const ext = path.extname(entry).toLowerCase();
      const category = extToCategory(ext) ?? "document";
      const stat = fs.statSync(full);
      mtimeCache.set(normalizedPath, stat.mtimeMs);

      let hash = "";
      if (stat.size <= MAX_HASH_SIZE) {
        if (prevMtime?.get(normalizedPath) === stat.mtimeMs && prevHashByPath?.get(normalizedPath)) {
          hash = prevHashByPath.get(normalizedPath)!;
        } else {
          try {
            hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
          } catch {}
        }
      }
      if (hash) hashByPath.set(normalizedPath, hash);

      // Old friend, new path: hash matches an existing row → update path only
      // NOTE: do NOT overwrite `name` here — name is independent user-facing field,
      // updated only via PATCH /api/materials/:id .body.name
      if (hash && existingHashes.has(hash)) {
        const oldRow = existingHashes.get(hash)!;
        if ((oldRow.path as string).replace(/\\/g, "/") !== normalizedPath) {
          db.update(materials)
            .set({ path: full })
            .where(eq(materials.id, oldRow.id))
            .run();
          console.log(`[materials] hash-matched rename: ${oldRow.id} ${oldRow.path} -> ${full}`);
          existing.set(oldRow.id, { ...oldRow, path: full });
          existingPaths.add(normalizedPath);
          existingPaths.delete((oldRow.path as string).replace(/\\/g, "/"));
        }
        continue;
      }

      // Brand new file: NOT auto-registered. Materials must be created via
      // material_save / POST /api/upload — both assign a hex id BEFORE writing
      // to disk. Sync only reconciles hash-matches and orphan-cleanup.
      // (see SSOT docs: id is the unique truth; path/name derive from id)
      // Silent by design — a file dropped into data/ without going through
      // the canonical ingest API is expected to remain untracked.
    }
  }

  // Clean up orphaned DB records where file no longer exists on disk
  for (const [id, row] of existing) {
    if (!fs.existsSync((row as any).path)) {
      try {
        db.delete(materials).where(eq(materials.id, id)).run();
        console.log("[materials] cleaned orphan:", id);
      } catch {}
    }
  }

  const data = db.select().from(materials).all();
  _syncCache = { time: Date.now(), data, mtimeCache };
  _syncCache.hashByPath = hashByPath;
  return data;
}

export function getDataDir(): string {
  return DATA_DIR;
}
