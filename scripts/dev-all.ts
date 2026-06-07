// Start API + UI dev servers in one terminal
import { spawn } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function start(label: string, cmd: string, args: string[], cwd: string) {
  const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: true });
  p.on("error", () => {});
  p.on("exit", (code) => {
    console.error(`\n[${label}] exited (code=${code})`);
    process.exit(code ?? 1);
  });
  return p;
}

start("API", "npx", ["tsx", "watch", "api/index.ts"], ROOT);
start("UI", "npx", ["vite", "--host"], path.join(ROOT, "ui"));

console.log("API: http://localhost:3919  |  UI: http://localhost:5173\n");
