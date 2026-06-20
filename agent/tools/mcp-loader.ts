import type { ToolDef } from "./types.ts";
import { getMCPClientManager } from "../../mcp/mcp-client.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const MANIFEST_DIR = path.join(process.cwd(), "cache", "mcp-manifests");

interface ToolManifest {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Lazy-load MCP tools. Strategy:
 * 1. Read cached manifest from disk (build-time generated)
 * 2. If no manifest, eagerly connect once to get tool list, then disconnect
 * 3. Tool execution always lazily connects on first call
 */
export async function loadAllMCPTools(): Promise<ToolDef[]> {
  const configPath = path.join(process.cwd(), "mcp", "servers.json");
  let configs: Record<string, any> = {};
  try {
    if (fs.existsSync(configPath)) configs = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {}

  const allTools: ToolDef[] = [];

  for (const [serverId] of Object.entries(configs)) {
    const tools = await getToolManifest(serverId);

    for (const t of tools) {
      allTools.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        execute: async (args: Record<string, unknown>) => {
          const c = getMCPClientManager();
          if (!c.isConnected(serverId)) await c.connect(serverId);
          return c.callTool(serverId, t.name, args);
        },
      });
    }
  }

  return allTools;
}

// ── Manifest cache ──

async function getToolManifest(serverId: string): Promise<ToolManifest[]> {
  // Try cached manifest first
  const manifestPath = path.join(MANIFEST_DIR, `${serverId}.json`);
  if (fs.existsSync(manifestPath)) {
    try { return JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {}
  }

  // Fallback: connect, get tools, cache, disconnect
  try {
    const mcp = getMCPClientManager();
    await mcp.connect(serverId);
    const tools = mcp.getTools(serverId);
    const manifest = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: (t as any).inputSchema,
    }));

    // Cache for next time
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await mcp.disconnect(serverId);
    return manifest;
  } catch (err: any) {
    console.error(`[mcp-loader] failed to load tools from ${serverId}:`, err?.message ?? err);
    return [];
  }
}

/** Generate manifests for all configured MCP servers (call during build) */
export async function buildManifests(): Promise<void> {
  const configPath = path.join(process.cwd(), "mcp", "servers.json");
  let configs: Record<string, any> = {};
  try {
    if (fs.existsSync(configPath)) configs = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {}

  fs.mkdirSync(MANIFEST_DIR, { recursive: true });

  for (const [serverId] of Object.entries(configs)) {
    try {
      console.error(`[mcp-manifest] building ${serverId}...`);
      const mcp = getMCPClientManager();
      await mcp.connect(serverId);
      const tools = mcp.getTools(serverId);
      const manifest = tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: (t as any).inputSchema,
      }));
      fs.writeFileSync(
        path.join(MANIFEST_DIR, `${serverId}.json`),
        JSON.stringify(manifest, null, 2),
      );
      console.error(`[mcp-manifest] ${serverId}: ${tools.length} tools`);
      await mcp.disconnect(serverId);
    } catch (err: any) {
      console.error(`[mcp-manifest] ${serverId} FAILED: ${err.message}`);
    }
  }
}

// CLI: npx tsx agent/tools/mcp-loader.ts --build
if (process.argv.includes("--build")) {
  buildManifests().then(() => process.exit(0));
}
