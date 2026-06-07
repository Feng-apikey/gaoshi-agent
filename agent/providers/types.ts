export type Capability = "text" | "vision" | "video" | "image" | "tts" | "music";

export interface CustomModel {
  name: string;
  capabilities: Capability[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  enabled: boolean;
  /** true = user-defined aggregate provider (OpenRouter, OneAPI, etc.) */
  isCustom?: boolean;
  /** user-defined models for custom providers */
  customModels?: CustomModel[];
}

export interface RoutingEntry {
  capability: Capability;
  providerId: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export interface PresetModel {
  name: string;
  capabilities: Capability[];
}
