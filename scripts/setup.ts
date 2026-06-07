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
step("1/8  Check Node.js");
const ver = process.version.match(/v(\d+)/)?.[1] ?? "0";
if (parseInt(ver) < 18) die(`Node.js >= 18 required. Current: ${process.version}`);
console.log(`  Node.js ${process.version} ✓`);

// 2. Install dependencies
step("2/8  Install dependencies (root)");
run("npm install");

step("3/8  Install dependencies (UI)");
run("npm install", path.join(ROOT, "ui"));

// 3. Install Playwright Chromium
step("4/8  Install Playwright Chromium");
run("npx playwright install chromium");

// 4. Build MCP dist files
step("5/8  Build MCP servers");
run("npm run build:mcp");

// 5. Build UI (so it's served from port 3919)
step("6/8  Build UI");
run("npm run build:ui");

// 6. Init runtime directories
step("7/8  Init runtime directories");
for (const d of ["data", "cache", "cache/mcp-manifests"]) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}
console.log("  ✓");

// 7. Init memory from templates (skip existing files to preserve user data)
step("8/8  Init memory from templates");
const templatesDir = path.join(ROOT, "memory", ".templates");
const memoryDir = path.join(ROOT, "memory");
if (fs.existsSync(templatesDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
  const templates = fs.readdirSync(templatesDir);
  for (const file of templates) {
    const src = path.join(templatesDir, file);
    const dest = path.join(memoryDir, file);
    if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log(`  ${file} (new)`);
    } else if (fs.existsSync(dest)) {
      console.log(`  ${file} (exists, skip)`);
    }
  }
} else {
  warn("memory/.templates/ not found, skip memory init");
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
