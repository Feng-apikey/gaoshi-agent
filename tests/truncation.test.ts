import { describe, it, expect } from "vitest";

// ── Replicated from agent/core.ts (with orphan detection) ──

function estimateTokens(text: string): number {
  let chars = 0; let words = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) { chars++; }
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
  const lines: string[] = ["[\u4ee5\u4e0b\u4e3a\u5386\u53f2\u5bf9\u8bdd\u6458\u8981]"];
  if (userMsgs.length) lines.push(`\u7528\u6237\u8bf7\u6c42: ${userMsgs.join("\uff1b")}`);
  if (toolResults.length) lines.push(`\u5de5\u5177\u7ed3\u679c: ${toolResults.join("\uff1b")}`);
  if (decisions.length) lines.push(`\u52a9\u624b\u56de\u590d\u8981\u70b9: ${decisions.join("\uff1b")}`);
  return lines.join("\n");
}

function truncateMessages(messages: any[], systemTokens: number, maxTokens: number): any[] {
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

  let used = systemTokens + 200;
  const kept: any[] = [];
  const dropped: any[] = [];

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msg = nonSystem[i];
    const t = estimateMessageTokens(msg);

    if (msg.role === "tool" && !toolCallIds.has(msg.tool_call_id)) { dropped.push(msg); continue; }
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const tcIds: string[] = msg.tool_calls.map((tc: any) => tc.id);
      if (!tcIds.every((id: string) => toolResultIds.has(id))) { dropped.push(msg); continue; }
    }

    if (used + t > maxTokens * 0.85) { dropped.push(msg); continue; }
    used += t;
    kept.unshift(msg);

    // Note: do NOT delete from toolResultIds — backwards iteration processes results before their parent assistant
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) toolCallIds.delete(tc.id);
    }
  }

  for (let i = nonSystem.length - kept.length - 1; i >= 0; i--) {
    dropped.unshift(nonSystem[i]);
  }

  const summary = summarizeDropped(dropped);
  const parts: any[] = [...systemMsgs];
  if (summary) parts.push({ role: "system", content: summary });
  parts.push(...kept);
  return parts;
}

// ── Helpers ──

function toolCallMsg(id: string, name = "search"): any {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  };
}

function toolResultMsg(callId: string, content = "result"): any {
  return { role: "tool", tool_call_id: callId, content };
}

function userMsg(content: string): any {
  return { role: "user", content };
}
function assistantMsg(content: string): any {
  return { role: "assistant", content };
}

// ── Tests ──

describe("truncateMessages — orphan detection", () => {
  it("keeps the most recent tool_call + tool_result pair", () => {
    const messages = [
      userMsg("question 1"),
      toolCallMsg("tc1"),
      toolResultMsg("tc1", "answer 1"),
      userMsg("question 2"),
      toolCallMsg("tc2"),
      toolResultMsg("tc2", "answer 2"),
    ];
    const result = truncateMessages(messages, 0, 100_000);

    const toolResults = result.filter(m => m.role === "tool");
    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((m: any) => m.tool_call_id)).toEqual(["tc1", "tc2"]);
  });

  it("drops orphan tool results (no matching tool_call)", () => {
    const messages = [
      userMsg("hello"),
      { role: "tool", tool_call_id: "orphan-id", content: "stale result" },
      assistantMsg("response"),
    ];
    const result = truncateMessages(messages, 0, 100_000);

    expect(result.some((m: any) => m.role === "tool" && m.tool_call_id === "orphan-id")).toBe(false);
    expect(result.some((m: any) => m.content === "hello")).toBe(true);
    expect(result.some((m: any) => m.content === "response")).toBe(true);
  });

  it("drops assistant with tool_calls when results are missing", () => {
    const messages = [
      userMsg("do something"),
      toolCallMsg("tc-missing"),
      assistantMsg("I'll do it"),
    ];
    const result = truncateMessages(messages, 0, 100_000);

    expect(result.some((m: any) => m.tool_calls?.some((tc: any) => tc.id === "tc-missing"))).toBe(false);
    expect(result.some((m: any) => m.content === "I'll do it")).toBe(true);
  });

  it("does NOT drop latest tool_call+result as orphans when budget is tight", () => {
    const oldMessages: any[] = [];
    for (let i = 0; i < 50; i++) {
      oldMessages.push(userMsg("old question " + i + " " + "x".repeat(200)));
      oldMessages.push(assistantMsg("old answer " + i + " " + "y".repeat(200)));
    }

    const latest = [
      userMsg("latest question"),
      toolCallMsg("tc-latest"),
      toolResultMsg("tc-latest", "latest result"),
    ];

    const messages = [...oldMessages, ...latest];
    const result = truncateMessages(messages, 0, 5000);

    const latestToolResult = result.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc-latest"
    );
    expect(latestToolResult).toBeDefined();
    expect(latestToolResult.content).toBe("latest result");

    const latestToolCall = result.find(
      (m: any) => m.role === "assistant" && m.tool_calls?.some((tc: any) => tc.id === "tc-latest")
    );
    expect(latestToolCall).toBeDefined();
  });

  it("keeps paired tool_call+result together even with budget pressure", () => {
    const messages = [
      userMsg("q1"),
      toolCallMsg("tc-a", "toolA"),
      toolResultMsg("tc-a", "result-a " + "z".repeat(2000)),
      userMsg("q2"),
      toolCallMsg("tc-b", "toolB"),
      toolResultMsg("tc-b", "result-b"),
      userMsg("q3"),
      toolCallMsg("tc-c", "toolC"),
      toolResultMsg("tc-c", "result-c"),
    ];

    const result = truncateMessages(messages, 0, 500);

    const keptToolCalls = result
      .filter((m: any) => m.role === "assistant" && m.tool_calls)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.id));

    if (keptToolCalls.includes("tc-b")) {
      expect(result.some((m: any) => m.role === "tool" && m.tool_call_id === "tc-b")).toBe(true);
    }
    if (keptToolCalls.includes("tc-c")) {
      expect(result.some((m: any) => m.role === "tool" && m.tool_call_id === "tc-c")).toBe(true);
    }
  });

  it("preserves system messages", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      userMsg("hi"),
      assistantMsg("hello"),
    ];
    const result = truncateMessages(messages, 0, 100_000);

    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("You are helpful");
  });

  it("adds summary when messages are dropped", () => {
    const messages: any[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(userMsg("question " + i + " " + "x".repeat(300)));
      messages.push(assistantMsg("answer " + i + " " + "y".repeat(300)));
    }

    const result = truncateMessages(messages, 0, 5000);

    const summaryMsg = result.find(
      (m: any) => m.role === "system" && typeof m.content === "string" && m.content.includes("\u5386\u53f2\u5bf9\u8bdd\u6458\u8981")
    );
    expect(summaryMsg).toBeDefined();
  });

  it("handles empty messages array", () => {
    const result = truncateMessages([], 0, 100_000);
    expect(result).toEqual([]);
  });

  it("handles mixed tool_calls with some orphans, some paired", () => {
    const messages = [
      userMsg("start"),
      toolCallMsg("tc-ok"),
      toolResultMsg("tc-ok", "ok result"),
      { role: "tool", tool_call_id: "tc-ghost", content: "ghost result" },
      toolCallMsg("tc-dangling"),
      assistantMsg("final text"),
    ];
    const result = truncateMessages(messages, 0, 100_000);

    expect(result.some((m: any) => m.role === "tool" && m.tool_call_id === "tc-ok")).toBe(true);
    expect(result.some((m: any) => m.role === "tool" && m.tool_call_id === "tc-ghost")).toBe(false);
    expect(result.some((m: any) => m.tool_calls?.some((tc: any) => tc.id === "tc-dangling"))).toBe(false);
    expect(result.some((m: any) => m.content === "final text")).toBe(true);
  });

  it("does not truncate when under limit", () => {
    const messages = [
      userMsg("short"),
      assistantMsg("reply"),
    ];
    const result = truncateMessages(messages, 0, 100_000);
    // Both messages kept, plus summary if any dropped (none here)
    const nonSystem = result.filter(m => m.role !== "system");
    expect(nonSystem).toHaveLength(2);
  });
});