import { describe, it, expect } from "vitest";

// ── Replicated from agent/core.ts ──

function estimateTokens(text: string): number {
  let chars = 0; let words = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) { chars++; }
    else if (/[a-zA-Z0-9]/.test(ch)) { words++; }
    else { chars++; }
  }
  return Math.ceil(chars * 0.6 + words * 0.3);
}

function estimateMessageTokens(msg: any): number {
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

const TRUNCATION_NOTICE = {
  role: "system",
  content: "[对话过长，早期内容已自动截断。关键信息和最近对话已保留。如需之前内容请告知。]",
};

function truncateMessages(messages: any[], systemTokens: number, maxTokens: number): any[] {
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  let used = systemTokens + estimateTokens(TRUNCATION_NOTICE.content);
  const kept: any[] = [];
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(nonSystem[i]);
    if (used + t > maxTokens * 0.85) break;
    used += t;
    kept.unshift(nonSystem[i]);
  }
  return [...systemMsgs, TRUNCATION_NOTICE, ...kept];
}

function stripReasoning(text: string): string {
  let cleaned = text
    .replace(/<\s*think[\s\S]*?<\/\s*think\s*>/gi, "")
    .replace(/<\/?\s*think[^>]*>/gi, "")
    .trim();
  if (/^(The user|The assistant|Let me|I should|I need|The question|The input|The text)/i.test(cleaned) && cleaned.length < 200 && !/[一-鿿]/.test(cleaned)) {
    return "";
  }
  return cleaned;
}

// ═══════════════════════════════════════════
// Token estimation
// ═══════════════════════════════════════════

describe("token estimation", () => {
  it("Chinese text: ~0.6 tokens per char", () => {
    const tokens = estimateTokens("你好世界");
    // 4 Chinese chars → chars*0.6 = 2.4, words*0.3 = 0, ceil → 3
    expect(tokens).toBe(3);
  });

  it("English text: ~0.3 tokens per alpha char", () => {
    // "hello world": 10 alpha (words) + 1 space (char) → 10*0.3 + 1*0.6 = 3.6 → ceil=4
    const tokens = estimateTokens("hello world");
    // h e l l o w o r l d = 10 alpha chars → chars*0.6=0, words*0.3 = 3
    // Actually: "hello world" — h,e,l,l,o,w,o,r,l,d are alpha → words=10. ceil(10*0.3) = 3
    expect(tokens).toBe(4);
  });

  it("mixed Chinese-English text", () => {
    const tokens = estimateTokens("AI助手");
    // A,I = 2 words, 助,手 = 2 chars → 2*0.3 + 2*0.6 = 0.6 + 1.2 = 1.8 → ceil = 2
    expect(tokens).toBe(2);
  });

  it("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("long text is proportional", () => {
    const short = estimateTokens("短");
    const long = estimateTokens("这是一个比较长的中文句子用来测试");
    expect(long).toBeGreaterThan(short);
  });
});

// ═══════════════════════════════════════════
// Message token estimation
// ═══════════════════════════════════════════

describe("message token estimation", () => {
  it("estimates simple user message", () => {
    const msg = { role: "user", content: "你好" };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates array content (AI SDK v4 format)", () => {
    const msg = {
      role: "tool",
      content: [
        { type: "tool-result", toolName: "web_search", toolCallId: "c1", result: "搜索结果" },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates assistant message with tool calls", () => {
    const msg = {
      role: "assistant",
      content: "我需要搜索一下",
      tool_calls: [{ id: "c1", function: { name: "web_search", arguments: '{"query":"test"}' } }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates tool message with tool_call_id", () => {
    const msg = {
      role: "tool",
      content: "搜索结果内容",
      tool_call_id: "c1",
      name: "web_search",
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════
// Truncation
// ═══════════════════════════════════════════

describe("message truncation", () => {
  it("keeps system messages", () => {
    const systemMsgs = [
      { role: "system", content: "System prompt" },
    ];
    const truncated = truncateMessages(systemMsgs, 10, 100_000);
    expect(truncated.some(m => m.role === "system")).toBe(true);
  });

  it("inserts truncation notice when messages exceed limit", () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}: ` + "x".repeat(500),
    }));
    const truncated = truncateMessages(messages, 0, 8000);
    expect(truncated.length).toBeLessThan(messages.length);
    expect(truncated.some(m => m.content?.includes("对话过长"))).toBe(true);
  });

  it("does not truncate when under limit", () => {
    const messages = [
      { role: "user", content: "短消息" },
      { role: "assistant", content: "回复" },
    ];
    const truncated = truncateMessages(messages, 0, 100_000);
    expect(truncated.length).toBe(messages.length + 1); // +1 for truncation notice (always added)
  });

  it("keeps most recent messages", () => {
    const pad = "x".repeat(200);
    const messages = [
      { role: "user", content: "first" + pad },
      { role: "assistant", content: "second" + pad },
      { role: "user", content: "third" + pad },
      { role: "assistant", content: "fourth" + pad },
    ];
    // Each padded message ~60 tokens. maxTokens=200, threshold=170. Notice=30.
    // 30 + 60(fourth) = 90 < 170 keep. 90 + 60(third) = 150 < 170 keep.
    // 150 + 60(second) = 210 > 170 BREAK.
    const truncated = truncateMessages(messages, 0, 200);
    const nonSystem = truncated.filter(m => m.role !== "system" && !m.content?.includes("已截断"));
    const texts = nonSystem.map(m => m.content);
    expect(texts.some(t => t.includes("fourth"))).toBe(true);
    expect(texts.some(t => t.includes("third"))).toBe(true);
    expect(texts.some(t => t.includes("first"))).toBe(false);
  });
});

// ═══════════════════════════════════════════
// Strip reasoning
// ═══════════════════════════════════════════

describe("strip reasoning", () => {
  it("removes think blocks", () => {
    const input = "Before <think>internal reasoning</think> After";
    const result = stripReasoning(input);
    expect(result).toMatch(/^Before\s+After$/);
  });

  it("removes malformed think tags", () => {
    const input = "<think>unclosed think After";
    const result = stripReasoning(input);
    // `</?\s*think[^>]*>/gi` strips <think> tag, leaving "unclosed think After"
    expect(result).toBe("unclosed think After");
  });

  it("strips empty reasoning-only output", () => {
    const input = "Let me think about this for a moment";
    const result = stripReasoning(input);
    expect(result).toBe("");
  });

  it("preserves normal content", () => {
    const input = "这是正常的中文回复";
    const result = stripReasoning(input);
    expect(result).toBe("这是正常的中文回复");
  });

  it("does not strip short English when mixed with Chinese", () => {
    const input = "The user wants 中文回复";
    const result = stripReasoning(input);
    // Has Chinese characters → should not be stripped
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles empty string", () => {
    expect(stripReasoning("")).toBe("");
  });

  it("handles multi-line think blocks", () => {
    const input = `<think>
Line 1
Line 2
</think>
Actual response`;
    const result = stripReasoning(input);
    expect(result).toBe("Actual response");
  });
});

// ═══════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════

describe("estimate edge cases", () => {
  it("handles numbers and punctuation", () => {
    // Numbers are not CJK and not alpha → counted as "chars" (0.6 per)
    const tokens = estimateTokens("价格: 99元");
    // 价,格,9,9,元,： → wait, punctuation like : (in '价格:')...
    // 价 = CJK = chars++, 格 = CJK = chars++, : = other = chars++, space = other = chars++,
    // 9,9 = other = chars++ (×2), 元 = CJK = chars++
    // Total chars = 6, words = 0 → 6 * 0.6 = 3.6 → ceil = 4
    expect(tokens).toBeGreaterThan(0);
  });

  it("emoji counted as chars", () => {
    const tokens = estimateTokens("✨🔥");
    // emojis are not CJK and not alpha
    // ✨,🔥 = other chars = 2 chars → 2 * 0.6 = 1.2 → ceil = 2
    expect(tokens).toBeGreaterThan(0);
  });
});
