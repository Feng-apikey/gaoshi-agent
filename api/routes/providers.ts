import { Hono } from "hono";
import { getDB } from "../../storage/db.ts";
import { providerConfig } from "../../storage/schema.ts";
import { eq } from "drizzle-orm";
import { loadPresets } from "../../agent/providers/presets.ts";

export function transformProvider(row: any) {
  return {
    ...row,
    customModels: typeof row.customModels === "string" ? JSON.parse(row.customModels) : row.customModels,
  };
}

export const providersRouter = new Hono();

// GET /api/providers/presets
providersRouter.get("/presets", (c) => {
  return c.json(loadPresets());
});

// GET /api/providers
providersRouter.get("/", (c) => {
  const db = getDB();
  const rows = db.select().from(providerConfig).all();
  return c.json(rows.map(transformProvider));
});

// POST /api/providers — insert or update
providersRouter.post("/", async (c) => {
  const body = await c.req.json<{
    id: string; name: string; apiKey?: string; baseURL: string; enabled?: boolean;
  }>();
  const db = getDB();
  const existing = db.select().from(providerConfig).where(eq(providerConfig.id, body.id)).get();

  if (existing) {
    db.update(providerConfig).set({
      name: body.name,
      apiKey: body.apiKey ?? existing.apiKey,
      baseURL: body.baseURL,
      enabled: body.enabled !== false ? 1 : 0,
    }).where(eq(providerConfig.id, body.id)).run();
  } else {
    db.insert(providerConfig).values({
      id: body.id,
      name: body.name,
      apiKey: body.apiKey ?? "",
      baseURL: body.baseURL,
      enabled: body.enabled !== false ? 1 : 0,
      isCustom: 1,
      customModels: "[]",
    }).run();
  }

  const row = db.select().from(providerConfig).where(eq(providerConfig.id, body.id)).get();

  // Refresh caches + auto-fill routing
  try {
    const store = await import("../../agent/providers/store.ts");
    await store.refreshProviders();
    await store.autoFillRouting();
  } catch (err) { console.error("[providers] refresh failed:", err); }
  try {
    const router = await import("../../agent/providers/router.ts");
    router.clearModelCache();
  } catch (err) { console.error("[providers] clearModelCache failed:", err); }

  return c.json(transformProvider(row));
});

// DELETE /api/providers/:id
providersRouter.delete("/:id", async (c) => {
  const db = getDB();
  const id = c.req.param("id");

  // Clear routing entries referencing this provider
  const { modelRouting } = await import("../../storage/schema.ts");
  db.delete(modelRouting).where(eq(modelRouting.providerId, id)).run();
  db.delete(providerConfig).where(eq(providerConfig.id, id)).run();

  try {
    const store = await import("../../agent/providers/store.ts");
    await store.refreshProviders();
    await store.autoFillRouting();
  } catch (err) { console.error("[providers] refresh failed:", err); }
  import("../../agent/providers/router.ts").then(m => m.clearModelCache()).catch(err => console.error("[providers] clearModelCache failed:", err));

  return c.json({ deleted: true, id });
});
