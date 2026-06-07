import { loadAll } from "./manager.ts";
import { isExpired } from "./types.ts";

/** Full content of all user-type memories for system prompt injection */
export function buildUserProfileSection(): string {
  const users = loadAll().filter(e => e.type === "user" && !isExpired(e));
  if (users.length === 0) return "";

  return users.map(e =>
    `## ${e.name}\n${e.content}`
  ).join("\n\n");
}

/** Name + description list of project/reference memories for system prompt injection */
export function buildMemoryIndexSummary(): string {
  const entries = loadAll().filter(e => e.type !== "user" && !isExpired(e));
  if (entries.length === 0) return "";

  const lines = ["## 记忆索引", ""];
  const labels: Record<string, string> = { project: "项目", reference: "引用" };

  for (const [type, label] of Object.entries(labels)) {
    const items = entries.filter(e => e.type === type);
    if (items.length === 0) continue;
    lines.push(`### ${label}`);
    for (const e of items) lines.push(`- ${e.name}: ${e.description}`);
    lines.push("");
  }

  return lines.join("\n");
}
