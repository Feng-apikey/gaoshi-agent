import { search, getCached } from "./indexer.ts";
import { loadAll } from "./manager.ts";
import { isExpired } from "./types.ts";
import type { SearchResult, MemoryType } from "./types.ts";

export function retrieve(query: string, options?: {
  type?: MemoryType;
  topK?: number;
  minScore?: number;
}): SearchResult[] {
  const topK = options?.topK ?? 5;
  const minScore = options?.minScore ?? 0.1;

  let results = search(query);
  if (options?.type) {
    results = results.filter(r => {
      const e = getCached(r.name);
      return e && e.type === options.type && !isExpired(e);
    });
  }

  return results
    .filter(r => r.score >= minScore)
    .slice(0, topK)
    .map(r => {
      const entry = getCached(r.name);
      const valid = entry && !isExpired(entry) ? entry : null;
      return {
        entry: {
          name: valid?.name ?? r.name,
          description: valid?.description ?? "",
          type: valid?.type ?? "reference",
          updatedAt: valid?.updatedAt ?? "",
        },
        score: Math.round(r.score * 100) / 100,
        snippet: valid?.content.slice(0, 200) ?? "",
      };
    });
}

export function createRetriever() {
  loadAll(); // populates indexer cache
  return { retrieve };
}
