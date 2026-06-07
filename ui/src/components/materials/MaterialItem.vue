<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Material } from '../../types'
import { useMaterialsStore } from '../../stores/materials'
import { getUploadUrl } from '../../api/upload'

const props = defineProps<{ material: Material }>()

const { rename, updateTags, remove, analyze, analyzing } = useMaterialsStore()

const isAnalyzing = computed(() => analyzing.has(props.material.id))

const editing = ref(false)
const editName = ref('')
const editingTags = ref(false)
const editTags = ref('')

const previewUrl = computed(() => getUploadUrl(props.material.id))

function startRename() {
  editName.value = props.material.name
  editing.value = true
}

async function commitRename() {
  try {
    if (editName.value.trim() && editName.value !== props.material.name) {
      await rename(props.material.id, editName.value.trim())
    }
  } catch (err: any) {
    alert(`改名失败: ${err?.message ?? '未知错误'}`)
  } finally {
    editing.value = false
  }
}

function startTagEdit() {
  if (editingTags.value) return
  editTags.value = (props.material.tags ?? []).join(', ')
  editingTags.value = true
}

async function commitTags() {
  try {
    const tags = editTags.value.split(',').map(s => s.trim()).filter(Boolean)
    await updateTags(props.material.id, tags)
  } catch (err: any) {
    alert(`标签保存失败: ${err?.message ?? '未知错误'}`)
  } finally {
    editingTags.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
</script>

<template>
  <div class="material-item">
    <!-- Thumbnail -->
    <a class="thumb" :href="previewUrl" target="_blank" @click.stop>
      <template v-if="material.category === 'image'">
        <img :src="previewUrl" :alt="material.name" />
      </template>
      <template v-else>
        <div class="file-icon">
          <svg v-if="material.category === 'video'" width="20" height="20" viewBox="0 0 20 20"><polygon points="5,2 17,10 5,18" fill="currentColor"/></svg>
          <svg v-else-if="material.category === 'audio'" width="20" height="20" viewBox="0 0 20 20"><path d="M5 15V5l8-1v11" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="4" cy="15" r="2.5" stroke="currentColor" stroke-width="1.2"/><circle cx="13" cy="15" r="2.5" stroke="currentColor" stroke-width="1.2"/></svg>
          <svg v-else width="20" height="20" viewBox="0 0 20 20"><path d="M4 1h12l3 4v13a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M4 1v4H1" stroke="currentColor" stroke-width="1.2"/></svg>
        </div>
      </template>
    </a>

    <!-- Info -->
    <div class="info">
      <div v-if="editing" class="rename-row">
        <input
          v-model="editName"
          class="rename-input"
          @keydown.enter="commitRename"
          @keydown.escape="editing = false"
          @blur="commitRename"
        />
      </div>
      <div v-else class="name" @dblclick="startRename" :title="material.name">{{ material.name }}</div>
      <div class="meta">{{ material.category }} · {{ formatSize(material.size) }}</div>
      <div v-if="editingTags" class="tag-edit-row" @click.stop>
        <input
          v-model="editTags"
          class="tag-input"
          placeholder="标签，逗号分隔"
          @keydown.enter="commitTags"
          @keydown.escape="editingTags = false"
          @blur="commitTags"
        />
      </div>
      <div v-else class="tags" @click="startTagEdit" title="点击编辑标签">
        <span v-if="material.tags && material.tags.length">
          <span v-for="t in material.tags" :key="t" class="tag">{{ t }}</span>
        </span>
        <span v-else class="tag-placeholder">+ 添加标签</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button class="act-btn analyze" :class="{ loading: isAnalyzing }" :disabled="isAnalyzing" @click="analyze(material.id)" :title="isAnalyzing ? 'AI 分析中...' : 'AI 分析'">
        <span v-if="isAnalyzing" class="spinner"></span>
        <template v-else>AI</template>
      </button>
      <button class="act-btn edit" @click="startRename" title="改名">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 10.5V12h1.5l7.5-7.5-1.5-1.5L2 10.5zM11.5 2c-.4 0-.8.15-1.1.45L9 3.85l1.5 1.5 1.4-1.4c.3-.3.3-.8 0-1.1l-.3-.4C11.3 2.15 10.9 2 11.5 2z" fill="currentColor"/></svg>
      </button>
      <button class="act-btn del" @click="remove(material.id)" title="删除">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>

  </div>
</template>

<style scoped>
.material-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s;
  overflow: hidden;
}

.material-item:hover { border-color: var(--primary); }

.thumb {
  width: 56px;
  height: 56px;
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: inherit;
}

.thumb img { width: 100%; height: 100%; object-fit: cover; }

.file-icon { color: var(--text-muted); }

.info { flex: 1; min-width: 0; overflow: hidden; }

.name {
  font-size: 13px;
  font-weight: 600;
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.tags { display: flex; gap: 3px; margin-top: 4px; flex-wrap: wrap; cursor: pointer; min-height: 18px; }
.tags:hover { opacity: 0.7; }

.tag {
  padding: 1px 6px;
  background: #F5F3FF;
  color: var(--primary);
  border-radius: 10px;
  font-size: 10px;
}

.tag-placeholder {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}

.tag-edit-row { width: 100%; margin-top: 4px; }
.tag-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  font-size: 11px;
}

.rename-row { width: 100%; }
.rename-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  align-items: flex-start;
  opacity: 0;
  transition: opacity 0.15s;
}

.material-item:hover .actions { opacity: 1; }

.act-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.act-btn:hover { background: var(--hover); }
.act-btn.del:hover { color: var(--error); }
.act-btn.analyze:hover { color: var(--primary); }
.act-btn.analyze.loading { color: var(--primary); cursor: default; }

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
