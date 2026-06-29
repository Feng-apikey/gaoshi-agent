import type { ProviderConfig, RoutingEntry, Capability } from "./types.ts";

// ── Lazy DB access ──

async function getDB() {
  const { getDB: g } = await import("../../storage/db.ts");
  return g();
}

async function getTables() {
  const { providerConfig: pc } = await import("../../storage/schema.ts");
  const { modelRouting: mr } = await import("../../storage/schema.ts");
  return { providerConfig: pc, modelRouting: mr };
}

// ── Providers (from SQLite) ──

let _providersCache: ProviderConfig[] | null = null;
let _providersCacheTime = 0;

export function loadProviders(): ProviderConfig[] {
  // Return cached synchronously; refresh from DB async
  return _providersCache ?? [];
}

export async function refreshProviders(): Promise<ProviderConfig[]> {
  try {
    const db = await getDB();
    const { providerConfig: pc } = await getTables();
    const rows = db.select().from(pc).all();
    _providersCache = rows.map((r: any) => ({
      ...r,
      enabled: r.enabled === 1,
      isCustom: r.isCustom === 1,
      customModels: typeof r.customModels === "string" ? JSON.parse(r.customModels) : (r.customModels ?? []),
    }));
    _providersCacheTime = Date.now();
    return _providersCache;
  } catch {
    _providersCache = [];
    return [];
  }
}

export function getProvider(id: string): ProviderConfig | undefined {
  return loadProviders().find(p => p.id === id && p.enabled);
}

// ── Routing (from SQLite) ──

let _routingCache: RoutingEntry[] | null = null;

export function loadRouting(): RoutingEntry[] {
  return _routingCache ?? [];
}

export async function refreshRouting(): Promise<RoutingEntry[]> {
  try {
    const db = await getDB();
    const { modelRouting: mr } = await getTables();
    // drizzle's inferred row type uses string for capability and string|null for nullable cols;
    // RoutingEntry narrows capability to the Capability union and expects non-null strings.
    // Cast at the boundary; runtime values are already correct.
    const rows = db.select().from(mr).all() as unknown as RoutingEntry[];
    _routingCache = rows;
    return rows;
  } catch {
    _routingCache = [];
    return [];
  }
}

export function getRouting(capability: Capability): RoutingEntry | undefined {
  return loadRouting().find(r => r.capability === capability);
}

export async function setRouting(
  capability: Capability,
  providerId: string,
  model: string,
  baseURL?: string,
  apiKey?: string,
): Promise<void> {
  try {
    const db = await getDB();
    const { modelRouting: mr } = await getTables();
    const { eq } = await import("drizzle-orm");
    const existing = db.select().from(mr).where(eq(mr.capability, capability)).get();
    const data = { providerId, model, baseURL: baseURL ?? "", apiKey: apiKey ?? "" };
    if (existing) {
      db.update(mr).set(data).where(eq(mr.capability, capability)).run();
    } else {
      db.insert(mr).values({ capability, ...data }).run();
    }
    await refreshRouting();
  } catch (err) {
    console.error("[store] setRouting failed:", err);
    throw err;
  }
}

// ── Auto-fill routing from providers ──

export async function autoFillRouting(): Promise<void> {
  const { getAvailableModels } = await import("./presets.ts");
  const providers = loadProviders().filter(p => p.enabled);
  const capabilities: Capability[] = ["text", "vision", "video", "image", "tts", "music"];

  for (const cap of capabilities) {
    // Skip if user already configured a routing for this capability
    if (getRouting(cap)) continue;

    for (const p of providers) {
      const models = getAvailableModels(p.id, p.customModels);
      const m = models.find((m: any) => m.capabilities.includes(cap));
      if (m) {
        await setRouting(cap, p.id, m.name);
        break;
      }
    }
  }
}

// ── Init ──

export async function initProviderStore(): Promise<void> {
  await refreshProviders();
  await refreshRouting();
  await autoFillRouting();
}
