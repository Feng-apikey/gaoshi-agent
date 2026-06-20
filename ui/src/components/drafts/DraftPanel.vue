<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Draft, ContentType, Platform } from '../../types'
import { useDraftsStore } from '../../stores/drafts'
import { getUploadUrl } from '../../api/upload'
import DraftItem from './DraftItem.vue'

const { state, load, create, save, remove } = useDraftsStore()

const PLATFORM_LABELS: Record<string, string> = { '小红书': '小红书', 'B站': 'B站', '抖音': '抖音' }
const TYPE_LABELS: Record<string, string> = { 'article': '长文', 'image_text': '图文', 'video': '视频', 'dynamic': '动态' }

// ── Limits ──
interface LimitEntry { title?: number; minBody?: number; body?: number; maxImages?: number; maxTags?: number; abstract?: number; aspectRatio?: string; header?: number; cover?: number }
const limits = ref<Record<string, Record<string, LimitEntry>>>({})

const availableTypes = computed(() => {
  const platformLimits = limits.value[editPlatform.value]
  const keys = platformLimits ? Object.keys(platformLimits) : null
  // Fallback before limits loaded: use sensible defaults per platform
  if (!keys || keys.length === 0) {
    if (editPlatform.value === 'B站') return ['video', 'dynamic', 'article']
    if (editPlatform.value === '抖音') return ['image_text', 'video', 'article']
    return ['image_text', 'video']
  }
  return keys
})

async function loadLimits() {
  try {
    const res = await fetch('/api/limits')
    limits.value = await res.json()
  } catch {}
}
loadLimits()

const currentLimit = computed(() => {
  return limits.value[editPlatform.value]?.[editType.value] ?? null
})

// All field visibility derived from schema + content type
const sections = computed(() => ({
  images:   currentLimit.value?.maxImages !== undefined,
  video:    editType.value === 'video',
  tags:     currentLimit.value?.maxTags !== undefined,
  abstract: currentLimit.value?.abstract !== undefined,
  header:   currentLimit.value?.header !== undefined,
  cover:    currentLimit.value?.cover !== undefined,
}))

const contentChars = computed(() => {
  return editContent.value.replace(/\s/g, '').length
})
const imageCount = computed(() => editImages.value.length)
const tagCount = computed(() => {
  return editTags.value.split(',').map(s => s.trim()).filter(Boolean).length
})

// ── Editor state ──
const editing = ref<Draft | null>(null)
const isNew = ref(false)
const editTitle = ref('')
const editContent = ref('')
const editPlatform = ref<Platform>('小红书')
const editType = ref<ContentType>('image_text')
const editTags = ref('')
const editAbstract = ref('')
const saving = ref(false)
const validationErrors = ref<Array<{ field: string; message: string }>>([])

// Clear validation errors when content/platform/type changes
watch([editContent, editPlatform, editType], () => {
  validationErrors.value = []
})

// ── Material state ──
const editImages = ref<string[]>([])
const editVideo = ref('')
const editCover = ref('')
const editHeader = ref('')
const uploading = ref(false)
// Material metadata cache: materialId → { name, width, height, mimeType }
const materialMeta = ref<Record<string, { name: string; width?: number; height?: number; mimeType?: string }>>({})

function materialName(id: string): string {
  return materialMeta.value[id]?.name ?? id.slice(0, 12) + '...'
}
function materialIcon(id: string): string {
  const m = materialMeta.value[id]?.mimeType
  if (!m) return '📎'
  if (m.startsWith('video')) return '🎬'
  if (m.startsWith('image')) return '🖼️'
  return '📎'
}

const imgInput = ref<HTMLInputElement>()
const coverInput = ref<HTMLInputElement>()
const headerInput = ref<HTMLInputElement>()
const videoInput = ref<HTMLInputElement>()
const contentTextarea = ref<HTMLTextAreaElement>()

// ── Orientation check ──
type Orientation = 'vertical' | 'horizontal'

function imgOrientation(id: string): Orientation | null {
  const m = materialMeta.value[id]
  if (!m || !m.width || !m.height) return null
  return m.width > m.height ? 'horizontal' : 'vertical'
}

const expectedOrientation = computed<Orientation | null>(() => {
  const r = currentLimit.value?.aspectRatio
  if (!r) return null
  const [w, h] = r.split(':').map(Number)
  if (!w || !h) return null
  return w > h ? 'horizontal' : 'vertical'
})

const misalignedImages = computed(() => {
  const expected = expectedOrientation.value
  if (!expected) return new Set<string>()
  const mis: Set<string> = new Set()
  for (const id of editImages.value) {
    const o = imgOrientation(id)
    if (o && o !== expected) mis.add(id)
  }
  return mis
})

async function preloadMaterialMeta(ids: string[]) {
  if (ids.length === 0) return
  const missing = ids.filter(id => !materialMeta.value[id])
  if (missing.length === 0) return
  try {
    const res = await fetch('/api/materials')
    const list = await res.json()
    for (const m of list) {
      materialMeta.value[m.id] = { name: m.name, width: m.width, height: m.height, mimeType: m.mimeType }
    }
  } catch {}
}

function openNew() {
  isNew.value = true
  editing.value = null
  editTitle.value = ''
  editContent.value = ''
  editPlatform.value = '小红书'
  editType.value = 'image_text'
  editTags.value = ''
  editAbstract.value = ''
  editImages.value = []
  editVideo.value = ''
  editCover.value = ''
  editHeader.value = ''
}

async function openEdit(draft: Draft) {
  isNew.value = false
  editing.value = draft
  editTitle.value = draft.title
  editContent.value = draft.content
  editPlatform.value = draft.platform
  editType.value = draft.contentType
  editTags.value = (draft.tags ?? []).join(', ')
  editAbstract.value = draft.abstract ?? ''
  editImages.value = draft.images ?? []
  editVideo.value = draft.video ?? ''
  editCover.value = draft.cover ?? ''
  editHeader.value = draft.header ?? ''
  preloadMaterialMeta([...editImages.value, editCover.value, editHeader.value].filter(Boolean))
}

function onPlatformChange() {
  if (!availableTypes.value.includes(editType.value)) {
    editType.value = (availableTypes.value[0] ?? 'image_text') as ContentType
  }
}

function closeEditor() {
  editing.value = null
  isNew.value = false
}

async function handleUpload(file: File): Promise<{ id: string; name?: string; width?: number; height?: number; mimeType?: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return { id: data.id, name: data.name ?? file.name, width: data.width, height: data.height, mimeType: data.mimeType }
}

async function uploadImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const r = await handleUpload(file)
    editImages.value = [...editImages.value, r.id]
    materialMeta.value[r.id] = { name: r.name ?? file.name, width: r.width, height: r.height, mimeType: r.mimeType }
  } catch (err: any) { alert('上传失败: ' + err.message) }
  finally { uploading.value = false; input.value = '' }
}

async function uploadVideo(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const r = await handleUpload(file)
    editVideo.value = r.id
    materialMeta.value[r.id] = { name: r.name ?? file.name, width: r.width, height: r.height, mimeType: r.mimeType }
  } catch (err: any) { alert('上传失败: ' + err.message) }
  finally { uploading.value = false; input.value = '' }
}

async function uploadCoverFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const r = await handleUpload(file)
    editCover.value = r.id
    materialMeta.value[r.id] = { name: r.name ?? file.name, width: r.width, height: r.height, mimeType: r.mimeType }
  } catch (err: any) { alert('上传失败: ' + err.message) }
  finally { uploading.value = false; input.value = '' }
}

async function uploadHeaderFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const r = await handleUpload(file)
    editHeader.value = r.id
    materialMeta.value[r.id] = { name: r.name ?? file.name, width: r.width, height: r.height, mimeType: r.mimeType }
  } catch (err: any) { alert('上传失败: ' + err.message) }
  finally { uploading.value = false; input.value = '' }
}

async function handlePaste(e: ClipboardEvent) {
  if (!sections.value.images) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) continue
    uploading.value = true
    try {
      const r = await handleUpload(file)
      materialMeta.value[r.id] = { name: r.name ?? file.name, width: r.width, height: r.height, mimeType: r.mimeType }
      const md = `![${file.name}](${getUploadUrl(r.id)})`
      const ta = contentTextarea.value
      if (ta) {
        const start = ta.selectionStart
        const end = ta.selectionEnd
        editContent.value = editContent.value.slice(0, start) + md + editContent.value.slice(end)
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + md.length
        })
      } else {
        editContent.value += md + '\n'
      }
    } catch (err: any) {
      alert('图片上传失败: ' + err.message)
    } finally {
      uploading.value = false
    }
  }
}

function removeImage(index: number) {
  editImages.value = editImages.value.filter((_, i) => i !== index)
}
function removeCover() {
  editCover.value = ''
}
function removeHeader() {
  editHeader.value = ''
}
function removeVideo() {
  editVideo.value = ''
}

async function handleSave() {
  validationErrors.value = []
  saving.value = true
  try {
    const tags = editTags.value.split(',').map(s => s.trim()).filter(Boolean)
    const payload = {
      title: editTitle.value || '无标题',
      content: editContent.value,
      platform: editPlatform.value,
      type: editType.value,
      tags,
      images: editImages.value,
      video: editVideo.value,
      cover: editCover.value,
      header: editHeader.value,
      abstract: editAbstract.value,
    }
    const result = isNew.value
      ? await create(payload)
      : (editing.value ? await save(editing.value.id, payload) : null)
    // Check if store returned a validation error object from 422
    if (result && (result as any).error) {
      validationErrors.value = (result as any).errors ?? [{ field: 'content', message: (result as any).error }]
      return
    }
    closeEditor()
  } catch {
    validationErrors.value = [{ field: '', message: '保存失败，请检查网络连接' }]
  } finally {
    saving.value = false
  }
}


</script>

<template>
  <div class="draft-panel">
    <div class="header">
      <h3>草稿</h3>
      <div class="header-actions">
        <button class="new-btn" @click="openNew">+ 新建</button>
        <button class="refresh-btn" @click="load" :disabled="state.loading">刷新</button>
      </div>
    </div>
    <div v-if="state.loading" class="loading">加载中...</div>
    <div v-else-if="state.drafts.length === 0" class="empty">暂无草稿，点击「+ 新建」创建</div>
    <div v-else class="list">
      <DraftItem
        v-for="d in state.drafts"
        :key="d.id"
        :draft="d"
        :platformLabel="PLATFORM_LABELS[d.platform] ?? d.platform"
        :typeLabel="TYPE_LABELS[d.contentType] ?? d.contentType"
        @edit="openEdit(d)"
        @delete="remove(d.id)"
      />
    </div>

    <!-- Editor modal -->
    <Teleport to="body">
      <div v-if="isNew || editing" class="editor-overlay" @click.self="closeEditor">
        <div class="editor">
          <div class="editor-header">
            <h4>{{ isNew ? '新建草稿' : '编辑草稿' }}</h4>
            <button class="close-btn" @click="closeEditor">
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>

          <div class="field-row">
            <label class="field" style="flex:1">
              <span>平台</span>
              <select v-model="editPlatform" @change="onPlatformChange">
                <option value="小红书">小红书</option>
                <option value="B站">B站</option>
                <option value="抖音">抖音</option>
              </select>
            </label>
            <label class="field" style="flex:1">
              <span>类型</span>
              <select v-model="editType">
                <option v-for="t in availableTypes" :key="t" :value="t">{{ TYPE_LABELS[t] ?? t }}</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span>
              标题
              <template v-if="currentLimit?.title">（≤{{ currentLimit.title }}字）</template>
            </span>
            <div style="display:flex;align-items:center;gap:6px">
              <input v-model="editTitle" placeholder="草稿标题" style="flex:1" />
              <span v-if="currentLimit?.title" class="mini-counter" :class="{ over: editTitle.length > currentLimit.title }">{{ editTitle.length }}/{{ currentLimit.title }}</span>
            </div>
          </label>

          <!-- 摘要 -->
          <label v-if="sections.abstract" class="field">
            <span>文章摘要</span>
            <input v-model="editAbstract" placeholder="一句话概括文章内容（可选）" />
          </label>

          <!-- 素材区域 -->
          <div class="materials-section">
            <!-- 图片上传 -->
            <div v-if="sections.images" class="material-group">
              <span class="material-label">
                图片素材
                <template v-if="currentLimit?.maxImages !== undefined">
                  （{{ imageCount }}/{{ currentLimit.maxImages }}）
                  <span v-if="imageCount > currentLimit.maxImages" class="hint over">超出限制</span>
                </template>
                <template v-if="expectedOrientation">
                  · 推荐{{ expectedOrientation === 'vertical' ? '竖版' : '横版' }}
                </template>
              </span>
              <div class="material-items">
                <a v-for="(id, idx) in editImages" :key="id" class="material-chip" :class="{ 'ratio-warn': misalignedImages.has(id) }"
                   :href="'/api/upload/' + id" target="_blank" :title="materialName(id)">
                  {{ materialIcon(id) }} {{ materialName(id) }}
                  <span v-if="misalignedImages.has(id)" class="ratio-hint">方向不适配</span>
                  <button class="chip-remove" @click.prevent="removeImage(idx)" title="移除">&times;</button>
                </a>
              </div>
              <button class="upload-btn" :disabled="uploading" @click="imgInput?.click()">
                {{ uploading ? '上传中...' : '+ 上传图片' }}
              </button>
              <input ref="imgInput" type="file" accept="image/*" hidden @change="uploadImage" />
            </div>

            <!-- 封面上传 -->
            <div v-if="sections.cover" class="material-group">
              <span class="material-label">
                {{ editType === 'image_text' ? '封面（默认第一张图片）' : '封面' }}
              </span>
              <div v-if="editCover" class="material-items">
                <a class="material-chip" :href="'/api/upload/' + editCover" target="_blank" :title="materialName(editCover)">
                  {{ materialIcon(editCover) }} {{ materialName(editCover) }}
                  <button class="chip-remove" @click.prevent="removeCover()" title="移除">&times;</button>
                </a>
              </div>
              <button class="upload-btn small" :disabled="uploading" @click="coverInput?.click()">
                上传封面
              </button>
              <input ref="coverInput" type="file" accept="image/*" hidden @change="uploadCoverFile" />
            </div>

            <!-- 头图上传（长文） -->
            <div v-if="sections.header" class="material-group">
              <span class="material-label">文章头图（推荐流展示，需高清）</span>
              <div v-if="editHeader" class="material-items">
                <a class="material-chip" :href="'/api/upload/' + editHeader" target="_blank" :title="materialName(editHeader)">
                  {{ materialIcon(editHeader) }} {{ materialName(editHeader) }}
                  <button class="chip-remove" @click.prevent="removeHeader()" title="移除">&times;</button>
                </a>
              </div>
              <button class="upload-btn small" :disabled="uploading" @click="headerInput?.click()">
                上传头图
              </button>
              <input ref="headerInput" type="file" accept="image/*" hidden @change="uploadHeaderFile" />
            </div>

            <!-- 视频上传（视频类型） -->
            <div v-if="sections.video" class="material-group">
              <span class="material-label">视频文件</span>
              <div v-if="editVideo" class="material-items">
                <a class="material-chip" :href="'/api/upload/' + editVideo" target="_blank" :title="materialName(editVideo)">
                  {{ materialIcon(editVideo) }} {{ materialName(editVideo) }}
                  <button class="chip-remove" @click.prevent="removeVideo()" title="移除">&times;</button>
                </a>
              </div>
              <button class="upload-btn" :disabled="uploading" @click="videoInput?.click()">
                {{ uploading ? '上传中...' : '+ 上传视频' }}
              </button>
              <input ref="videoInput" type="file" accept="video/*" hidden @change="uploadVideo" />
            </div>
          </div>

          <label class="field">
            <span>正文</span>
            <textarea ref="contentTextarea" v-model="editContent" rows="10" :placeholder="sections.images ? '输入正文内容...（可直接粘贴图片）' : '输入正文内容...'" @paste="handlePaste" />
          </label>
          <div v-if="currentLimit" class="char-counter">
            <span :class="currentLimit.body && contentChars > currentLimit.body ? 'over' : currentLimit.minBody && contentChars < currentLimit.minBody ? 'under' : ''">
              {{ contentChars }}
            </span>
            <template v-if="currentLimit.body">
              / {{ currentLimit.body }} 字
              <span v-if="currentLimit.minBody && contentChars < currentLimit.minBody" class="hint">（最少 {{ currentLimit.minBody }} 字）</span>
            </template>
            <template v-else>
              字
            </template>
            <span v-if="currentLimit.body && contentChars > currentLimit.body" class="hint over"> 超出限制</span>
          </div>

          <label v-if="sections.tags" class="field">
            <span>
              标签（逗号分隔）
              <template v-if="currentLimit?.maxTags">（≤{{ currentLimit.maxTags }}个）</template>
            </span>
            <div style="display:flex;align-items:center;gap:6px">
              <input v-model="editTags" placeholder="风景, 美食, 旅行" style="flex:1" />
              <span v-if="currentLimit?.maxTags" class="mini-counter" :class="{ over: tagCount > currentLimit.maxTags }">
                {{ tagCount }}/{{ currentLimit.maxTags }}
              </span>
            </div>
          </label>

          <div v-if="validationErrors.length > 0" class="validation-errors">
            <div v-for="(e, i) in validationErrors" :key="i" class="val-error">{{ e.message }}</div>
          </div>

          <div class="editor-actions">
            <button class="btn-cancel" @click="closeEditor">取消</button>
            <button class="btn-save" @click="handleSave" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.draft-panel { display: flex; flex-direction: column; gap: 12px; }

.header { display: flex; align-items: center; justify-content: space-between; }
.header h3 { font-size: 15px; font-weight: 600; }

.header-actions { display: flex; gap: 6px; }

.new-btn {
  padding: 4px 10px;
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  font-size: 12px;
}

.new-btn:hover { background: var(--primary-hover); }

.refresh-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: 12px;
  color: var(--text-secondary);
}

.refresh-btn:hover { border-color: var(--primary); color: var(--primary); }

.loading, .empty { text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px 0; }

.list { display: flex; flex-direction: column; gap: 6px; }

/* Editor modal */
.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.editor {
  background: var(--bg);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 600px;
  max-width: 95vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.editor-header h4 { font-size: 15px; }

.close-btn {
  width: 28px; height: 28px;
  border: none; background: transparent;
  border-radius: 4px; color: var(--text-muted);
  display: flex; align-items: center; justify-content: center;
}
.close-btn:hover { background: var(--hover); }

.field { display: flex; flex-direction: column; gap: 4px; }
.field span { font-size: 12px; color: var(--text-secondary); }
.field input, .field select, .field textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
.field input:focus, .field select:focus, .field textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.field textarea {
  resize: vertical;
  line-height: 1.6;
  min-height: 150px;
}

.field-row { display: flex; gap: 10px; }

.materials-section { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }

.material-group { display: flex; flex-direction: column; gap: 4px; }

.material-label { font-size: 12px; color: var(--text-secondary); }

.material-items { display: flex; gap: 4px; flex-wrap: wrap; }

.material-chip {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--hover);
  border-radius: 3px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 2px;
  text-decoration: none;
}
.material-chip:hover { background: var(--border); }

.chip-remove {
  width: 16px; height: 16px;
  border: none; background: transparent;
  color: var(--text-muted);
  font-size: 14px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px;
  cursor: pointer;
}
.chip-remove:hover {
  background: var(--error);
  color: #fff;
}

.upload-btn {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  align-self: flex-start;
}
.upload-btn.small { font-size: 11px; padding: 2px 6px; }
.upload-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.upload-btn:disabled { opacity: 0.5; }

.editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

.btn-cancel, .btn-save {
  padding: 7px 18px; border-radius: var(--radius); font-size: 13px; border: none;
}
.btn-cancel { background: var(--hover); color: var(--text-primary); }
.btn-save { background: var(--primary); color: #fff; }
.btn-save:hover:not(:disabled) { background: var(--primary-hover); }
.btn-save:disabled { opacity: 0.5; }

.char-counter {
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
  margin-top: -8px;
}
.char-counter .over { color: var(--error); font-weight: 600; }
.char-counter .under { color: #D97706; }
.char-counter .hint { font-weight: 400; font-size: 11px; }
.char-counter .hint.over { font-weight: 500; }

.mini-counter {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 48px;
  text-align: right;
}
.mini-counter.over { color: var(--error); font-weight: 600; }
.material-label .hint.over { color: var(--error); font-weight: 500; font-size: 11px; }

.material-chip.ratio-warn {
  background: #FEF3C7;
  border: 1px solid #F59E0B;
  color: #92400E;
}
.ratio-hint {
  font-size: 10px;
  color: #D97706;
  margin-left: 4px;
}

.validation-errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: #FEE2E2;
  border-radius: var(--radius);
}
.val-error {
  font-size: 12px;
  color: #991B1B;
}
</style>
