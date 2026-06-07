<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message, SSEInterrupt } from '../../types'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{
  messages: Message[]
  streaming: boolean
  pendingInterrupt: SSEInterrupt | null
  threadId: string | null
}>()

const emit = defineEmits<{
  approve: [feedback?: string]
  reject: [feedback?: string]
}>()

const feedback = ref('')
const listRef = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight
    }
  })
}

// New message in current thread → auto-scroll
watch(() => props.messages.length, (len, oldLen) => {
  if (len > (oldLen ?? 0)) scrollToBottom()
})

// Streaming content grows → auto-scroll
watch(() => {
  const msgs = props.messages
  if (msgs.length === 0) return ''
  return msgs[msgs.length - 1].content
}, scrollToBottom)

// Thread switch → scroll to top
watch(() => props.threadId, () => {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = 0 })
})
</script>

<template>
  <div ref="listRef" class="message-list">
    <MessageBubble
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
      :isStreaming="streaming && msg.role === 'agent' && msg === messages[messages.length - 1]"
    />

    <!-- Tool interrupt -->
    <div v-if="pendingInterrupt" class="interrupt-bar">
      <div class="interrupt-header">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 4.5v4M8 11h.007" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>Agent 请求执行以下工具：</span>
      </div>
      <div v-for="tc in pendingInterrupt.pendingToolCalls" :key="tc.id" class="tool-call-item">
        <code>{{ tc.name }}</code>
        <pre>{{ JSON.stringify(tc.args, null, 2) }}</pre>
      </div>
      <textarea
        v-model="feedback"
        class="feedback-input"
        placeholder="补充说明（可选）"
        rows="2"
      />
      <div class="interrupt-actions">
        <button class="btn-approve" @click="emit('approve', feedback || undefined); feedback = ''">批准</button>
        <button class="btn-reject" @click="emit('reject', feedback || undefined); feedback = ''">拒绝</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.interrupt-bar {
  margin: 12px 0;
  padding: 14px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-lg);
  background: #F5F3FF;
}

.interrupt-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 8px;
}

.tool-call-item {
  margin-bottom: 8px;
}

.tool-call-item code {
  display: inline-block;
  padding: 2px 6px;
  background: var(--surface);
  border-radius: 4px;
  font-size: 12px;
  color: var(--primary);
  margin-bottom: 4px;
}

.tool-call-item pre {
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  overflow-x: auto;
  max-height: 100px;
}

.feedback-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  resize: none;
  margin-top: 8px;
  background: var(--bg);
}

.feedback-input:focus {
  outline: none;
  border-color: var(--primary);
}

.interrupt-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.btn-approve, .btn-reject {
  padding: 6px 18px;
  border-radius: var(--radius);
  font-size: 13px;
  border: none;
}

.btn-approve { background: var(--primary); color: #fff; }
.btn-approve:hover { background: var(--primary-hover); }
.btn-reject { background: var(--hover); color: var(--text-primary); }
.btn-reject:hover { background: var(--border); }
</style>
