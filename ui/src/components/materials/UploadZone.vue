<script setup lang="ts">
import { ref } from 'vue'
import { uploadFile } from '../../api/upload'

const emit = defineEmits<{ uploaded: [] }>()

const uploading = ref(false)
const dragOver = ref(false)

async function handleFiles(files: FileList | null) {
  if (!files) return
  uploading.value = true
  for (const f of Array.from(files)) {
    try { await uploadFile(f) } catch {}
  }
  uploading.value = false
  dragOver.value = false
  emit('uploaded')
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  handleFiles(e.dataTransfer?.files ?? null)
}

function onDragOver(e: DragEvent) { e.preventDefault(); dragOver.value = true }
function onDragLeave() { dragOver.value = false }
</script>

<template>
  <label
    :class="['upload-zone', { dragging: dragOver, uploading }]"
    @drop.prevent="onDrop"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
  >
    <input
      type="file"
      multiple
      hidden
      @change="handleFiles(($event.target as HTMLInputElement).files)"
    />
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 6v12M6 12h12" stroke-linecap="round"/>
    </svg>
    <span v-if="uploading">上传中...</span>
    <span v-else>拖拽文件到此处，或点击上传</span>
  </label>
</template>

<style scoped>
.upload-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  transition: border-color 0.15s, background 0.15s;
}

.upload-zone:hover, .upload-zone.dragging {
  border-color: var(--primary);
  background: #F5F3FF;
  color: var(--primary);
}

.upload-zone.uploading { opacity: 0.6; pointer-events: none; }
</style>
