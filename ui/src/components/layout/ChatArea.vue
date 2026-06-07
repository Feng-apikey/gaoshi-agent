<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useChatStore } from '../../stores/chat'
import ThreadBar from '../chat/ThreadBar.vue'
import MessageList from '../chat/MessageList.vue'
import QueueBar from '../chat/QueueBar.vue'
import ChatInput from '../chat/ChatInput.vue'
import EmptyState from '../chat/EmptyState.vue'

const { state, loadThreads, selectThread, newThread, deleteThread, sendMessage, abort, resolveInterrupt } = useChatStore()
const msgs = computed(() => state.activeThreadId ? (state.messages[state.activeThreadId] ?? []) : [])

onMounted(async () => {
  await loadThreads()
  // Restore last active thread
  if (state.threads.length > 0 && !state.activeThreadId) {
    await selectThread(state.threads[0].id)
  }
})
</script>

<template>
  <main class="chat-area">
    <ThreadBar
      :threads="state.threads"
      :activeThreadId="state.activeThreadId"
      @select="selectThread"
      @new="newThread"
      @delete="deleteThread"
    />
    <EmptyState
      v-if="!state.activeThreadId || msgs.length === 0"
      @sendHint="(hint: string) => sendMessage(hint)"
    />
    <MessageList
      v-else
      :messages="msgs"
      :thread-id="state.activeThreadId"
      :streaming="state.streaming"
      :pendingInterrupt="state.pendingInterrupt"
      @approve="(feedback?: string) => resolveInterrupt(true, feedback)"
      @reject="(feedback?: string) => resolveInterrupt(false, feedback)"
    />
    <QueueBar />
    <ChatInput
      :streaming="state.streaming"
      @send="sendMessage"
      @abort="abort"
    />
  </main>
</template>

<style scoped>
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-width: 0;
}
</style>
