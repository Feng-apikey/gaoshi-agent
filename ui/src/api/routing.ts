import type { ModelRoute } from '../types'

export async function fetchRouting(): Promise<ModelRoute[]> {
  const res = await fetch('/api/routing')
  return res.json()
}

export async function updateRouting(data: { capability: string; providerId?: string; model: string; baseURL?: string; apiKey?: string }): Promise<ModelRoute> {
  const res = await fetch('/api/routing', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}
