<script setup lang="ts">
const tabs = [
  { key: 'drafts', label: '草稿' },
  { key: 'materials', label: '素材' },
  { key: 'settings', label: '设置' },
]
const activeTab = defineModel<string>('activeTab', { default: 'drafts' })
</script>

<template>
  <aside class="sidebar">
    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="['tab', { active: activeTab === t.key }]"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>
    <div class="panel">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: clamp(280px, 32vw, 400px);
  min-width: 260px;
  max-width: 420px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 8px;
  gap: 4px;
  flex-shrink: 0;
}

.tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  border-radius: var(--radius);
  transition: background 0.15s, color 0.15s;
}

.tab:hover {
  background: var(--hover);
  color: var(--text-primary);
}

.tab.active {
  background: var(--bg);
  color: var(--primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  min-width: 0;
}
</style>
