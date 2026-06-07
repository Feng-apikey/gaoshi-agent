<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useOfflineSync } from '../../utils/offline-sync'
import type { Inspiration } from '../../utils/offline-sync'

interface QueueItem extends Inspiration { id: number }

const { saveLocally, getAll, remove } = useOfflineSync()

// ── Connection state ──
type ConnState = 'online' | 'offline' | 'syncing' | 'error'
const conn = ref<ConnState>('offline')
const syncMsg = ref('')
const queue = ref<QueueItem[]>([])

async function checkOnline(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch { return false }
}

async function refreshState() {
  const ok = await checkOnline()
  if (ok && queue.value.length > 0) {
    await syncAll()
  }
  conn.value = ok ? (queue.value.length > 0 ? 'syncing' : 'online') : 'offline'
  queue.value = await getAll() as QueueItem[]
}

async function syncAll() {
  conn.value = 'syncing'
  syncMsg.value = ''
  const items = await getAll() as QueueItem[]
  let ok = 0
  let fail = 0

  for (const item of items) {
    try {
      // Upload images/video first, then create draft
      const imageIds: string[] = []
      for (const b64 of item.images) {
        const file = dataURLtoFile(b64, 'inspiration.jpg')
        const fid = await uploadFile(file)
        if (fid) imageIds.push(fid)
      }
      let videoId = ''
      if (item.video) {
        const file = dataURLtoFile(item.video, 'inspiration.mp4')
        videoId = await uploadFile(file) || ''
      }

      const body: Record<string, any> = {
        title: item.title || item.content.slice(0, 20),
        content: item.content,
        platform: item.platform,
        type: item.type,
        tags: item.tags ?? [],
      }
      if (imageIds.length) body.images = imageIds
      if (videoId) body.video = videoId

      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        await remove(item.id)
        ok++
      } else { fail++ }
    } catch { fail++ }
  }

  queue.value = await getAll() as QueueItem[]
  if (fail > 0) {
    conn.value = 'error'
    syncMsg.value = `${ok} 条同步成功，${fail} 条失败`
  } else {
    conn.value = queue.value.length > 0 ? 'offline' : 'online'
    syncMsg.value = ok > 0 ? `${ok} 条同步成功` : ''
  }
}

async function uploadFile(file: File): Promise<string | null> {
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()
    return data.id ?? null
  } catch { return null }
}

function dataURLtoFile(dataURL: string, filename: string): File {
  const [head, body] = dataURL.split(',')
  const mime = head.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bstr = atob(body)
  const arr = new Uint8Array(bstr.length)
  for (let i = 0; i < bstr.length; i++) arr[i] = bstr.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}

// ── Form state ──
const content = ref('')
const photo = ref('')
const video = ref('')
const platform = ref('小红书')
const saving = ref(false)
const saved = ref<'idle' | 'ok' | 'local'>('idle')

const canSave = computed(() => !!content.value.trim() || !!photo.value || !!video.value)

// ── Photo / Video capture ──
const photoInput = ref<HTMLInputElement>()
const videoInput = ref<HTMLInputElement>()

function onPhotoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  clearVideo()
  const reader = new FileReader()
  reader.onload = () => { photo.value = reader.result as string }
  reader.readAsDataURL(file)
}

function onVideoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  clearPhoto()
  const reader = new FileReader()
  reader.onload = () => { video.value = reader.result as string }
  reader.readAsDataURL(file)
}

function clearPhoto() { photo.value = ''; if (photoInput.value) photoInput.value.value = '' }
function clearVideo() { video.value = ''; if (videoInput.value) videoInput.value.value = '' }

function draftType(p: string, hasVideo: boolean): string {
  if (hasVideo) return 'video'
  if (p === 'B站') return 'dynamic'
  return 'image_text'
}

// ── Save ──
async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  saved.value = 'idle'

  if (conn.value === 'online' || conn.value === 'error') {
    // Try online save
    try {
      const imageIds: string[] = []
      if (photo.value) {
        const file = dataURLtoFile(photo.value, 'inspiration.jpg')
        const fid = await uploadFile(file)
        if (fid) imageIds.push(fid)
      }
      let videoId = ''
      if (video.value) {
        const file = dataURLtoFile(video.value, 'inspiration.mp4')
        videoId = await uploadFile(file) || ''
      }

      const body: Record<string, any> = {
        title: content.value.slice(0, 20) || '灵感',
        content: content.value,
        platform: platform.value,
        type: draftType(platform.value, !!videoId),
        tags: [],
      }
      if (imageIds.length) body.images = imageIds
      if (videoId) body.video = videoId

      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        resetForm()
        saved.value = 'ok'
        conn.value = 'online'
        if (queue.value.length > 0) syncAll()
        return
      }
    } catch {}
  }

  // Fallback: save locally
  await saveLocally({
    title: content.value.slice(0, 20) || '灵感',
    content: content.value,
    images: photo.value ? [photo.value] : [],
    video: video.value || '',
    platform: platform.value,
    type: draftType(platform.value, !!video.value),
    tags: [],
  })
  conn.value = 'offline'
  resetForm()
  saved.value = 'local'
  queue.value = await getAll() as QueueItem[]
}

function resetForm() {
  content.value = ''
  photo.value = ''
  video.value = ''
  if (photoInput.value) photoInput.value.value = ''
  if (videoInput.value) videoInput.value.value = ''
  saving.value = false
  setTimeout(() => { saved.value = 'idle' }, 2000)
}

// ── Delete from queue ──
async function deleteQueueItem(id: number) {
  await remove(id)
  queue.value = await getAll() as QueueItem[]
}

// ── Init ──

async function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    queue.value = await getAll() as QueueItem[]
    const online = await checkOnline()
    if (online && queue.value.length > 0) {
      syncAll()
    }
    conn.value = online ? (queue.value.length > 0 ? 'syncing' : 'online') : 'offline'
  }
}

onMounted(async () => {
  queue.value = await getAll() as QueueItem[]
  const ok = await checkOnline()
  if (ok && queue.value.length > 0) {
    await syncAll()
  }
  conn.value = ok ? (queue.value.length > 0 ? 'syncing' : 'online') : 'offline'
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// Detect iOS safe area
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
</script>

<template>
  <div class="inspire-pad" :class="{ ios: isIOS }">
    <!-- Header -->
    <header class="ip-header">
      <h1>灵感速记</h1>
      <span
        class="conn-dot"
        :class="conn"
        :title="conn === 'online' ? '已连接桌面端' : conn === 'offline' ? '离线 · ' + queue.length + '条待同步' : conn === 'syncing' ? '同步中...' : '同步出错'"
      />
    </header>

    <!-- Sync message -->
    <div v-if="syncMsg" class="sync-toast" :class="conn === 'error' ? 'sync-error' : 'sync-ok'">
      {{ syncMsg }}
    </div>

    <!-- Input area -->
    <textarea
      v-model="content"
      class="ip-textarea"
      placeholder="记录你的灵感..."
      rows="5"
    />

    <!-- Media capture (photo & video are mutually exclusive) -->
    <div class="ip-media">
      <!-- Photo -->
      <div v-if="!photo && !video" class="capture-btn" @click="photoInput?.click()">
        <span class="cap-icon">📷</span>
        <span>拍照</span>
      </div>
      <div v-else-if="photo" class="preview-box photo">
        <img :src="photo" class="preview-thumb" />
        <button class="preview-del" @click="clearPhoto">&times;</button>
      </div>

      <!-- Video -->
      <div v-if="!photo && !video" class="capture-btn" @click="videoInput?.click()">
        <span class="cap-icon">🎬</span>
        <span>短视频</span>
      </div>
      <div v-else-if="video" class="preview-box video">
        <video :src="video" class="preview-thumb" muted />
        <span class="video-badge">▶</span>
        <button class="preview-del" @click="clearVideo">&times;</button>
      </div>

      <input ref="photoInput" type="file" accept="image/*" hidden @change="onPhotoChange" />
      <input ref="videoInput" type="file" accept="video/*" hidden @change="onVideoChange" />
    </div>

    <!-- Platform -->
    <label class="ip-platform">
      <span>平台</span>
      <select v-model="platform">
        <option>小红书</option>
        <option>B站</option>
        <option>抖音</option>
      </select>
    </label>

    <!-- Save button -->
    <button
      class="ip-save"
      :class="{ disabled: !canSave, saving, ok: saved === 'ok', local: saved === 'local' }"
      :disabled="!canSave || saving"
      @click="handleSave"
    >
      <template v-if="saving">保存中...</template>
      <template v-else-if="saved === 'ok'">✓ 已保存</template>
      <template v-else-if="saved === 'local'">✓ 已存本地</template>
      <template v-else>💾 保存灵感</template>
    </button>

    <!-- Offline queue -->
    <div v-if="queue.length > 0" class="ip-queue">
      <div class="queue-title">离线队列 · {{ queue.length }} 条</div>
      <div v-for="item in queue" :key="item.id" class="queue-item">
        <span class="queue-text">{{ item.content.slice(0, 15) || '(仅图片)' }}</span>
        <button class="queue-del" @click="deleteQueueItem(item.id)" :disabled="conn === 'syncing'">&times;</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.inspire-pad {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px;
  padding-bottom: max(24px, env(safe-area-inset-bottom, 16px));
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg, #fff);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* Header */
.ip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.ip-header h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #1a1a1a);
}

.conn-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.conn-dot.online { background: #22c55e; box-shadow: 0 0 4px rgba(34,197,94,0.4); }
.conn-dot.offline { background: #f59e0b; }
.conn-dot.syncing { background: #3b82f6; animation: pulse 1s infinite; }
.conn-dot.error { background: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Sync toast */
.sync-toast {
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 8px;
}
.sync-ok { background: #dcfce7; color: #166534; }
.sync-error { background: #fef3c7; color: #92400e; }

/* Textarea */
.ip-textarea {
  width: 100%;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 10px;
  padding: 14px;
  font-size: 16px; /* 16px prevents iOS zoom */
  line-height: 1.6;
  resize: none;
  background: var(--surface, #f9fafb);
  color: var(--text-primary, #1a1a1a);
}
.ip-textarea:focus { outline: none; border-color: var(--primary, #5E6AD2); }
.ip-textarea::placeholder { color: var(--text-muted, #aaa); }

/* Media capture */
.ip-media {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.capture-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 0;
  border: 2px dashed var(--border, #e5e5e5);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-muted, #888);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.capture-btn:active { border-color: var(--primary, #5E6AD2); color: var(--primary, #5E6AD2); }
.cap-icon { font-size: 24px; }

.preview-box {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border, #e5e5e5);
}
.preview-box.photo {
  width: 120px; height: 120px;
  flex-shrink: 0;
}
.preview-box.video {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 240px;
}
.preview-thumb {
  width: 100%; height: 100%;
  object-fit: cover;
}
.video-badge {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 28px; height: 28px;
  background: rgba(0,0,0,0.55);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px;
  pointer-events: none;
}
.preview-del {
  position: absolute;
  top: -2px; right: -2px;
  width: 22px; height: 22px;
  border: none;
  background: rgba(0,0,0,0.6);
  color: #fff;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Platform */
.ip-platform {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.ip-platform span {
  font-size: 14px;
  color: var(--text-secondary, #555);
}
.ip-platform select {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 8px;
  font-size: 15px;
  background: var(--surface, #f9fafb);
  color: var(--text-primary, #1a1a1a);
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23999' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}

/* Save button */
.ip-save {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
  background: var(--primary, #5E6AD2);
  color: #fff;
}
.ip-save:active:not(.disabled) { opacity: 0.85; }
.ip-save.disabled { background: #d4d4d4; color: #999; cursor: default; }
.ip-save.saving { background: #a5b4fc; }
.ip-save.ok { background: #22c55e; }
.ip-save.local { background: #f59e0b; }

/* Offline queue */
.ip-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.queue-title {
  font-size: 12px;
  color: var(--text-muted, #999);
  padding: 4px 0;
}
.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--surface, #f9fafb);
  border-radius: 8px;
  border: 1px solid var(--border, #e5e5e5);
}
.queue-text {
  font-size: 14px;
  color: var(--text-secondary, #555);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-del {
  width: 24px; height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted, #aaa);
  font-size: 18px;
  line-height: 1;
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.queue-del:hover { background: #fee2e2; color: #ef4444; }
.queue-del:disabled { opacity: 0.3; pointer-events: none; }
</style>
