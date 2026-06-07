export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  models: { name: string; capabilities: string[] }[];
}

export async function fetchPresets(): Promise<ProviderPreset[]> {
  const res = await fetch('/api/providers/presets');
  return res.json();
}
