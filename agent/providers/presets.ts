import type { Capability } from "./types.ts";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  note?: string;
  headers?: Record<string, string>;
  models: { name: string; capabilities: Capability[] }[];
}

const CONFIG_DIR = path.join(process.cwd(), "config");
const PRESETS_FILE = path.join(CONFIG_DIR, "providers.json");
const PRESETS_EXAMPLE = path.join(CONFIG_DIR, "providers.example.json");

let _presetsCache: ProviderPreset[] | null = null;
let _presetsMtime = 0;

function ensurePresetsFile(): boolean {
  if (fs.existsSync(PRESETS_FILE)) return true;
  if (!fs.existsSync(PRESETS_EXAMPLE)) return false;
  try {
    fs.copyFileSync(PRESETS_EXAMPLE, PRESETS_FILE);
    return true;
  } catch {
    return false;
  }
}

export function loadPresets(): ProviderPreset[] {
  try {
    if (!ensurePresetsFile()) return _presetsCache ?? [];
    const stat = fs.statSync(PRESETS_FILE);
    if (!_presetsCache || stat.mtimeMs > _presetsMtime) {
      const raw = fs.readFileSync(PRESETS_FILE, "utf-8");
      _presetsCache = JSON.parse(raw);
      _presetsMtime = stat.mtimeMs;
    }
    return _presetsCache ?? [];
  } catch {
    return _presetsCache ?? [];
  }
}

export function getPreset(providerId: string): ProviderPreset | undefined {
  return loadPresets().find(p => p.id === providerId);
}

export function getAvailableModels(
  providerId: string,
  customModels?: { name: string; capabilities: Capability[] }[],
): { name: string; capabilities: Capability[] }[] {
  if (Array.isArray(customModels) && customModels.length > 0) return customModels;
  const preset = getPreset(providerId);
  return preset?.models.map(m => ({ name: m.name, capabilities: [...m.capabilities] })) ?? [];
}
