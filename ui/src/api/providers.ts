import type { ProviderConfig } from '../types'

export async function fetchProviders(): Promise<ProviderConfig[]> {
  const res = await fetch('/api/providers')
  return res.json()
}

export async function saveProvider(data: { id: string; name: string; apiKey: string; baseURL: string; enabled: boolean }): Promise<ProviderConfig> {
  const res = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteProvider(id: string): Promise<void> {
  await fetch(`/api/providers/${id}`, { method: 'DELETE' })
}
