import { reactive, computed } from 'vue'
import type { Material } from '../types'
import { fetchMaterials, updateMaterial, deleteMaterial, analyzeMaterial } from '../api/materials'

interface MaterialsState {
  materials: Material[]
  filter: 'all' | 'image' | 'video' | 'audio' | 'document'
  uploading: boolean
}

const state = reactive<MaterialsState>({
  materials: [],
  filter: 'all',
  uploading: false,
})

const analyzing = reactive(new Set<string>())

export function useMaterialsStore() {
  const filtered = computed(() => {
    if (state.filter === 'all') return state.materials
    return state.materials.filter(m => m.category === state.filter)
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

  return { state, filtered, analyzing, load, rename, updateTags, remove, analyze }
}
