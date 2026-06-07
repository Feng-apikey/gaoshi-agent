import * as fs from "node:fs";
import * as path from "node:path";
import { buildUserProfileSection, buildMemoryIndexSummary } from "./memory/summary.ts";
import { buildSkillIndexSummary } from "./skills/loader.ts";
import { buildToolsGuide } from "./tools/guide.ts";
import { getAgentTools } from "./tools/index.ts";

export function buildSystemPrompt(gaoshiPath?: string): string {
  const parts: string[] = [];

  // gaoshi.md — agent identity, behavior rules, platform knowledge
  const gp = gaoshiPath ?? path.join(process.cwd(), "memory", "gaoshi.md");
  try {
    if (fs.existsSync(gp)) {
      const content = fs.readFileSync(gp, "utf-8").trim();
      if (content) parts.push(content);
    }
  } catch {}

  // Tools capability guide — what the agent CAN do
  const tools = getAgentTools();
  if (tools.length > 0) {
    parts.push(buildToolsGuide(tools));
  }

  // User profiles — full content from memory
  const userSection = buildUserProfileSection();
  if (userSection) parts.push(userSection);

  // Skill index — names + descriptions, load on demand
  const skillIndex = buildSkillIndexSummary();
  if (skillIndex) parts.push(skillIndex);

  // Memory index — project + reference summary
  const memoryIndex = buildMemoryIndexSummary();
  if (memoryIndex) parts.push(memoryIndex);

  return parts.join("\n\n");
}
