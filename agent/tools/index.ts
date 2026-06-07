import type { ToolDef } from "./types.ts";
import { createWebTools } from "./web-tools.ts";
import { createMediaTools } from "./media-tools.ts";
import { createFileTools } from "./file-tools.ts";
import { createExecTool } from "./exec-tool.ts";
import { createMemoryTool } from "./memory-tool.ts";
import { createSkillTool } from "./skill-tool.ts";
import { createPlatformTools } from "./platform-tools.ts";
import { loadAllMCPTools } from "./mcp-loader.ts";

export function createAgentTools(): ToolDef[] {
  return [
    ...createWebTools(),
    ...createMediaTools(),
    ...createFileTools(),
    ...createExecTool(),
    ...createMemoryTool(),
    ...createSkillTool(),
    ...createPlatformTools(),
  ];
}

export async function createAllTools(): Promise<ToolDef[]> {
  const local = createAgentTools();
  const mcp = await loadAllMCPTools();
  const localNames = new Set(local.map(t => t.name));
  const uniqueMCP = mcp.filter(t => !localNames.has(t.name));
  return [...local, ...uniqueMCP];
}

// ── Preloaded tools cache ──

let _allTools: ToolDef[] | null = null;

export async function initAllTools(): Promise<void> {
  _allTools = await createAllTools();
}

export function getAgentTools(): ToolDef[] {
  return _allTools ?? createAgentTools();
}

export { createWebTools, createMediaTools, createFileTools, createExecTool, createMemoryTool, loadAllMCPTools };
export { buildToolsGuide } from "./guide.ts";
export type { ToolDef };
