import { tokenize } from "./tokenizer.ts";
import type { MemoryEntry } from "./types.ts";

type InvertedIndex = Map<string, Set<string>>;

let _index: InvertedIndex | null = null;
let _entries: MemoryEntry[] = [];

function entryKey(name: string, type: string): string {
  return `${type}::${name}`;
}

export function buildIndex(entries: MemoryEntry[]): void {
  _entries = entries;
  _index = new Map();

  for (const entry of entries) {
    const text = `${entry.name} ${entry.description} ${entry.content}`;
    const tokens = tokenize(text);
    for (const token of tokens) {
      if (!_index.has(token)) _index.set(token, new Set());
      _index.get(token)!.add(entryKey(entry.name, entry.type));
    }
  }
}

export function search(query: string): Array<{ name: string; score: number }> {
  if (!_index) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scores = new Map<string, number>();
  for (const token of queryTokens) {
    const matches = _index.get(token);
    if (!matches) continue;
    for (const key of matches) scores.set(key, (scores.get(key) ?? 0) + 1);
  }

  return [...scores.entries()]
    .map(([key, hits]) => ({ name: key, score: hits / queryTokens.length }))
    .sort((a, b) => b.score - a.score);
}

export function listByType(type: string): MemoryEntry[] {
  return _entries.filter(e => e.type === type);
}

export function getCached(key: string): MemoryEntry | null {
  // key format: "type::name" from search results, or bare name for backward compat
  const colonIdx = key.indexOf("::");
  if (colonIdx !== -1) {
    const type = key.slice(0, colonIdx);
    const name = key.slice(colonIdx + 2);
    return _entries.find(e => e.name === name && e.type === type) ?? null;
  }
  return _entries.find(e => e.name === key) ?? null;
}
