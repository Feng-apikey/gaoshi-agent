import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildAgent, runAgent, resumeAgent, getThreadStats } from "../../agent/core.ts";
import { getModel } from "../../agent/providers/router.ts";
import type { ToolDef } from "../../agent/tools/types.ts";
import { buildSystemPrompt } from "../../agent/system-prompt.ts";
import { getAgentTools } from "../../agent/tools/index.ts";
import { createHash } from "node:crypto";
import { getDB } from "../../storage/db.ts";
import { threads as threadsTable } from "../../storage/schema.ts";
import { eq, desc } from "drizzle-orm";

// ── Tool auto-approve ──

import { getAutoApprove } from "./settings.ts";

const DANGEROUS_TOOLS = new Set([
  "file_write", "file_move", "file_delete",
]);

function isDangerous(name: string): boolean {
  if (DANGEROUS_TOOLS.has(name)) return true;
  if (name.startsWith("exec")) return true;
  return false;
}

function allWhitelisted(pendingToolCalls: Array<{ name: string }>): boolean {
  if (getAutoApprove()) return true;
  return pendingToolCalls.length > 0 && !pendingToolCalls.some(tc => isDangerous(tc.name));
}

export const chatRouter = new Hono();

// ── System prompt: always build fresh to pick up latest memories ──

function getDefaultSystemPrompt(): string {
  return buildSystemPrompt();
}

// ── Agent cache (LRU, max 10) ──

const agentCache = new Map<string, any>();
const agentCacheKeys: string[] = [];
const MAX_AGENT_CACHE = 10;

function getAgent(tools: ToolDef[], systemPrompt: string) {
  const toolsFingerprint = tools.map(t => t.name).sort().join(",");
  const model = getModel("text");
  const modelId = (model as any)?.modelId ?? "unknown";
  const key = createHash("sha256").update(systemPrompt + "|" + toolsFingerprint + "|" + modelId).digest("hex").slice(0, 16);
  if (!agentCache.has(key)) {
    agentCache.set(key, buildAgent({ model, systemPrompt, tools, interruptOn: "tools" }));
    agentCacheKeys.push(key);
    if (agentCacheKeys.length > MAX_AGENT_CACHE) {
      const oldest = agentCacheKeys.shift()!;
      agentCache.delete(oldest);
    }
  } else {
    const idx = agentCacheKeys.indexOf(key);
    if (idx !== -1) {
      agentCacheKeys.splice(idx, 1);
      agentCacheKeys.push(key);
    }
  }
  return agentCache.get(key)!;
}

// ── Per-thread state ──

interface ThreadState {
  queue: { id: string; text: string }[];
  running: boolean;
  abort: AbortController | null;
}

const threads = new Map<string, ThreadState>();

function getThread(threadId: string): ThreadState {
  if (!threads.has(threadId)) {
    threads.set(threadId, { queue: [], running: false, abort: null });
  }
  return threads.get(threadId)!;
}

// ── POST /api/chat — enqueue message, stream when ready ──

chatRouter.post("/", async (c) => {
  const body = await c.req.json<{ threadId?: string; message: string; tools?: ToolDef[]; systemPrompt?: string }>();
  const threadId = body.threadId ?? `thread_${Date.now()}`;
  const tools = [...getAgentTools(), ...(body.tools ?? [])];
  const sp = body.systemPrompt ?? getDefaultSystemPrompt();
  const t = getThread(threadId);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Persist thread record on first message
  const now = new Date().toISOString();
  const db = getDB();
  const existing = db.select().from(threadsTable).where(eq(threadsTable.id, threadId)).get();
  if (!existing) {
    db.insert(threadsTable).values({
      id: threadId,
      title: (body.message ?? "").slice(0, 30) || "新对话",
      createdAt: now,
      updatedAt: now,
    }).run();
  } else {
    db.update(threadsTable).set({ updatedAt: now }).where(eq(threadsTable.id, threadId)).run();
  }

  t.queue.push({ id: msgId, text: body.message });

  return streamSSE(c, async (stream) => {
    // Wait for turn
    while (t.running || t.queue[0]?.id !== msgId) {
      await new Promise(r => setTimeout(r, 200));
    }
    t.queue.shift();
    t.running = true;
    t.abort = new AbortController();

    try {
      const agent = getAgent(tools, sp);

      for await (const chunk of runAgent(agent, threadId, body.message)) {
        if (t.abort.signal.aborted) {
          await stream.writeSSE({ data: JSON.stringify({ __aborted__: true, threadId }) });
          break;
        }
        // Strip __interrupt__ wrapper but keep the messages (tool_calls, etc.)
        if ("__interrupt__" in chunk) {
          const { __interrupt__, ...rest } = chunk as any;
          if (Object.keys(rest).length > 0) {
            await stream.writeSSE({ data: JSON.stringify(rest) });
          }
          continue;
        }
        await stream.writeSSE({ data: JSON.stringify(chunk) });
      }

      if (!t.abort.signal.aborted) {
        // Auto-resume loop for whitelisted tools
        let autoSteps = 0;
        const MAX_AUTO_STEPS = 20;
        while (autoSteps < MAX_AUTO_STEPS) {
          if (t.abort.signal.aborted) break;
          autoSteps++;

          const state = await (agent as any).getState?.({ configurable: { thread_id: threadId } });
          if (!state?.next?.length || !state.next.includes("tools")) {
            const stats = await getThreadStats(agent, threadId);
            await stream.writeSSE({ data: JSON.stringify({
              __done__: true, threadId,
              tokens: stats?.tokenCount ?? 0,
              truncated: stats?.truncated ?? false,
            }) });
            break;
          }

          const lastMsg = state.values?.messages?.[state.values.messages.length - 1];
          const rawCalls = lastMsg?.tool_calls ?? [];
          const pendingToolCalls = rawCalls.map((tc: any) => {
            let args: Record<string, unknown> = {};
            if (typeof tc.function?.arguments === "string") {
              try { args = JSON.parse(tc.function.arguments); } catch {}
            } else {
              args = tc.args ?? {};
            }
            return { id: tc.id, name: tc.function?.name ?? tc.name ?? "unknown", args };
          });

          if (!pendingToolCalls.length) {
            const stats = await getThreadStats(agent, threadId);
            await stream.writeSSE({ data: JSON.stringify({
              __done__: true, threadId,
              tokens: stats?.tokenCount ?? 0,
              truncated: stats?.truncated ?? false,
            }) });
            break;
          }

          if (allWhitelisted(pendingToolCalls)) {
            for await (const chunk of resumeAgent(agent, threadId, true)) {
              if (t.abort.signal.aborted) break;
              if ("__interrupt__" in chunk) {
                const { __interrupt__, ...rest } = chunk as any;
                if (Object.keys(rest).length > 0) {
                  await stream.writeSSE({ data: JSON.stringify(rest) });
                }
                continue;
              }
              await stream.writeSSE({ data: JSON.stringify(chunk) });
            }
          } else {
            await stream.writeSSE({ data: JSON.stringify({
              __interrupt__: true, threadId, node: "tools",
              pendingToolCalls,
            }) });
            break;
          }
        }
      }
    } catch (err: any) {
      await stream.writeSSE({ data: JSON.stringify({ __error__: true, message: err.message }) });
    } finally {
      t.running = false;
      t.abort = null;
      try { db.update(threadsTable).set({ updatedAt: new Date().toISOString() }).where(eq(threadsTable.id, threadId)).run(); } catch {}
    }
  });
});

// ── POST /api/chat/abort — manual interrupt ──

chatRouter.post("/abort", async (c) => {
  const body = await c.req.json<{ threadId: string }>();
  const t = threads.get(body.threadId);
  if (t?.abort) {
    t.abort.abort();
    return c.json({ aborted: true, threadId: body.threadId });
  }
  return c.json({ aborted: false, reason: "no running task" });
});

// ── POST /api/chat/resume ──

chatRouter.post("/resume", async (c) => {
  const body = await c.req.json<{ threadId: string; approved: boolean; feedback?: string; tools?: ToolDef[]; systemPrompt?: string }>();
  const tools = [...getAgentTools(), ...(body.tools ?? [])];
  const sp = body.systemPrompt ?? getDefaultSystemPrompt();
  const agent = getAgent(tools, sp);
  const t = getThread(body.threadId);

  return streamSSE(c, async (stream) => {
    t.running = true;
    t.abort = new AbortController();

    try {
      for await (const chunk of resumeAgent(agent, body.threadId, body.approved, body.feedback)) {
        if (t.abort.signal.aborted) {
          await stream.writeSSE({ data: JSON.stringify({ __aborted__: true, threadId: body.threadId }) });
          break;
        }
        if ("__interrupt__" in chunk) {
          const { __interrupt__, ...rest } = chunk as any;
          if (Object.keys(rest).length > 0) {
            await stream.writeSSE({ data: JSON.stringify(rest) });
          }
          continue;
        }
        await stream.writeSSE({ data: JSON.stringify(chunk) });
      }

      if (!t.abort.signal.aborted) {
        // Auto-resume loop for whitelisted tools
        let autoSteps = 0;
        const MAX_AUTO_STEPS = 20;
        while (autoSteps < MAX_AUTO_STEPS) {
          if (t.abort.signal.aborted) break;
          autoSteps++;

          const state = await (agent as any).getState?.({ configurable: { thread_id: body.threadId } });
          if (!state?.next?.length || !state.next.includes("tools")) {
            const stats = await getThreadStats(agent, body.threadId);
            await stream.writeSSE({ data: JSON.stringify({
              __done__: true, threadId: body.threadId,
              tokens: stats?.tokenCount ?? 0,
              truncated: stats?.truncated ?? false,
            }) });
            break;
          }

          const lastMsg = state.values?.messages?.[state.values.messages.length - 1];
          const rawCalls = lastMsg?.tool_calls ?? [];
          const pendingToolCalls = rawCalls.map((tc: any) => {
            let args: Record<string, unknown> = {};
            if (typeof tc.function?.arguments === "string") {
              try { args = JSON.parse(tc.function.arguments); } catch {}
            } else {
              args = tc.args ?? {};
            }
            return { id: tc.id, name: tc.function?.name ?? tc.name ?? "unknown", args };
          });

          if (!pendingToolCalls.length) {
            const stats = await getThreadStats(agent, body.threadId);
            await stream.writeSSE({ data: JSON.stringify({
              __done__: true, threadId: body.threadId,
              tokens: stats?.tokenCount ?? 0,
              truncated: stats?.truncated ?? false,
            }) });
            break;
          }

          if (allWhitelisted(pendingToolCalls)) {
            for await (const chunk of resumeAgent(agent, body.threadId, true)) {
              if (t.abort.signal.aborted) break;
              if ("__interrupt__" in chunk) {
                const { __interrupt__, ...rest } = chunk as any;
                if (Object.keys(rest).length > 0) {
                  await stream.writeSSE({ data: JSON.stringify(rest) });
                }
                continue;
              }
              await stream.writeSSE({ data: JSON.stringify(chunk) });
            }
          } else {
            await stream.writeSSE({ data: JSON.stringify({
              __interrupt__: true, threadId: body.threadId, node: "tools",
              pendingToolCalls,
            }) });
            break;
          }
        }
      }
    } catch (err: any) {
      await stream.writeSSE({ data: JSON.stringify({ __error__: true, message: err.message }) });
    } finally {
      t.running = false;
      t.abort = null;
      try { getDB().update(threadsTable).set({ updatedAt: new Date().toISOString() }).where(eq(threadsTable.id, body.threadId)).run(); } catch {}
    }
  });
});

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("");
  }
  return "";
}

// ── GET /api/chat/threads/:threadId/messages ──

chatRouter.get("/threads/:threadId/messages", async (c) => {
  const threadId = c.req.param("threadId");
  let agent = agentCache.values().next().value;
  if (!agent) {
    // Create a throwaway agent to read checkpoint state
    const model = getModel("text");
    agent = buildAgent({ model, systemPrompt: "", tools: [], interruptOn: "tools" });
  }

  try {
    const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
    if (!state?.values?.messages?.length) return c.json([]);

    const msgs = state.values.messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any, idx: number) => ({
        id: `hist_${threadId}_${idx}`,
        role: m.role === "assistant" ? "agent" : m.role,
        content: extractTextContent(m.content),
        toolCalls: m.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name ?? tc.name ?? "unknown",
          args: typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : (tc.args ?? {}),
        })),
        timestamp: state.values.messages[idx]?.timestamp ?? new Date().toISOString(),
      }));

    return c.json(msgs);
  } catch {
    return c.json([]);
  }
});

// ── GET /api/chat/stats/:threadId ──

chatRouter.get("/stats/:threadId", async (c) => {
  const threadId = c.req.param("threadId");
  const agent = agentCache.values().next().value as ReturnType<typeof buildAgent> | undefined;
  if (!agent) return c.json({ error: "agent not initialized" }, 503);
  const stats = await getThreadStats(agent, threadId);
  return c.json(stats ?? { tokenCount: 0, truncated: false });
});

// ── GET /api/chat/threads ──

chatRouter.get("/threads", (c) => {
  const db = getDB();
  const rows = db.select().from(threadsTable).orderBy(desc(threadsTable.updatedAt)).all();
  return c.json(rows.map(r => ({ id: r.id, title: r.title, updatedAt: r.updatedAt })));
});

// ── DELETE /api/chat/threads/:id ──

chatRouter.delete("/threads/:id", async (c) => {
  const threadId = c.req.param("id");

  if (threads.has(threadId)) {
    const t = threads.get(threadId)!;
    t.abort?.abort();
    threads.delete(threadId);
  }

  try {
    const { getCheckpointer } = await import("../../agent/checkpoint.ts");
    const cp = getCheckpointer() as any;
    if (typeof cp?.deleteThread === "function") {
      await cp.deleteThread(threadId);
    }
  } catch {}

  try { getDB().delete(threadsTable).where(eq(threadsTable.id, threadId)).run(); } catch {}

  return c.json({ deleted: true, id: threadId });
});
