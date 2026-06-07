import { tokenize } from "./tokenizer.ts";
import type { MemoryEntry } from "./types.ts";

type InvertedIndex = Map<string, Set<string>>;

let _index: InvertedIndex | null = null;
let _entries: MemoryEntry[] = [];

export function buildIndex(entries: MemoryEntry[]): void {
  _entries = entries;
  _index = new Map();

  for (const entry of entries) {
    const text = `${entry.name} ${entry.description} ${entry.content}`;
    const tokens = tokenize(text);
    for (const token of tokens) {
      if (!_index.has(token)) _index.set(token, new Set());
      _index.get(token)!.add(entry.name);
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
    for (const name of matches) scores.set(name, (scores.get(name) ?? 0) + 1);
  }

  return [...scores.entries()]
    .map(([name, hits]) => ({ name, score: hits / queryTokens.length }))
    .sort((a, b) => b.score - a.score);
}

export function listByType(type: string): MemoryEntry[] {
  return _entries.filter(e => e.type === type);
}

export function getCached(name: string): MemoryEntry | null {
  return _entries.find(e => e.name === name) ?? null;
}
