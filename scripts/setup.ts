// One-click setup for new users
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };

function step(msg: string) { console.log(`\n${C.green}▶ ${msg}${C.reset}`); }
function warn(msg: string) { console.log(`${C.yellow}⚠ ${msg}${C.reset}`); }
function die(msg: string) { console.error(`${C.red}✗ ${msg}${C.reset}`); process.exit(1); }

function run(cmd: string, cwd?: string) {
  try { execSync(cmd, { cwd: cwd ?? ROOT, stdio: "inherit" }); } catch { die(`Failed: ${cmd}`); }
}

// 1. Check Node.js
step("1/7  Check Node.js");
const ver = process.version.match(/v(\d+)/)?.[1] ?? "0";
if (parseInt(ver) < 18) die(`Node.js >= 18 required. Current: ${process.version}`);
console.log(`  Node.js ${process.version} ✓`);

// 2. Install UI dependencies
step("2/7  Install dependencies (UI)");
run("npm install", path.join(ROOT, "ui"));

// 3. Build MCP
step("3/7  Build gaoshi-mcp");
run("npm run build:mcp");

// 4. Build UI
step("4/7  Build UI");
run("npm run build:ui");

// 5. Init SearXNG
step("5/7  Init SearXNG");
const searxngDir = path.join(ROOT, "searxng");
const hasDocker = (() => {
  try { execSync("docker --version", { stdio: "pipe" }); return true; } catch { return false; }
})();

if (!hasDocker) {
  warn("Docker not found — skip SearXNG. Web search will fall back to Bing API.");
} else {
  // Generate configs if missing
  const settingsPath = path.join(searxngDir, "settings.yml");
  const composePath = path.join(searxngDir, "docker-compose.yml");
  if (!fs.existsSync(settingsPath)) {
    warn("searxng/settings.yml missing — SearXNG won't start.");
  }
  if (!fs.existsSync(composePath)) {
    warn("searxng/docker-compose.yml missing — SearXNG won't start.");
  }
  if (fs.existsSync(settingsPath) && fs.existsSync(composePath)) {
    try {
      console.log("  docker compose up -d ...");
      execSync("docker compose up -d", { cwd: searxngDir, stdio: "inherit" });
      console.log("  SearXNG running at http://localhost:8888 ✓");
    } catch {
      warn("docker compose failed. Is Docker Desktop running?");
    }
  }
}

// 6. Init runtime directories
step("6/7  Init runtime directories");
for (const d of ["data", "cache", "cache/mcp-manifests"]) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}
console.log("  ✓");

// 7. Init memory from defaults (skip existing files to preserve user data)
step("7/7  Init memory from defaults");
const defaultsDir = path.join(ROOT, "defaults");
const memoryDir = path.join(ROOT, "memory");
fs.mkdirSync(memoryDir, { recursive: true });
for (const file of fs.readdirSync(defaultsDir)) {
  const src = path.join(defaultsDir, file);
  const dest = path.join(memoryDir, file);
  if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`  ${file} (new)`);
  } else if (fs.existsSync(dest)) {
    console.log(`  ${file} (exists, skip)`);
  }
}

console.log(`\n${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log(`${C.green}  ✓ Setup complete!${C.reset}`);
console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log("");
console.log("  Start:  npm run dev (opens http://localhost:3919)");
console.log("      UI dev: cd ui && npm run dev (http://localhost:5173)");
console.log("");
  console.log("  Go to Settings → fill in your API key → start chatting.");
console.log("");
