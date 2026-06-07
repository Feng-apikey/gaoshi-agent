import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "tools", "gaoshi-mcp", "dist", "server.js");

console.log("Root:", root);
console.log("Server:", serverPath);

const child = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
  cwd: root,
});

// Bypass MCP initialization — send a direct draft_save via initialized request
// First, send the initialize request
const initReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
});

const callReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "draft_save",
    arguments: {
      title: "测试agent存草稿",
      content: "这是从素材库文档保存的测试内容。",
      content_type: "article",
      platform: "小红书",
      tags: ["测试", "文档"],
    },
  },
});

let buffer = "";
let phase = 0;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf-8");
  const lines = buffer.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (phase === 0 && msg.id === 0) {
        console.log("Initialized OK");
        phase = 1;
        // Send initialized notification + tools/call
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        setTimeout(() => {
          child.stdin.write(callReq + "\n");
        }, 500);
      } else if (msg.id === 1) {
        console.log("draft_save result:", JSON.stringify(msg, null, 2));
        child.kill();
        process.exit(0);
      }
    } catch {}
  }
  buffer = lines[lines.length - 1];
});

child.stderr.on("data", (chunk) => {
  console.error("STDERR:", chunk.toString());
});

child.stdin.write(initReq + "\n");

setTimeout(() => {
  console.log("TIMEOUT");
  child.kill();
  process.exit(1);
}, 10000);
