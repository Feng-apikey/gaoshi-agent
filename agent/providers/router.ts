import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Capability } from "./types.ts";
import { loadProviders, getProvider, getRouting, setRouting } from "./store.ts";
import { getAvailableModels, getPreset } from "./presets.ts";

// ── Runtime cache ──

const modelCache = new Map<string, LanguageModel>();

function cacheKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

function resolveHeaders(raw: Record<string, string> | undefined, apiKey: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    resolved[k] = v.replace(/\{\{apiKey\}\}/g, () => apiKey);
  }
  return resolved;
}

// ── Resolve model ──

export function resolveModel(capability: Capability): { providerId: string; model: string; baseURL: string; apiKey: string; headers?: Record<string, string> } {
  // 1. Check explicit routing table (may have inline baseURL/apiKey)
  const route = getRouting(capability);
  if (route) {
    // Inline config takes priority
    if (route.baseURL && route.apiKey) {
      const preset = getPreset(route.providerId);
      return { providerId: route.providerId || "custom", model: route.model, baseURL: route.baseURL, apiKey: route.apiKey, headers: preset?.headers };
    }
    // Fall back to provider
    const provider = getProvider(route.providerId);
    if (provider) {
      const preset = getPreset(route.providerId);
      return { providerId: provider.id, model: route.model, baseURL: route.baseURL || provider.baseURL, apiKey: route.apiKey || provider.apiKey, headers: preset?.headers };
    }
  }

  // 2. Fallback: auto-discover from enabled providers and their presets
  const providers = loadProviders().filter(p => p.enabled);
  for (const p of providers) {
    const models = getAvailableModels(p.id, p.customModels);
    const model = models.find(m => m.capabilities.includes(capability));
    if (model) {
      const preset = getPreset(p.id);
      return { providerId: p.id, model: model.name, baseURL: p.baseURL, apiKey: p.apiKey, headers: preset?.headers };
    }
  }

  // 3. Nothing found — suggest fix
  const enabledIds = providers.map(p => p.id).join(', ') || '无';
  throw new Error(
    `没有可用的模型支持「${capability}」能力。\n\n已启用的 Provider: ${enabledIds}\n\n请在设置中配置模型路由。`
  );
}

export function getModel(capability: Capability): LanguageModel {
  const { model: modelName, baseURL, apiKey, headers } = resolveModel(capability);
  const key = cacheKey(baseURL + "|" + apiKey, modelName);

  if (!modelCache.has(key)) {
    const openai = createOpenAI({ baseURL, apiKey, headers: resolveHeaders(headers, apiKey) });
    modelCache.set(key, openai(modelName));
  }

  return modelCache.get(key)!;
}

// ── Warm cache / invalidate ──

export function clearModelCache(): void {
  modelCache.clear();
}

// ── Configuration helpers ──

export async function configureModel(capability: Capability, providerId: string, model: string, baseURL?: string, apiKey?: string): Promise<void> {
  await setRouting(capability, providerId, model, baseURL, apiKey);
  clearModelCache();
}
