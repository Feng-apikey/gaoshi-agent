import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";

export interface MCPServerConfig {
  type?: "http" | "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  port?: number;
}

interface ConnectedServer {
  client: Client;
  transport: any;
  process: child_process.ChildProcess | null;
  tools: Array<{ name: string; description: string; inputSchema: any }>;
  config: MCPServerConfig;
}

function loadConfig(): Record<string, MCPServerConfig> {
  const configPath = path.join(process.cwd(), "mcp", "servers.json");
  const legacyPath = path.join(process.cwd(), "browser", "servers.json");
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (fs.existsSync(legacyPath)) return JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
  } catch {}
  return {};
}

function resolveCommand(command: string, env: Record<string, string>): { command: string; env: Record<string, string> } {
  if (command === "node" && process.versions?.electron) {
    return { command: process.execPath, env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command, env };
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Port ${port} not ready`));
        setTimeout(tryConnect, 500);
      });
      sock.on("timeout", () => { sock.destroy(); tryConnect(); });
      sock.connect(port, "127.0.0.1");
    };
    tryConnect();
  });
}

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();
  private connecting = new Map<string, Promise<void>>();

  async connect(serverId: string, configOverride?: MCPServerConfig): Promise<void> {
    if (this.servers.has(serverId)) return;
    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const cfg = configOverride ?? loadConfig()[serverId];
    if (!cfg) throw new Error(`MCP server config not found: ${serverId}`);

    const doConnect = async () => {
      const mode = cfg.type ?? "stdio";
      let transport: any;
      let proc: child_process.ChildProcess | null = null;

      const resolved = resolveCommand(cfg.command, cfg.env ? { ...process.env, ...cfg.env } as Record<string, string> : { ...process.env } as Record<string, string>);

      if (mode === "http") {
        proc = child_process.spawn(resolved.command, cfg.args ?? [], { env: resolved.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        proc.on("error", (err) => console.error(`[mcp:${serverId}] process error:`, err.message));
        proc.stdout?.on("data", () => {}); // drain to prevent backpressure deadlock
        proc.stderr?.on("data", (chunk: Buffer) => console.error(`[mcp:${serverId}]`, chunk.toString().trim()));
        try {
          const port = cfg.port ?? 18060;
          await waitForPort(port);
          transport = new StreamableHTTPClientTransport(new URL(cfg.url ?? `http://localhost:${port}/mcp`));
        } catch (err) {
          try { proc.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { proc!.kill("SIGKILL"); } catch {} }, 3000);
          throw err;
        }
      } else {
        transport = new StdioClientTransport({ command: resolved.command, args: cfg.args ?? [], env: resolved.env, stderr: "pipe" });
      }

      const client = new Client({ name: "gaoshi", version: "0.2.0" }, { capabilities: {} });

      try {
        await client.connect(transport);
      } catch (err) {
        if (proc) {
          try { proc.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { proc!.kill("SIGKILL"); } catch {} }, 3000);
        }
        throw err;
      }

      const { tools } = await client.listTools({});

      transport.onclose = () => {
        this.servers.delete(serverId);
        console.error(`[mcp:${serverId}] transport closed`);
      };
      if (proc) {
        proc.on("exit", () => {
          this.servers.delete(serverId);
          console.error(`[mcp:${serverId}] process exited`);
        });
      }

      this.servers.set(serverId, { client, transport, process: proc, tools, config: cfg });
    };

    const promise = doConnect().finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, promise);
    return promise;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<any> {
    let s = this.servers.get(serverId);
    if (!s) {
      // Attempt reconnect once
      console.error(`[mcp:${serverId}] reconnecting...`);
      try { await this.connect(serverId); } catch {}
      s = this.servers.get(serverId);
      if (!s) throw new Error(`MCP server not connected: ${serverId}`);
    }
    const result = await s.client.callTool({ name: toolName, arguments: args }, undefined, timeoutMs ? { timeout: timeoutMs } : undefined);
    if (result.isError) { const text = result.content?.map((c: any) => c.text ?? "").join("\n") ?? "未知错误"; throw new Error(text); }
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") ?? "";
    try { return JSON.parse(text); } catch { return { text, raw: text }; }
  }

  getTools(serverId: string): Array<{ name: string; description: string }> { return this.servers.get(serverId)?.tools ?? []; }
  isConnected(serverId: string): boolean { return this.servers.has(serverId); }

  async disconnect(serverId: string): Promise<void> {
    const s = this.servers.get(serverId);
    if (!s) return;
    try { await s.client.close(); } catch {}
    if (s.process) { try { s.process.kill("SIGTERM"); } catch {}; setTimeout(() => { try { s.process?.kill("SIGKILL"); } catch {} }, 3000); }
    this.servers.delete(serverId);
  }

  async disconnectAll(): Promise<void> {
    const withTimeout = async (id: string) => {
      await Promise.race([this.disconnect(id).catch(() => {}), new Promise<void>(r => setTimeout(r, 5000))]);
    };
    await Promise.all([...this.servers.keys()].map(withTimeout));
  }
}

let _instance: MCPClientManager | null = null;
export function getMCPClientManager(): MCPClientManager {
  if (!_instance) _instance = new MCPClientManager();
  return _instance;
}
