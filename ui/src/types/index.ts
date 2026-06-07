// ── SSE events ──

export interface SSEDone {
  __done__: true
  threadId: string
  tokens: number
  truncated: boolean
}

export interface SSEAborted {
  __aborted__: true
  threadId: string
}

export interface SSEInterrupt {
  __interrupt__: true
  threadId: string
  node: string
  pendingToolCalls: ToolCall[]
}

export interface SSEError {
  __error__: true
  message: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** LangGraph stream chunk — { nodeName: { messages: [...] } } */
export type AgentChunk = Record<string, { messages?: Array<{ role: string; content: string; tool_calls?: ToolCall[] }> }>

export type SSEEvent = AgentChunk | SSEDone | SSEAborted | SSEInterrupt | SSEError

export function isDone(e: SSEEvent): e is SSEDone { return '__done__' in e }
export function isAborted(e: SSEEvent): e is SSEAborted { return '__aborted__' in e }
export function isInterrupt(e: SSEEvent): e is SSEInterrupt { return '__interrupt__' in e }
export function isError(e: SSEEvent): e is SSEError { return '__error__' in e }

// ── API types ──

export interface Thread {
  id: string
  title: string
  updatedAt: string
}

export interface Message {
  id: string
  role: 'user' | 'agent' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  timestamp: string
}

export interface Draft {
  id: string
  title: string
  content: string
  tags: string[]
  platform: '小红书' | 'B站' | '抖音'
  contentType: 'article' | 'image_text' | 'video'
  status: 'draft' | 'pushed' | 'push_failed'
  images: string[]
  video: string
  cover: string
  header: string
  abstract: string
  createdAt: string
  updatedAt: string
}

export interface Material {
  id: string
  name: string
  path: string
  category: 'image' | 'audio' | 'video' | 'document'
  mimeType: string
  size: number
  width?: number
  height?: number
  tags: string[]
  description: string
  generatedBy?: string
  useCount?: number
  createdAt: string
}

export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseURL: string
  enabled: number
  isCustom: number
  customModels: string[]
}

export interface ModelRoute {
  capability: 'text' | 'vision' | 'video' | 'image' | 'tts' | 'music'
  providerId: string
  model: string
  baseURL?: string
  apiKey?: string
}

export type ContentType = 'image_text' | 'video' | 'article' | 'dynamic'
export type Platform = '小红书' | 'B站' | '抖音'

export const PLATFORM_CONTENT_TYPES: Record<Platform, ContentType[]> = {
  '小红书': ['image_text', 'video', 'article'],
  'B站': ['video', 'dynamic', 'article'],
  '抖音': ['image_text', 'video', 'article'],
}
