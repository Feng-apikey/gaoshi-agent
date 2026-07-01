import type { Material } from '../types'

async function checkOk(res: Response): Promise<any> {
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export async function fetchMaterials(q?: string): Promise<Material[]> {
  const url = q ? `/api/materials?q=${encodeURIComponent(q)}` : '/api/materials'
  const res = await fetch(url)
  return checkOk(res)
}

export async function updateMaterial(id: string, data: { name?: string; tags?: string[] }): Promise<Material> {
  const res = await fetch(`/api/materials/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return checkOk(res)
}

export async function deleteMaterial(id: string): Promise<void> {
  const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`删除失败 (${res.status})`)
}

export async function analyzeMaterial(id: string): Promise<Material> {
  const res = await fetch(`/api/materials/${id}/analyze`, { method: 'POST' })
  return checkOk(res)
}
