import type { Draft } from '../types'

export async function fetchDrafts(): Promise<Draft[]> {
  const res = await fetch('/api/drafts')
  return res.json()
}

export async function createDraft(data: {
  title: string; content: string; platform: string; type: string; tags?: string[]
  images?: string[]; video?: string; cover?: string; header?: string; abstract?: string
}): Promise<Draft> {
  const res = await fetch('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function updateDraft(id: string, data: {
  title?: string; content?: string; tags?: string[]; platform?: string; type?: string
  images?: string[]; video?: string; cover?: string; header?: string; abstract?: string
}): Promise<Draft> {
  const res = await fetch(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteDraft(id: string): Promise<void> {
  const res = await fetch(`/api/drafts/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).error || `删除失败 (${res.status})`)
  }
}
