export type MemoryType = "user" | "project" | "reference";

export const EXPIRY_DAYS: Record<MemoryType, number | null> = {
  user: null,
  project: 90,
  reference: 60,
};

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  updatedAt: string;
}

export interface MemoryIndexEntry {
  name: string;
  description: string;
  type: MemoryType;
  updatedAt: string;
}

export interface SearchResult {
  entry: MemoryIndexEntry;
  score: number;
  snippet: string;
}

export function isExpired(entry: MemoryEntry): boolean {
  const days = EXPIRY_DAYS[entry.type];
  if (days === null) return false;
  const age = (Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return age > days;
}
