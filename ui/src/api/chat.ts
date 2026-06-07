import type { SSEEvent } from '../types'

export async function* streamChat(body: { threadId?: string; message: string; signal?: AbortSignal }): AsyncGenerator<SSEEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: body.signal,
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  try {
    yield* readSSE(reader)
  } finally {
    reader.cancel()
  }
}

export async function abortChat(threadId: string): Promise<void> {
  await fetch('/api/chat/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId }),
  })
}

export function resumeChat(threadId: string, approved: boolean, feedback?: string, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  return _stream('/api/chat/resume', { threadId, approved, feedback }, signal)
}

async function* _stream(url: string, body: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  try {
    yield* readSSE(reader)
  } finally {
    reader.cancel()
  }
}

async function* readSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop()!
    for (const part of parts) {
      const line = part.trim()
      if (line.startsWith('data: ')) {
        yield JSON.parse(line.slice(6))
      }
    }
  }
  buffer += decoder.decode()
  const remaining = buffer.trim()
  if (remaining.startsWith('data: ')) {
    try { yield JSON.parse(remaining.slice(6)) } catch {}
  }
}

export async function fetchThreads(): Promise<{ id: string; title: string; updatedAt: string }[]> {
  const res = await fetch('/api/chat/threads')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteThread(id: string): Promise<void> {
  const res = await fetch(`/api/chat/threads/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchStats(threadId: string): Promise<{ tokenCount: number; truncated: boolean }> {
  const res = await fetch(`/api/chat/stats/${threadId}`)
  return res.json()
}

export async function fetchThreadMessages(threadId: string): Promise<Array<{
  id: string; role: 'user' | 'agent'; content: string; toolCalls?: any[]; timestamp: string
}>> {
  const res = await fetch(`/api/chat/threads/${threadId}/messages`)
  return res.json()
}
