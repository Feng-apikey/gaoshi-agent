import { reactive } from 'vue'
import type { Draft, ContentType, Platform } from '../types'
import { fetchDrafts, updateDraft, deleteDraft, createDraft } from '../api/drafts'

interface DraftsState {
  drafts: Draft[]
  loading: boolean
}

const state = reactive<DraftsState>({
  drafts: [],
  loading: false,
})

export function useDraftsStore() {
  async function load() {
    state.loading = true
    try {
      state.drafts = await fetchDrafts()
    } finally {
      state.loading = false
    }
  }

  async function rename(id: string, title: string) {
    await updateDraft(id, { title })
    const d = state.drafts.find(d => d.id === id)
    if (d) d.title = title
  }

  async function remove(id: string) {
    try {
      await deleteDraft(id)
      state.drafts = state.drafts.filter(d => d.id !== id)
    } catch (err: any) {
      alert('删除失败: ' + (err?.message ?? '未知错误'))
    }
  }

  async function create(data: { title: string; content: string; platform: Platform; type: ContentType; tags: string[]; images?: string[]; video?: string; cover?: string; header?: string; abstract?: string }) {
    const draft = await createDraft(data)
    if ((draft as any).error) return draft // validation failed, don't push to list
    state.drafts.unshift(draft)
    return draft
  }

  async function save(id: string, data: { title?: string; content?: string; platform?: string; type?: string; tags?: string[]; images?: string[]; video?: string; cover?: string; header?: string; abstract?: string }) {
    const updated = await updateDraft(id, data)
    if ((updated as any).error) return updated // validation failed, don't update
    const idx = state.drafts.findIndex(d => d.id === id)
    if (idx !== -1) state.drafts[idx] = updated
    return updated
  }

  load().catch(() => {})

  return { state, load, rename, remove, create, save }
}
