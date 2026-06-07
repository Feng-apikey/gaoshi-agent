// Clean all runtime data before sharing source code
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function rm(dir: string) {
  const p = path.join(ROOT, dir);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`  ✓ removed ${dir}`);
  }
}

function rmExt(dir: string, ext: string) {
  const p = path.join(ROOT, dir);
  if (!fs.existsSync(p)) return;
  for (const f of fs.readdirSync(p)) {
    if (f.endsWith(ext)) {
      fs.rmSync(path.join(p, f), { recursive: true, force: true });
      console.log(`  ✓ removed ${dir}/${f}`);
    }
  }
}

// Dirty data
rm("data");
rm("cache");
rm("dist");
rm("release");
rm("node_modules");
rm("ui/node_modules");
rm("ui/dist");
rm("tools/douyin-mcp/node_modules");
rm("tools/douyin-mcp/dist");
rm("tools/gaoshi-mcp/node_modules");
rm("tools/gaoshi-mcp/dist");
rm("tools/bilibili-mcp/node_modules");

// Log files and temp
rmExt(".", "*.log");
rmExt("memory", "*.backup");

// qrcode temp files
rmExt("tools/bilibili-mcp", "qrcode_login.png");
rmExt("tools/bilibili-mcp", "bili_credential.json");

// Keep directory structure for runtime
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "images"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "videos"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "audio"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "documents"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "cache"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "cache", "mcp-manifests"), { recursive: true });

// Keep .gitignore in empty dirs
for (const d of ["data", "cache"]) {
  const gi = path.join(ROOT, d, ".gitkeep");
  fs.writeFileSync(gi, "");
}

console.log("\n✅ Clean complete. Ready to share.");
