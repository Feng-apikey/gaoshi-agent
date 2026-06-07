﻿﻿import { StateGraph, Annotation, Command } from "@langchain/langgraph";
import type { LanguageModel } from "ai";
import { generateText, tool, jsonSchema } from "ai";
import type { ToolDef } from "./tools/types.ts";
import { getCheckpointer } from "./checkpoint.ts";
import { loadPresets } from "./providers/presets.ts";

// ── Token estimation ──

export function estimateTokens(text: string): number {
  let chars = 0; let words = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) { chars++; }
    else if (/[a-zA-Z0-9]/.test(ch)) { words++; }
    else { chars++; }
  }
  return Math.ceil(chars * 0.6 + words * 0.3);
}

export function estimateMessageTokens(msg: any): number {
  let total = 0;
  if (typeof msg.content === "string") total += estimateTokens(msg.content);
  else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.text) total += estimateTokens(part.text);
      if (part.result) total += estimateTokens(typeof part.result === "string" ? part.result : JSON.stringify(part.result));
      if (part.toolName) total += estimateTokens(part.toolName);
      if (part.args) total += estimateTokens(JSON.stringify(part.args));
    }
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(JSON.stringify(tc.function ?? tc));
    }
  }
  if (msg.tool_call_id) total += estimateTokens(msg.content ?? "");
  return total;
}

// ── State ──

const AgentState = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (a, b) => {
      // __replace__ marker: discard old messages, use new truncated list
      if (b.length > 0 && (b[0] as any)?.__replace__) return b.slice(1);
      return [...a, ...b];
    },
    default: () => [],
  }),
  threadId: Annotation<string>({ default: () => "" }),
  tokenCount: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  truncated: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  done: Annotation<boolean>({ default: () => false }),
  toolStep: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
});

type State = typeof AgentState.State;

function summarizeDropped(dropped: any[]): string {
  if (!dropped.length) return "";

  const userMsgs: string[] = [];
  const toolResults: string[] = [];
  const decisions: string[] = [];

  for (const m of dropped) {
    if (m.role === "user" && typeof m.content === "string" && m.content.trim()) {
      userMsgs.push(m.content.trim().slice(0, 200).replace(/\n/g, " "));
    }
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
      const c = m.content.trim().slice(0, 300).replace(/\n/g, " ");
      if (c.length > 20) decisions.push(c);
    }
    if (m.role === "tool" && typeof m.content === "string") {
      try {
        const parsed = JSON.parse(m.content);
        const brief = typeof parsed === "string" ? parsed : (parsed.message ?? parsed.title ?? parsed.success ?? "");
        if (brief) toolResults.push(String(brief).slice(0, 150));
      } catch {
        toolResults.push(m.content.slice(0, 150).replace(/\n/g, " "));
      }
    }
  }

  const lines: string[] = ["[以下为历史对话摘要]"];
  if (userMsgs.length) lines.push(`用户请求: ${userMsgs.join("；")}`);
  if (toolResults.length) lines.push(`工具结果: ${toolResults.join("；")}`);
  if (decisions.length) lines.push(`助手回复要点: ${decisions.join("；")}`);

  return lines.join("\n");
}

// ── Truncation ──

export function truncateMessages(messages: any[], systemTokens: number, maxTokens: number): any[] {
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const m of nonSystem) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) toolCallIds.add(tc.id);
    }
    if (m.role === "tool") toolResultIds.add(m.tool_call_id);
  }

  let used = systemTokens + 200; // reserve for truncation summary
  const kept: any[] = [];
  const dropped: any[] = [];

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msg = nonSystem[i];
    const t = estimateMessageTokens(msg);

    // Drop orphan tool results (no matching tool_call)
    if (msg.role === "tool" && !toolCallIds.has(msg.tool_call_id)) { dropped.push(msg); continue; }
    // Drop assistant with unresolved tool_calls (missing results)
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const tcIds: string[] = msg.tool_calls.map((tc: any) => tc.id);
      if (!tcIds.every((id: string) => toolResultIds.has(id))) { dropped.push(msg); continue; }
    }

    // Budget check
    if (used + t > maxTokens * 0.85) {
      dropped.push(msg);
      // If dropping a tool result, remove its ID so parent assistant also gets dropped
      if (msg.role === "tool") toolResultIds.delete(msg.tool_call_id);
      // If dropping an assistant, remove its tool_call IDs so orphaned results get cleaned
      if (msg.role === "assistant" && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) toolCallIds.delete(tc.id);
      }
      continue;
    }
    used += t;
    kept.unshift(msg);

    // Clean up IDs after keeping
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) toolCallIds.delete(tc.id);
    }
  }

  // Messages that never fit in the budget (earliest ones)
  // Drop them too, cleaning up IDs so kept messages stay consistent
  for (let i = nonSystem.length - kept.length - 1; i >= 0; i--) {
    const msg = nonSystem[i];
    dropped.unshift(msg);
    if (msg.role === "tool") toolResultIds.delete(msg.tool_call_id);
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) toolCallIds.delete(tc.id);
    }
  }

  // Final pass: remove orphaned tool results (parent assistant was dropped)
  const validToolCallIds = new Set<string>();
  for (const m of kept) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) validToolCallIds.add(tc.id);
    }
  }
  const cleanKept = kept.filter(m => {
    if (m.role !== "tool") return true;
    return validToolCallIds.has(m.tool_call_id);
  });

  const summary = summarizeDropped(dropped);
  const parts: any[] = [...systemMsgs];
  if (summary) parts.push({ role: "system", content: summary });
  parts.push(...cleanKept);
  return parts;
}
export function stripReasoning(text: string): string {
  // Full think blocks
  let cleaned = text
    .replace(/<\s*think[\s\S]*?<\/\s*think\s*>/gi, "")
    .replace(/<\/?\s*think[^>]*>/gi, "")
    .trim()
  // If it's just raw reasoning with no actual answer, drop it
  // Only applies to clearly introspective English monologues
  if (/^(The user|The assistant|Let me|I should|I need|The question|The input|The text)/i.test(cleaned) && cleaned.length < 200 && !/[一-鿿]/.test(cleaned)) {
    return ""
  }
  return cleaned
}

// ── Per-model tuning ──

interface ModelTuning {
  temperature: number
  maxOutputTokens?: number
}

function getModelTuning(modelId: string): ModelTuning {
  // MiniMax: lower temp, high token cap (m3/m2.7 have thinking overhead)
  if (modelId.includes("minimax")) return { temperature: 0.6, maxOutputTokens: 32768 }
  // DeepSeek: slightly creative but focused
  if (modelId.includes("deepseek")) return { temperature: 0.6, maxOutputTokens: 32768 }
  // Qwen: balanced, some models have thinking
  if (modelId.includes("qwen")) return { temperature: 0.5, maxOutputTokens: 32768 }
  // Zhipu: thinking enabled by default on 5.x models
  if (modelId.includes("glm") || modelId.includes("GLM")) return { temperature: 0.7, maxOutputTokens: 32768 }
  // Kimi: thinking enabled by default on K2.x models
  if (modelId.includes("kimi")) return { temperature: 0.6, maxOutputTokens: 32768 }
  // Default
  return { temperature: 0.7 }
}

// ── Agent node ──

function createAgentNode(model: LanguageModel, systemPrompt: string, tools: ToolDef[], maxTokens: number, maxSteps: number = 1) {
  const toolMap: Record<string, any> = {};
  for (const t of tools) {
    toolMap[t.name] = tool({
      description: t.description,
      parameters: jsonSchema(t.inputSchema as any),
    });
  }

  // Detect model for tuning
  const modelId = (model as any)?.modelId ?? ""
  const tuning = getModelTuning(modelId)

  return async (state: State) => {
    let messages = state.messages.map(m => {
      if (m.role === "tool") {
        // AI SDK v4: tool content as array of tool-result parts
        return {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: m.tool_call_id,
            toolName: m.name ?? "unknown",
            result: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }],
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        // AI SDK v4: assistant with tool calls uses content parts
        // MiniMax rejects empty text part with tool_calls (error 2013) — use placeholder
        const parts: any[] = [];
        parts.push({ type: "text", text: String(m.content || "…") });
        for (const tc of m.tool_calls) {
          const toolName = tc.function?.name ?? tc.name;
          let args = {};
          try { args = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : (tc.args ?? {}); } catch {}
          parts.push({ type: "tool-call", toolCallId: tc.id, toolName, args });
        }
        return { role: "assistant", content: parts };
      }
      // User/system messages: pass through as-is
      return { role: m.role, content: m.content };
    });

    // Check context window
    const systemTokens = estimateTokens(systemPrompt);
    let totalTokens = systemTokens;
    for (const m of messages) totalTokens += estimateMessageTokens(m);

    let wasTruncated = false;
    let truncatedStateMsgs: any[] | null = null;
    if (totalTokens > maxTokens * 0.8) {
      messages = truncateMessages(messages, systemTokens, maxTokens);
      truncatedStateMsgs = truncateMessages(state.messages, systemTokens, maxTokens);
      wasTruncated = true;
    }

    let result: any;
    try {
      result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: toolMap,
        maxSteps,
        temperature: tuning.temperature,
        maxTokens: tuning.maxOutputTokens,
      });
    } catch (err: any) {
      const errMsg = { role: "assistant", content: `[AI 调用失败] ${err.message || "未知错误"}` };
      return { messages: [errMsg], tokenCount: 0, truncated: wasTruncated, done: true };
    }

    const cleanText = stripReasoning(result.text || "");
    const assistantMsg: any = { role: "assistant", content: cleanText };
    if (result.toolCalls?.length) {
      assistantMsg.tool_calls = result.toolCalls.map((tc: any) => ({
        id: tc.toolCallId,
        type: "function",
        function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
      }));
    }

    const newTokens = result.usage?.completionTokens ?? estimateMessageTokens(assistantMsg);

    const resultMessages = wasTruncated && truncatedStateMsgs
      ? [{ __replace__: true, role: "system", content: "" }, ...truncatedStateMsgs, assistantMsg]
      : [assistantMsg];

    return {
      messages: resultMessages,
      tokenCount: newTokens,
      truncated: wasTruncated,
      done: !result.toolCalls?.length,
    };
  };
}

// ── Tool node ──

function createToolNode(tools: ToolDef[]) {
  const toolByName = new Map(tools.map(t => [t.name, t]));

  return async (state: State) => {
    const lastMsg = state.messages[state.messages.length - 1];
    const toolCalls = lastMsg?.tool_calls ?? [];
    if (!toolCalls.length) return {};

    const results: any[] = [];
    let tokenCost = 0;

    for (const tc of toolCalls) {
      const toolName = tc.function?.name ?? tc.name;
      const tool = toolByName.get(toolName);

      if (!tool) {
        const content = `Unknown tool: ${toolName}`;
        results.push({ role: "tool", tool_call_id: tc.id, name: toolName, content });
        tokenCost += estimateTokens(content);
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = typeof tc.function?.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : (tc.args ?? {});
      } catch {
        const content = "Invalid tool arguments";
        results.push({ role: "tool", tool_call_id: tc.id, name: toolName, content });
        tokenCost += estimateTokens(content);
        continue;
      }

      try {
        const output = await tool.execute(args);
        const content = typeof output === "string" ? output : JSON.stringify(output);
        results.push({ role: "tool", tool_call_id: tc.id, name: toolName, content });
        tokenCost += estimateTokens(content);
      } catch (err: any) {
        const content = `Error: ${err.message}`;
        results.push({ role: "tool", tool_call_id: tc.id, name: toolName, content });
        tokenCost += estimateTokens(content);
      }
    }

    return { messages: results, tokenCount: tokenCost, toolStep: 1 };
  };
}

// ── Routing ──

const MAX_TOOL_STEPS = 50;

function shouldContinue(state: State): "tools" | "__end__" {
  if (state.toolStep >= MAX_TOOL_STEPS) return "__end__";
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.tool_calls?.length) return "tools";
  return "__end__";
}

// ── Build ──

export interface AgentConfig {
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolDef[];
  interruptOn?: "tools";
  maxTokens?: number; // 上下文窗口上限，未设置时从 providers.json 读取
  maxSteps?: number; // tool call loop limit, default 1
}

export function buildAgent(config: AgentConfig) {
  const modelId = (config.model as any)?.modelId ?? "";
  let maxTokens = config.maxTokens ?? 0;

  // Resolve contextWindow from provider presets
  if (!maxTokens && modelId) {
    for (const preset of loadPresets()) {
      const m = preset.models.find(m => m.name === modelId);
      if (m && (m as any).contextWindow) {
        maxTokens = (m as any).contextWindow;
        break;
      }
    }
  }
  if (!maxTokens) maxTokens = 131_072;

  const agentNode = createAgentNode(config.model, config.systemPrompt, config.tools, maxTokens, config.maxSteps ?? 1);
  const toolNode = createToolNode(config.tools);

  const graph = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, { tools: "tools", __end__: "__end__" })
    .addEdge("tools", "agent");

  const checkpointer = getCheckpointer();
  const interruptBefore = config.interruptOn === "tools" ? ["tools"] : undefined;

  return graph.compile({ checkpointer, interruptBefore });
}

// ── Token stats ──

export async function getThreadStats(graph: ReturnType<typeof buildAgent>, threadId: string): Promise<{ tokenCount: number; truncated: boolean } | null> {
  try {
    const state = await (graph as any).getState?.({ configurable: { thread_id: threadId } });
    if (!state?.values) return null;
    return {
      tokenCount: state.values.tokenCount ?? 0,
      truncated: state.values.truncated ?? false,
    };
  } catch { return null; }
}

// ── Run ──

export async function* runAgent(
  graph: ReturnType<typeof buildAgent>,
  threadId: string,
  userContent: string,
) {
  const userTokens = estimateTokens(userContent);
  const input = {
    messages: [{ role: "user", content: userContent }],
    threadId,
    tokenCount: userTokens,
  };
  const config = { configurable: { thread_id: threadId } };

  try {
    const stream = await graph.stream(input, config);
    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (err: any) {
    yield { messages: [{ role: "assistant", content: `[运行错误] ${err.message || "未知错误"}` }], done: true };
  }
}

// ── Resume after interrupt ──

export async function* resumeAgent(
  graph: ReturnType<typeof buildAgent>,
  threadId: string,
  approved: boolean,
  feedback?: string,
) {
  const config = { configurable: { thread_id: threadId } };

  if (!approved) {
    // Advance past tools without executing — go straight to END
    const cmd = new Command({ resume: {}, goto: "__end__" });
    try {
      const stream = await graph.stream(cmd, config);
      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (err: any) {
      yield { messages: [{ role: "assistant", content: `[运行错误] ${err.message || "未知错误"}` }], done: true };
    }
    return;
  }

  const cmd = new Command({ resume: { approved: true, feedback } });

  try {
    const stream = await graph.stream(cmd, config);
    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (err: any) {
    yield { messages: [{ role: "assistant", content: `[运行错误] ${err.message || "未知错误"}` }], done: true };
  }
}
