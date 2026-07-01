import { reactive, computed } from 'vue'
import type { Material } from '../types'
import { fetchMaterials, updateMaterial, deleteMaterial, analyzeMaterial } from '../api/materials'

interface MaterialsState {
  materials: Material[]
  filter: 'all' | 'image' | 'video' | 'audio' | 'document'
  searchQuery: string
  uploading: boolean
}

const state = reactive<MaterialsState>({
  materials: [],
  filter: 'all',
  searchQuery: '',
  uploading: false,
})

const analyzing = reactive(new Set<string>())

function matchesQuery(m: Material, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  if ((m.name ?? '').toLowerCase().includes(needle)) return true
  if ((m.description ?? '').toLowerCase().includes(needle)) return true
  if (Array.isArray(m.tags) && m.tags.some(t => t.toLowerCase().includes(needle))) return true
  return false
}

export function useMaterialsStore() {
  // Final visible list: search + category filter.
  // Source of truth for `materials` stays the full set returned by the server;
  // search/filter only narrow the rendered view, never mutate cached rows.
  const displayed = computed(() => {
    const q = state.searchQuery.trim()
    return state.materials.filter(m => {
      if (state.filter !== 'all' && m.category !== state.filter) return false
      return matchesQuery(m, q)
    })
  })

  async function load() {
    try {
      state.materials = await fetchMaterials()
    } catch {
      state.materials = []
    }
  }

  async function rename(id: string, name: string) {
    await updateMaterial(id, { name })
    const m = state.materials.find(m => m.id === id)
    if (m) m.name = name
  }

  async function updateTags(id: string, tags: string[]) {
    await updateMaterial(id, { tags })
    const m = state.materials.find(m => m.id === id)
    if (m) m.tags = tags
  }

  async function remove(id: string) {
    try {
      await deleteMaterial(id)
      state.materials = state.materials.filter(m => m.id !== id)
    } catch (err: any) {
      alert(`删除失败: ${err?.message ?? '未知错误'}`)
    }
  }

  async function analyze(id: string) {
    analyzing.add(id)
    try {
      const updated = await analyzeMaterial(id)
      const m = state.materials.find(m => m.id === id)
      if (m) {
        m.tags = updated.tags
        m.description = updated.description
      }
    } catch (err: any) {
      alert(`AI 分析失败: ${err?.message ?? '未知错误'}`)
    } finally {
      analyzing.delete(id)
    }
  }

  load()

  return { state, displayed, analyzing, load, rename, updateTags, remove, analyze }
}
