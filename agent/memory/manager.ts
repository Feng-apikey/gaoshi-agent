import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryEntry, MemoryType } from "./types.ts";
import { isExpired } from "./types.ts";
import { buildIndex } from "./indexer.ts";

let MEMORY_DIR = path.join(process.cwd(), "memory");
export function setMemoryDir(dir: string): void { MEMORY_DIR = dir; clearCache(); }

const INDEX_FILE = path.join(MEMORY_DIR, "MEMORY.md");

const TYPE_DIRS: Record<MemoryType, string> = {
  user: "",
  project: "projects",
  reference: "reference",
};

function ensureDir(dir: string): void { fs.mkdirSync(dir, { recursive: true }); }

function filePath(name: string, type: MemoryType): string {
  const sub = TYPE_DIRS[type];
  const base = sub ? path.join(MEMORY_DIR, sub) : MEMORY_DIR;
  return path.join(base, `${name}.md`);
}

function scanDir(dir: string, memoType: MemoryType | null): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  if (!fs.existsSync(dir)) return entries;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md") || file === "MEMORY.md") continue;
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const { headers, body } = parseFrontmatter(raw);
      if (headers.name && headers.type) {
        const type = headers.type as MemoryType;
        if (memoType && type !== memoType) continue;
        entries.push({
          name: headers.name,
          description: headers.description ?? "",
          type,
          content: body,
          updatedAt: headers.updatedAt ?? new Date().toISOString(),
        });
      }
    } catch {}
  }
  return entries;
}

function parseFrontmatter(raw: string): { headers: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { headers: {}, body: raw };
  const headers: Record<string, string> = {};
  let inMetadata = false;
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "metadata:") { inMetadata = true; continue; }
    const kv = line.match(/^(?:\s{2})?(\w+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      if (inMetadata && (key === "type" || key === "updatedAt")) {
        headers[key] = kv[2].trim();
      } else {
        headers[key] = kv[2].trim();
      }
    }
  }
  return { headers, body: match[2].trim() };
}

function toFrontmatter(entry: MemoryEntry): string {
  return [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    `updatedAt: ${entry.updatedAt}`,
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}

// ── Cache ──

let _allCache: MemoryEntry[] | null = null;
function clearCache(): void { _allCache = null; }

function ensureCache(): MemoryEntry[] {
  if (_allCache) return _allCache;
  return loadAll();
}

export function loadAll(): MemoryEntry[] {
  if (_allCache) return _allCache;

  const entries: MemoryEntry[] = [];
  ensureDir(MEMORY_DIR);

  // Scan all type directories
  entries.push(...scanDir(MEMORY_DIR, null));
  for (const sub of Object.values(TYPE_DIRS)) {
    if (sub) entries.push(...scanDir(path.join(MEMORY_DIR, sub), null));
  }

  // Remove expired files from disk and filter out
  const valid = entries.filter(e => {
    if (isExpired(e)) {
      try { fs.unlinkSync(filePath(e.name, e.type)); } catch {}
      return false;
    }
    return true;
  });

  valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  buildIndex(valid);
  _allCache = valid;
  return valid;
}

export function get(name: string, type?: MemoryType): MemoryEntry | null {
  const types = type ? [type] : (["user", "project", "reference"] as MemoryType[]);
  for (const t of types) {
    const p = filePath(name, t);
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf-8");
      const { headers, body } = parseFrontmatter(raw);
      if (!headers.name) return null;
      const entry: MemoryEntry = { name: headers.name, description: headers.description ?? "", type: headers.type as MemoryType, content: body, updatedAt: headers.updatedAt ?? "" };
      if (isExpired(entry)) { try { fs.unlinkSync(p); } catch {}; return null; }
      return entry;
    }
  }
  return null;
}

export function save(entry: MemoryEntry): void {
  const stripped = entry.content.replace(/[\s#*\-|>]/g, "").trim();
  if (stripped.length < 30) {
    throw new Error(`记忆内容不足（${stripped.length}字），拒绝保存。记忆应该是叙述性内容，标签/对照表等请用素材库或草稿系统。`);
  }
  entry.updatedAt = new Date().toISOString();
  const p = filePath(entry.name, entry.type);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, toFrontmatter(entry), "utf-8");

  // Update cache in-memory instead of re-scanning disk
  const cache = ensureCache();
  const idx = cache.findIndex(e => e.name === entry.name && e.type === entry.type);
  if (idx >= 0) {
    cache[idx] = entry;
  } else {
    cache.push(entry);
  }
  cache.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  buildIndex(cache);
  writeIndexSummary();
}

export function remove(name: string, type?: MemoryType): void {
  const types = type ? [type] : (["user", "project", "reference"] as MemoryType[]);
  let deletedType: string | null = null;
  for (const t of types) {
    const p = filePath(name, t);
    if (fs.existsSync(p)) { fs.unlinkSync(p); deletedType = t; break; }
  }

  // Update cache in-memory: only remove the type that was actually deleted from disk
  if (deletedType) {
    if (_allCache) {
      _allCache = _allCache.filter(e => !(e.name === name && e.type === deletedType));
      buildIndex(_allCache);
      writeIndexSummary();
    } else {
      // Cache was never loaded — populate from disk (file already gone)
      loadAll();
    }
  }
}

function writeIndexSummary(): void {
  const entries = _allCache ?? [];
  const groups: Record<string, MemoryEntry[]> = { user: [], project: [], reference: [] };
  for (const e of entries) groups[e.type].push(e);

  const lines: string[] = [];
  for (const [type, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const labels: Record<string, string> = { user: "用户记忆", project: "项目", reference: "参考" };
    lines.push(`## ${labels[type] ?? type}`);
    for (const e of items) {
      lines.push(`- [${e.name}](${TYPE_DIRS[type as MemoryType] || "."}/${e.name}.md) — ${e.description}`);
    }
    lines.push("");
  }

  ensureDir(MEMORY_DIR);
  fs.writeFileSync(path.join(MEMORY_DIR, "MEMORY.md"), lines.join("\n"), "utf-8");
}
