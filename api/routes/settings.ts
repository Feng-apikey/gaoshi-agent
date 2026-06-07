import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "config", "settings.json");

interface AppSettings {
  autoApprove: boolean;
}

function load(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    }
  } catch {}
  return { autoApprove: false };
}

function save(settings: AppSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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
