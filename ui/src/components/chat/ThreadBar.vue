<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { Thread } from '../../types'

const props = defineProps<{
  threads: Thread[]
  activeThreadId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  new: []
  delete: [id: string]
}>()

const showDropdown = ref(false)
const confirmDelete = ref<string | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

function toggleDropdown() { showDropdown.value = !showDropdown.value }
function onSelect(id: string) { showDropdown.value = false; emit('select', id) }

function onNew() {
  showDropdown.value = false
  emit('new')
}

function onDeleteClick(e: MouseEvent, id: string) {
  e.stopPropagation()
  confirmDelete.value = id
}

function onDocumentClick(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div class="thread-bar">
    <div ref="dropdownRef" class="dropdown">
      <button class="trigger" @click="toggleDropdown">
        <span class="label">
          {{ activeThreadId
            ? (threads.find(t => t.id === activeThreadId)?.title ?? '对话')
            : '新建对话' }}
        </span>
        <svg class="chevron" :class="{ open: showDropdown }" width="12" height="12" viewBox="0 0 12 12">
          <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <div v-if="showDropdown" class="menu">
        <div v-if="threads.length === 0" class="empty">暂无对话</div>
        <div
          v-for="t in threads"
          :key="t.id"
          class="item"
          :class="{ active: t.id === activeThreadId }"
          @click="onSelect(t.id)"
        >
          <span class="title">{{ t.title }}</span>
          <button
            v-if="confirmDelete === t.id"
            class="del-confirm"
            @click.stop="emit('delete', t.id); confirmDelete = null"
          >确认删除</button>
          <button v-else class="del" @click="onDeleteClick($event, t.id)">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    </div>
    <button class="new-btn" @click="onNew">+ 新对话</button>
  </div>
</template>

<style scoped>
.thread-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
}

.dropdown {
  position: relative;
  flex: 1;
}

.trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
}

.trigger:hover { border-color: var(--primary); }

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.chevron { transition: transform 0.2s; flex-shrink: 0; color: var(--text-muted); }
.chevron.open { transform: rotate(180deg); }

.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
}

.empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.item:hover { background: var(--hover); }
.item.active { background: var(--surface); color: var(--primary); }

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.del, .del-confirm {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 2px;
  color: var(--text-muted);
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.del:hover { color: var(--error); background: var(--hover); }

.del-confirm {
  color: var(--error);
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--error);
  border-radius: 4px;
}

.new-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.new-btn:hover {
  background: var(--primary);
  color: #fff;
}
</style>
