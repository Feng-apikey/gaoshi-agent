<script setup lang="ts">
import type { Draft } from '../../types'

defineProps<{
  draft: Draft
  platformLabel: string
  typeLabel: string
}>()

const emit = defineEmits<{
  edit: []
  delete: []
}>()

function preview(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}
</script>

<template>
  <div class="draft-item" @click="emit('edit')">
    <div class="info">
      <div class="title-row">
        <span class="title">{{ draft.title || '无标题' }}</span>
        <span class="platform">{{ platformLabel }}</span>
        <span class="type">{{ typeLabel }}</span>
      </div>
      <div v-if="draft.content" class="preview">{{ preview(draft.content, 80) }}</div>
      <div class="meta">
        {{ new Date(draft.updatedAt).toLocaleString('zh-CN') }}
        <span :class="['status', draft.status]">
          {{ draft.status === 'draft' ? '草稿' : draft.status === 'pushed' ? '已推送' : '推送失败' }}
        </span>
      </div>
    </div>
    <div class="actions">
      <button class="act-btn del" @click.stop="emit('delete')" title="删除">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.draft-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s;
  overflow: hidden;
}

.draft-item:hover { border-color: var(--primary); }

.info { flex: 1; min-width: 0; overflow: hidden; }

.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.platform, .type {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--surface);
  color: var(--text-secondary);
  white-space: nowrap;
}

.preview {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.status {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
}

.status.draft { background: #FEF3C7; color: #92400E; }
.status.pushed { background: #D1FAE5; color: #065F46; }
.status.push_failed { background: #FEE2E2; color: #991B1B; }

.actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.draft-item:hover .actions { opacity: 1; }

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
}

.act-btn:hover { background: var(--hover); }
.act-btn.del:hover { color: var(--error); }
</style>
