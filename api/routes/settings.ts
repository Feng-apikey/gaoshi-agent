import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "config", "settings.json");

interface AppSettings {
  autoApprove: boolean;
}

export function load(filePath?: string): AppSettings {
  const p = filePath ?? SETTINGS_FILE;
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return { autoApprove: false };
}

export function save(settings: AppSettings, filePath?: string): void {
  const p = filePath ?? SETTINGS_FILE;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2));
}

export function getAutoApprove(): boolean {
  return load().autoApprove;
}

export const settingsRouter = new Hono();

settingsRouter.get("/", (c) => c.json(load()));

settingsRouter.put("/", async (c) => {
  const body = await c.req.json<{ autoApprove?: boolean }>();
  const current = load();
  if (body.autoApprove !== undefined) current.autoApprove = body.autoApprove;
  save(current);
  return c.json(current);
});
