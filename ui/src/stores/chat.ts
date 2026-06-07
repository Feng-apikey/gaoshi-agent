import { reactive } from 'vue'
import type { Thread, Message, SSEEvent, SSEInterrupt } from '../types'
import { isDone, isAborted, isInterrupt, isError } from '../types'
import { streamChat, abortChat, resumeChat, fetchThreads, deleteThread as deleteThreadApi, fetchStats, fetchThreadMessages } from '../api/chat'

interface QueueItem {
  id: string
  content: string
  threadId: string
}

interface ChatState {
  threads: Thread[]
  activeThreadId: string | null
  messages: Record<string, Message[]>
  streaming: boolean
  pendingInterrupt: SSEInterrupt | null
  abortController: AbortController | null
  totalTokens: number
  queue: QueueItem[]
}

const state = reactive<ChatState>({
  threads: [],
  activeThreadId: null,
  messages: {},
  streaming: false,
  pendingInterrupt: null,
  abortController: null,
  totalTokens: 0,
  queue: [],
})

let msgIdCounter = 0
function nextId(): string {
  return `msg_${Date.now()}_${++msgIdCounter}`
}

export function useChatStore() {
  async function loadThreads() {
    try {
      state.threads = await fetchThreads()
    } catch {
      // endpoint not yet available
      state.threads = []
    }
  }

  async function selectThread(threadId: string) {
    state.activeThreadId = threadId
    state.pendingInterrupt = null
    // queue stays, will process after thread switch
    if (!state.messages[threadId]) {
      state.messages[threadId] = []
      // Load history from checkpoint
      try {
        const history = await fetchThreadMessages(threadId)
        if (history.length > 0) {
          state.messages[threadId] = history
          // Use first user message as thread title
          const firstUser = history.find(m => m.role === 'user')
          if (firstUser) {
            const thread = state.threads.find(t => t.id === threadId)
            if (thread && thread.title !== firstUser.content.slice(0, 30)) {
              thread.title = firstUser.content.slice(0, 30)
            }
          }
        }
      } catch { /* history not available yet */ }
    }
  }

  function newThread() {
    const id = `thread_${Date.now()}`
    state.threads.unshift({ id, title: '新对话', updatedAt: new Date().toISOString() })
    state.activeThreadId = id
    state.messages[id] = []
    state.pendingInterrupt = null
    // queue stays, will process after thread switch
  }

  async function deleteThread(threadId: string) {
    try { await deleteThreadApi(threadId) } catch { /* endpoint may not exist yet */ }
    delete state.messages[threadId]
    state.threads = state.threads.filter(t => t.id !== threadId)
    if (state.pendingInterrupt?.threadId === threadId) {
      state.pendingInterrupt = null
    }
    if (state.activeThreadId === threadId) {
      const nextId = state.threads[0]?.id ?? null
      state.activeThreadId = nextId
      if (nextId) await selectThread(nextId)
    }
  }

  async function sendMessage(content: string) {
    const tid = state.activeThreadId ?? `thread_${Date.now()}`
    if (!state.activeThreadId) {
      state.activeThreadId = tid
      state.threads.unshift({ id: tid, title: content.slice(0, 30) || '新对话', updatedAt: new Date().toISOString() })
    }
    if (!state.messages[tid]) state.messages[tid] = []

    // Queue only — don't show user message or send request until it's this item's turn
    state.queue.push({ id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, content, threadId: tid })
    console.log('[queue] push, size:', state.queue.length, 'streaming:', state.streaming)
    pump()
  }

  async function pump() {
    if (state.streaming) { console.log('[pump] blocked, streaming'); return }
    const item = state.queue.shift()
    if (!item) { console.log('[pump] queue empty'); return }

    // Discard if target thread no longer exists or user switched away
    const tid = item.threadId
    if (!state.messages[tid]) { pump(); return }
    if (state.activeThreadId !== tid) { pump(); return }

    // Now it's this message's turn — show user message + create agent placeholder
    state.messages[tid].push({ id: nextId(), role: 'user', content: item.content, timestamp: new Date().toISOString() })

    let agentMsg: Message = { id: nextId(), role: 'agent', content: '', timestamp: new Date().toISOString() }
    state.messages[tid].push(agentMsg)
    state.streaming = true

    const ac = new AbortController()
    state.abortController = ac

    try {
      for await (const ev of streamChat({ threadId: tid, message: item.content, signal: ac.signal })) {
        if (ac.signal.aborted) break

        if (isDone(ev)) {
          state.totalTokens += ev.tokens ?? 0
          if (ev.truncated) agentMsg.content += '\n\n*[对话已截断]*'
          const thread = state.threads.find(t => t.id === tid)
          if (thread) {
            thread.updatedAt = new Date().toISOString()
            if (thread.title === '新对话') thread.title = item.content.slice(0, 30) || '新对话'
          }
        } else if (isInterrupt(ev)) {
          state.pendingInterrupt = ev
          agentMsg.toolCalls = ev.pendingToolCalls
        } else if (isAborted(ev)) {
          // content stays as-is
        } else if (isError(ev)) {
          agentMsg.content = `错误: ${ev.message}`
        } else {
          const chunk = ev as Record<string, { messages?: Array<{ role: string; content: string; tool_calls?: any[] }> }>
          for (const _nodeName of Object.keys(chunk)) {
            const nodeOutput = chunk[_nodeName]
            if (nodeOutput?.messages) {
              for (const m of nodeOutput.messages) {
                if (m.role === 'assistant' && typeof m.content === 'string') {
                  // New agent turn after tool execution → start fresh bubble
                  if (agentMsg.toolCalls?.length) {
                    agentMsg = { id: nextId(), role: 'agent', content: '', timestamp: new Date().toISOString() }
                    state.messages[tid].push(agentMsg)
                  }
                  agentMsg.content += m.content
                }
                if (m.tool_calls?.length) {
                  const existing = agentMsg.toolCalls ?? []
                  const existingIds = new Set(existing.map((tc: any) => tc.id))
                  for (const tc of m.tool_calls) {
                    if (!existingIds.has(tc.id)) {
                      existing.push(tc)
                      existingIds.add(tc.id)
                    }
                  }
                  agentMsg.toolCalls = existing
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (!ac.signal.aborted) {
        agentMsg.content = `网络错误: ${err?.message ?? '未知错误'}`
      }
    } finally {
      if (state.abortController === ac) {
        state.streaming = false
        state.abortController = null
      }
      pump() // process next queued item
    }
  }

  function abort() {
    state.queue = []
    state.abortController?.abort()
    if (state.activeThreadId) {
      abortChat(state.activeThreadId)
    }
  }

  async function resolveInterrupt(approved: boolean, feedback?: string) {
    if (!state.pendingInterrupt) return
    const tid = state.pendingInterrupt.threadId

    // User switched threads while interrupt was pending — discard
    if (state.activeThreadId !== tid) {
      state.pendingInterrupt = null
      return
    }

    state.pendingInterrupt = null

    if (!state.messages[tid]) return

    let agentMsg: Message = { id: nextId(), role: 'agent', content: '', timestamp: new Date().toISOString() }
    state.messages[tid].push(agentMsg)
    state.streaming = true

    const ac = new AbortController()
    state.abortController = ac

    try {
      for await (const ev of resumeChat(tid, approved, feedback, ac.signal)) {
        if (ac.signal.aborted) break

        if (isDone(ev)) {
          state.totalTokens += ev.tokens ?? 0
        } else if (isInterrupt(ev)) {
          state.pendingInterrupt = ev
          agentMsg.toolCalls = ev.pendingToolCalls
        } else if (isAborted(ev)) {
          // content stays as-is
        } else if (isError(ev)) {
          agentMsg.content = `错误: ${ev.message}`
        } else {
          const chunk = ev as Record<string, { messages?: Array<{ role: string; content: string; tool_calls?: any[] }> }>
          for (const _nodeName of Object.keys(chunk)) {
            const nodeOutput = chunk[_nodeName]
            if (nodeOutput?.messages) {
              for (const m of nodeOutput.messages) {
                if (m.role === 'assistant' && typeof m.content === 'string') {
                  // New agent turn after tool execution → start fresh bubble
                  if (agentMsg.toolCalls?.length) {
                    agentMsg = { id: nextId(), role: 'agent', content: '', timestamp: new Date().toISOString() }
                    state.messages[tid].push(agentMsg)
                  }
                  agentMsg.content += m.content
                }
                if (m.tool_calls?.length) {
                  const existing = agentMsg.toolCalls ?? []
                  const existingIds = new Set(existing.map((tc: any) => tc.id))
                  for (const tc of m.tool_calls) {
                    if (!existingIds.has(tc.id)) {
                      existing.push(tc)
                      existingIds.add(tc.id)
                    }
                  }
                  agentMsg.toolCalls = existing
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (!ac.signal.aborted) {
        agentMsg.content = `网络错误: ${err?.message ?? '未知错误'}`
      }
    } finally {
      if (state.abortController === ac) {
        state.streaming = false
        state.abortController = null
      }
      pump()
    }
  }

  function cancelQueueItem(qid: string) {
    state.queue = state.queue.filter(q => q.id !== qid)
  }

  return { state, loadThreads, selectThread, newThread, deleteThread, sendMessage, abort, resolveInterrupt, cancelQueueItem }
}
