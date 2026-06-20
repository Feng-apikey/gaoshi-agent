import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { chatRouter } from "./routes/chat.ts";
import { draftsRouter } from "./routes/drafts.ts";
import { materialsRouter } from "./routes/materials.ts";
import { uploadRouter } from "./routes/upload.ts";
import { providersRouter } from "./routes/providers.ts";
import { routingRouter } from "./routes/routing.ts";
import { settingsRouter } from "./routes/settings.ts";
import { toLimitsJSON } from "../schemas/platform-schema.ts";

const app = new Hono();

// ── CORS ──

app.use("*", cors({
  origin: ["http://localhost:5173", "http://localhost:3919", "app://."],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// ── Health ──

app.get("/api/health", (c) => c.json({ status: "ok", version: "0.2.0" }));

// ── Platform limits ──
app.get("/api/limits", (c) => {
  return c.json(toLimitsJSON());
});

// ── Routes ──


app.route("/api/chat", chatRouter);
app.route("/api/drafts", draftsRouter);
app.route("/api/materials", materialsRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/providers", providersRouter);
app.route("/api/routing", routingRouter);
app.route("/api/settings", settingsRouter);

// ── Static files ──

const STATIC_DIR = path.join(process.cwd(), "api", "static");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveFile(filePath: string): Response | null {
  const resolved = path.resolve(STATIC_DIR, filePath);
  if (!resolved.startsWith(STATIC_DIR)) return null; // path traversal guard
  try {
    const data = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return new Response(data, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" },
    });
  } catch {
    return null;
  }
}

app.get("/", () => serveFile("index.html") ?? new Response("Not Found", { status: 404 }));
app.get("/*", (c) => {
  const urlPath = new URL(c.req.url).pathname;
  const filePath = urlPath === "/" ? "index.html" : urlPath.slice(1);
  return serveFile(filePath) ?? new Response("Not Found", { status: 404 });
});

// ── Start ──

const PORT = parseInt(process.env.PORT ?? "3919");

function getLocalIPs(): string[] {
  const result: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        result.push(iface.address);
      }
    }
  }
  return result;
}

async function start() {
  console.log(`[gaoshi] Starting on port ${PORT}...`);

  // Ensure memory files exist (copy from defaults on first run, never overwrite)
  for (const file of ["gaoshi.md", "user-profile.md"]) {
    const dest = path.join("memory", file);
    const src = path.join("defaults", file);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[gaoshi] Init memory: ${file}`);
    }
  }

  // Init provider store (must complete before first chat request)
  try {
    const store = await import("../agent/providers/store.ts");
    await store.initProviderStore();
    console.log("[gaoshi] Provider store initialized");
  } catch (err: any) {
    console.error("[gaoshi] Provider store init failed:", err.message);
  }

  // Init MCP tools (must complete before first chat request)
  try {
    const { initAllTools } = await import("../agent/tools/index.ts");
    await initAllTools();
    console.log("[gaoshi] MCP tools initialized");
  } catch (err: any) {
    console.error("[gaoshi] MCP tools init failed:", err.message);
  }

  const localIPs = getLocalIPs();
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
    console.log(`[gaoshi] Ready: http://localhost:${info.port}`);
    for (const ip of localIPs) {
      console.log(`         http://${ip}:${info.port}`);
    }
  });
}

start();

// ── Shutdown ──

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[gaoshi] Shutting down...");

  try {
    const { getMCPClientManager } = await import("../mcp/mcp-client.ts");
    await getMCPClientManager().disconnectAll();
  } catch {}

  try {
    const { getCheckpointer } = await import("../agent/checkpoint.ts");
    const cp = getCheckpointer() as any;
    if (typeof cp?.close === "function") await cp.close();
  } catch {}

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
