<script setup lang="ts">
const filter = defineModel<string>({ default: 'all' })

const options = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'document', label: '文档' },
]
</script>

<template>
  <div class="filter-row">
    <button
      v-for="o in options"
      :key="o.value"
      :class="['filter-btn', { active: filter === o.value }]"
      @click="filter = o.value"
    >{{ o.label }}</button>
  </div>
</template>

<style scoped>
.filter-row { display: flex; gap: 4px; }

.filter-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
</style>
