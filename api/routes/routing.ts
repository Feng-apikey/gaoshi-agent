import { Hono } from "hono";
import { getDB } from "../../storage/db.ts";
import { modelRouting } from "../../storage/schema.ts";
import { eq } from "drizzle-orm";

export const routingRouter = new Hono();

// GET /api/routing
routingRouter.get("/", (c) => {
  const db = getDB();
  const rows = db.select().from(modelRouting).all();
  return c.json(rows);
});

// PUT /api/routing — upsert a capability route
routingRouter.put("/", async (c) => {
  const body = await c.req.json<{ capability: string; providerId?: string; model: string; baseURL?: string; apiKey?: string }>();
  const db = getDB();

  if (!body.model) {
    // Empty model = clear this capability
    db.delete(modelRouting).where(eq(modelRouting.capability, body.capability)).run();
    try {
      const store = await import("../../agent/providers/store.ts");
      await store.refreshRouting();
    } catch {}
    try {
      const router = await import("../../agent/providers/router.ts");
      router.clearModelCache();
    } catch {}
    return c.json({ deleted: true, capability: body.capability });
  }

  const existing = db.select().from(modelRouting).where(eq(modelRouting.capability, body.capability)).get();
  const data = {
    providerId: body.providerId ?? "",
    model: body.model,
    baseURL: body.baseURL ?? "",
    apiKey: body.apiKey ?? "",
  };

  if (existing) {
    db.update(modelRouting).set(data).where(eq(modelRouting.capability, body.capability)).run();
  } else {
    db.insert(modelRouting).values({ capability: body.capability, ...data }).run();
  }

  const row = db.select().from(modelRouting).where(eq(modelRouting.capability, body.capability)).get();

  import("../../agent/providers/store.ts").then(m => m.refreshRouting()).catch(err => console.error("[routing] refreshRouting failed:", err));
  import("../../agent/providers/router.ts").then(m => m.clearModelCache()).catch(err => console.error("[routing] clearModelCache failed:", err));

  return c.json(row);
});
