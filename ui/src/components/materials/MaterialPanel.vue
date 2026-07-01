<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMaterialsStore } from '../../stores/materials'
import UploadZone from './UploadZone.vue'
import MaterialFilter from './MaterialFilter.vue'
import MaterialItem from './MaterialItem.vue'

const { state, displayed, load } = useMaterialsStore()

onMounted(() => { load() })

const emptyHint = computed(() => {
  if (state.materials.length === 0) return '暂无素材'
  if (state.searchQuery.trim()) return `没有匹配 "${state.searchQuery.trim()}" 的素材`
  return '当前分类下没有素材'
})
</script>

<template>
  <div class="material-panel">
    <div class="header">
      <h3>素材</h3>
      <button class="refresh-btn" @click="load">刷新</button>
    </div>
    <UploadZone @uploaded="load" />
    <MaterialFilter v-model="state.filter" />
    <div class="search-row">
      <input
        v-model="state.searchQuery"
        class="search-input"
        type="search"
        placeholder="搜索名称 / 标签 / 描述"
      />
      <button
        v-if="state.searchQuery"
        class="search-clear"
        type="button"
        @click="state.searchQuery = ''"
        title="清空"
      >×</button>
      <span class="search-count">{{ displayed.length }} 项</span>
    </div>
    <div v-if="displayed.length === 0" class="empty">{{ emptyHint }}</div>
    <div v-else class="list">
      <MaterialItem
        v-for="m in displayed"
        :key="m.id"
        :material="m"
      />
    </div>
  </div>
</template>

<style scoped>
.material-panel { display: flex; flex-direction: column; gap: 12px; }

.header { display: flex; align-items: center; justify-content: space-between; }
.header h3 { font-size: 15px; font-weight: 600; }

.refresh-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: 12px;
  color: var(--text-secondary);
}

.refresh-btn:hover { border-color: var(--primary); color: var(--primary); }

.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: 12px;
  color: var(--text);
}
.search-input:focus { outline: none; border-color: var(--primary); }

.search-clear {
  border: none;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.search-clear:hover { color: var(--primary); }

.search-count {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.empty { text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px 0; }

.list { display: flex; flex-direction: column; gap: 6px; }
</style>
