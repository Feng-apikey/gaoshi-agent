<script setup lang="ts">
import { ref, computed } from 'vue'
import { uploadFile, getUploadUrl } from '../../api/upload'

const props = defineProps<{ streaming: boolean }>()
const emit = defineEmits<{ send: [text: string]; abort: [] }>()

const input = ref('')
const attachments = ref<{ id: string; url: string; name: string; type: string }[]>([])
const uploading = ref(false)

const inputDisabled = computed(() => uploading.value)

const fileInput = ref<HTMLInputElement | null>(null)

// ── File upload ──

async function addFiles(files: FileList | File[] | null) {
  if (!files || !files.length) return
  uploading.value = true
  for (const f of Array.from(files)) {
    try {
      const result = await uploadFile(f)
      attachments.value.push({ id: result.id, url: getUploadUrl(result.id), name: result.name, type: result.category ?? 'file' })
    } catch {
      input.value = '[图片上传失败] ' + input.value
    }
  }
  uploading.value = false
  if (fileInput.value) fileInput.value.value = ''
}


// ── Send ──

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(a => a.id !== id)
}

function send() {
  const text = input.value.trim()
  if (!text && attachments.value.length === 0) return

  let full = text
  for (const a of attachments.value) {
    if (a.type === 'image') {
      full += `\n![${a.name}](${a.url})`
    } else {
      full += `\n[${a.name}](${a.url})`
    }
  }
  emit('send', full.trim())
  input.value = ''
  attachments.value = []
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length) {
    e.preventDefault()
    e.stopPropagation()
    addFiles(files)
  }
}
</script>

<template>
  <div class="chat-input">
    <div v-if="attachments.length" class="preview-row">
      <div v-for="a in attachments" :key="a.id" class="preview-item" :title="a.name">
        <img v-if="a.type === 'image'" :src="a.url" />
        <div v-else-if="a.type === 'audio'" class="audio-icon">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 13V3l6-1v10" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="4" cy="13" r="2" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="11" cy="12" r="2" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        </div>
        <div v-else class="file-icon">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 1h8l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M3 1v4H0" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
        </div>
        <button class="remove-btn" @click="removeAttachment(a.id)">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>

    <div class="input-row">
      <button class="tool-btn" @click="fileInput?.click()" :disabled="inputDisabled" title="添加文件">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <input ref="fileInput" type="file" multiple hidden @change="addFiles(($event.target as HTMLInputElement).files)" />

      <textarea
        v-model="input"
        :placeholder="uploading ? '上传中...' : '输入消息，Enter 发送（可排队）'"
        rows="1"
        @keydown="onKeydown"
	        @paste="onPaste"
        :disabled="inputDisabled"
      />

      <button v-if="streaming" class="btn-abort" @click="emit('abort')" title="停止">
        <svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12" rx="1.5" fill="currentColor"/></svg>
      </button>
      <button class="btn-send" @click="send" :disabled="!input.trim() && attachments.length === 0" title="发送">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1.5 1.5l15 7.5-15 7.5 3-7.5-3-7.5z" fill="currentColor"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  border-top: 1px solid var(--border);
  padding: 10px 16px;
  background: var(--bg);
  flex-shrink: 0;
}

.preview-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  overflow-x: auto;
}

.preview-item {
  width: 44px;
  height: 44px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
}

.preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon, .audio-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  color: var(--text-muted);
}

.remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.preview-item:hover .remove-btn { opacity: 1; }

.input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}

.tool-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.tool-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: 14px;
  resize: none;
  line-height: 1.5;
  background: var(--surface);
  color: var(--text-primary);
  min-height: 36px;
  max-height: 120px;
}

textarea:focus { outline: none; border-color: var(--primary); background: var(--bg); }

.btn-send, .btn-abort {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-send {
  background: var(--primary);
  color: #fff;
}

.btn-send:hover:not(:disabled) { background: var(--primary-hover); }
.btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-abort {
  background: var(--error);
  color: #fff;
}
</style>
