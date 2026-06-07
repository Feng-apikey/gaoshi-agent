<script setup lang="ts">
import { Marked, Renderer } from 'marked'
import { ref, watch, onUnmounted } from 'vue'
import type { Message } from '../../types'

const props = defineProps<{
  message: Message
  isStreaming: boolean
}>()

const showLoading = ref(false)
let delayTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [props.isStreaming, props.message.content] as const,
  ([streaming, content]) => {
    if (delayTimer) { clearTimeout(delayTimer); delayTimer = null }
    if (streaming && !content) {
      delayTimer = setTimeout(() => { showLoading.value = true }, 300)
    } else {
      showLoading.value = false
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (delayTimer) clearTimeout(delayTimer)
})

function toolLabel(tc: { name: string }): string {
  const map: Record<string, string> = {
    analyze_image: '分析图片',
    analyze_video: '分析视频',
    generate_image: '生成图片',
    text_to_speech: '文字转语音',
    generate_music: '生成音乐',
    web_search: '搜索网页',
    web_fetch: '获取网页',
    file_read: '读取文件',
    file_write: '写入文件',
    file_edit: '编辑文件',
    file_move: '移动文件',
    file_delete: '删除文件',
    exec: '执行命令',
  }
  return map[tc.name] ?? tc.name
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const renderer = new Renderer()
renderer.image = function ({ href, text }: { href: string; text: string }) {
  let src: string
  if (/^https?:\/\//.test(href)) src = href
  else if (href.startsWith('/api/')) src = href
  else src = `/api/upload/${href}`
  return `<img src="${src}" alt="${escapeAttr(text || '')}" style="max-width:100%;border-radius:8px;margin:8px 0;">`
}
const md = new Marked({ gfm: true, breaks: true, renderer })

function renderContent(text: string): string {
  if (!text) return ''
  return md.parse(text) as string
}
</script>

<template>
  <div :class="['bubble', message.role]">
    <div class="avatar">
      <template v-if="message.role === 'user'">U</template>
      <template v-else>A</template>
    </div>
    <div class="body">
      <!-- Loading state: show after 300ms delay -->
      <div v-if="showLoading && isStreaming && !message.content" class="thinking">
        <template v-if="message.toolCalls?.length">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
          <span class="label">调用: {{ message.toolCalls.map(tc => toolLabel(tc)).join(', ') }}</span>
        </template>
        <template v-else>
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
          <span class="label">思考中</span>
        </template>
      </div>
      <!-- Tool tags always visible when present -->
      <div v-if="message.toolCalls?.length" class="tool-tags">
        <span v-for="tc in message.toolCalls" :key="tc.id" class="tool-tag">{{ toolLabel(tc) }}</span>
      </div>
      <!-- Content -->
      <div v-if="message.content" class="content" v-html="renderContent(message.content || '')" />
    </div>
  </div>
</template>

<style scoped>
.bubble {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.bubble.user { flex-direction: row-reverse; }

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.bubble.user .avatar {
  background: var(--primary);
  color: #fff;
}

.bubble.agent .avatar {
  background: var(--surface);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.body {
  max-width: 70%;
}

.bubble.user .body {
  background: var(--primary);
  color: #fff;
  border-radius: var(--radius-lg) 4px var(--radius-lg) var(--radius-lg);
  padding: 10px 14px;
}

.bubble.agent .body {
  background: var(--surface);
  color: var(--text-primary);
  border-radius: 4px var(--radius-lg) var(--radius-lg) var(--radius-lg);
  padding: 10px 14px;
  border: 1px solid var(--border);
}

.thinking {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: dotPulse 1.4s ease-in-out infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

.label {
  font-size: 13px;
  color: var(--text-muted);
  margin-left: 4px;
}

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.content {
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.content :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  margin: 8px 0;
  overflow-x: auto;
  font-size: 12px;
}

.content :deep(code) {
  font-size: 12px;
  background: rgba(0,0,0,0.06);
  padding: 1px 4px;
  border-radius: 3px;
}

.content :deep(pre code) {
  background: none;
  padding: 0;
}

.content :deep(strong) {
  font-weight: 600;
}

.content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.content :deep(th),
.content :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.content :deep(th) {
  background: var(--hover);
  font-weight: 600;
}

.content :deep(h2),
.content :deep(h3) {
  margin: 12px 0 6px;
  font-weight: 600;
}

.content :deep(h2) { font-size: 16px; }
.content :deep(h3) { font-size: 14px; }

.content :deep(ul),
.content :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}

.content :deep(li) {
  margin: 2px 0;
}

.content :deep(blockquote) {
  border-left: 3px solid var(--primary);
  padding-left: 10px;
  margin: 6px 0;
  color: var(--text-secondary);
}

.tool-tags {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.tool-tag {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(94, 106, 210, 0.1);
  color: var(--primary);
  font-size: 11px;
}
</style>
