import * as fs from "node:fs";
import * as path from "node:path";
import { tokenize } from "../memory/tokenizer.ts";

export interface SkillMeta {
  name: string;
  description: string;
  path: string;      // relative to skills/ root
}

const SKILLS_DIR = path.join(process.cwd(), "skills");

let _index: SkillMeta[] | null = null;
let _overrideDir: string | null = null;

function getSkillsDir(): string {
  return _overrideDir ?? SKILLS_DIR;
}

/** Override skills directory for testing. Pass null to reset. */
export function setSkillsDirForTest(dir: string | null): void {
  _overrideDir = dir;
  _index = null;
}

// ── Index ──

export function buildSkillIndex(): SkillMeta[] {
  if (_index) return _index;

  const dir = getSkillsDir();
  const results: SkillMeta[] = [];
  if (!fs.existsSync(dir)) return results;

  function walk(dir: string, base = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, path.join(base, entry.name));
      } else if (entry.name.endsWith(".md")) {
        const raw = fs.readFileSync(full, "utf-8");
        const name = extractFrontmatter(raw, "name") || path.basename(entry.name, ".md");
        const desc = extractFrontmatter(raw, "description") || "";
        results.push({ name, description: desc, path: path.join(base, entry.name) });
      }
    }
  }

  walk(dir);
  _index = results;
  return results;
}

export function extractFrontmatter(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

// ── Load ──

export function loadSkill(nameOrPath: string): string | null {
  const index = buildSkillIndex();
  const meta = index.find(s => s.name === nameOrPath || s.path === nameOrPath);
  if (!meta) return null;

  const fullPath = path.join(getSkillsDir(), meta.path);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

// ── Search ──

export function searchSkills(query: string, topK = 5): SkillMeta[] {
  const index = buildSkillIndex();
  const tokens = tokenize(query);
  if (tokens.length === 0) return index.slice(0, topK);

  const scored = index.map(s => {
    const text = `${s.name} ${s.description}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1;
    }
    return { ...s, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ name, description, path }) => ({ name, description, path }));
}

// ── Summary for system prompt ──

export function buildSkillIndexSummary(): string {
  // Only top-level skills (no subdirectory recursion)
  const results = buildSkillIndex().filter(s => !s.path.includes(path.sep));
  if (results.length === 0) return "";

  const lines = ["## 可用技能", ""];
  for (const s of results) {
    lines.push(`- \`${s.name}\` — ${s.description}`);
  }
  return lines.join("\n") + "\n";
}
