import { reactive } from 'vue'
import type { ProviderConfig, ModelRoute } from '../types'
import { fetchProviders, saveProvider, deleteProvider } from '../api/providers'
import { fetchRouting, updateRouting } from '../api/routing'
import { fetchSettings, updateSettings } from '../api/settings'

interface SettingsState {
  providers: ProviderConfig[]
  routing: Record<string, string>
  routingFull: ModelRoute[]
  totalTokens: number
  version: string
  autoApprove: boolean
}

const state = reactive<SettingsState>({
  providers: [],
  routing: {},
  routingFull: [],
  totalTokens: 0,
  version: '0.2.0',
  autoApprove: false,
})

export function useSettingsStore() {
  async function loadProviders() {
    try {
      state.providers = await fetchProviders()
    } catch {
      state.providers = []
    }
  }

  async function loadRouting() {
    try {
      state.routingFull = await fetchRouting()
      const map: Record<string, string> = {}
      for (const r of state.routingFull) {
        map[r.capability] = r.model
      }
      state.routing = map
    } catch {
      state.routingFull = []
    }
  }

  async function addProvider(p: { id: string; name: string; apiKey: string; baseURL: string; enabled: boolean }) {
    await saveProvider(p)
    await loadProviders()
    await loadRouting()
  }

  async function removeProvider(id: string) {
    await deleteProvider(id)
    state.providers = state.providers.filter(p => p.id !== id)
    await loadRouting()
  }

  async function saveRouting(capability: string, providerId: string, model: string, baseURL?: string, apiKey?: string) {
    const result = await updateRouting({ capability, providerId, model, baseURL, apiKey })
    state.routing[capability] = model
    const idx = state.routingFull.findIndex(r => r.capability === capability)
    if (idx !== -1) {
      state.routingFull[idx] = result
    } else {
      state.routingFull.push(result)
    }
  }

  async function loadSettings() {
    try {
      const s = await fetchSettings()
      state.autoApprove = s.autoApprove
    } catch {}
  }

  async function toggleAutoApprove() {
    const next = !state.autoApprove
    const s = await updateSettings({ autoApprove: next })
    state.autoApprove = s.autoApprove
  }

  loadProviders()
  loadRouting()
  loadSettings()

  return { state, loadProviders, loadRouting, addProvider, removeProvider, saveRouting, toggleAutoApprove }
}
