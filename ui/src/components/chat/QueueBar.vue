<script setup lang="ts">
import { useChatStore } from '../../stores/chat'

const { state, cancelQueueItem } = useChatStore()
</script>

<template>
  <div v-if="state.queue.length" class="queue-bar">
    <span class="queue-icon">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M7 4v3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </span>
    <span class="queue-text">{{ state.queue.length }} 条排队中</span>
    <div class="queue-items">
      <div v-for="q in state.queue" :key="q.id" class="queue-item">
        <span class="queue-content">{{ q.content }}</span>
        <button class="queue-cancel" @click="cancelQueueItem(q.id)" title="取消">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queue-bar {
  padding: 4px 16px;
  background: var(--hover);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.queue-icon { color: var(--text-muted); display: flex; }
.queue-text { font-size: 12px; color: var(--text-secondary); }
.queue-items { display: flex; gap: 4px; flex-wrap: wrap; }
.queue-item {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 11px;
  max-width: 180px;
}
.queue-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.queue-cancel {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  display: flex;
  flex-shrink: 0;
}
.queue-cancel:hover { color: var(--error); }
</style>
