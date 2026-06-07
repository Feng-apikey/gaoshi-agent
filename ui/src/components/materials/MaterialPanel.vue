<script setup lang="ts">
import { onMounted } from 'vue'
import { useMaterialsStore } from '../../stores/materials'
import UploadZone from './UploadZone.vue'
import MaterialFilter from './MaterialFilter.vue'
import MaterialItem from './MaterialItem.vue'

const { state, filtered, load } = useMaterialsStore()

onMounted(() => { load() })
</script>

<template>
  <div class="material-panel">
    <div class="header">
      <h3>素材</h3>
      <button class="refresh-btn" @click="load">刷新</button>
    </div>
    <UploadZone @uploaded="load" />
    <MaterialFilter v-model="state.filter" />
    <div v-if="filtered.length === 0" class="empty">暂无素材</div>
    <div v-else class="list">
      <MaterialItem
        v-for="m in filtered"
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

.empty { text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px 0; }

.list { display: flex; flex-direction: column; gap: 6px; }
</style>
