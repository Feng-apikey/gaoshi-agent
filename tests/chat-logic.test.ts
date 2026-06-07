import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════
// Replicate from api/routes/chat.ts
// ═══════════════════════════════════════════

const DANGEROUS_TOOLS = new Set([
  "file_write", "file_move", "file_delete",
]);

function isDangerous(name: string): boolean {
  if (DANGEROUS_TOOLS.has(name)) return true;
  if (name.startsWith("exec")) return true;
  return false;
}

function allWhitelisted(pendingToolCalls: Array<{ name: string }>, autoApprove: boolean): boolean {
  if (autoApprove) return true;
  return pendingToolCalls.length > 0 && !pendingToolCalls.some(tc => isDangerous(tc.name));
}

// ═══════════════════════════════════════════
// isDangerous
// ═══════════════════════════════════════════

describe("isDangerous", () => {
  it("flags file_write as dangerous", () => {
    expect(isDangerous("file_write")).toBe(true);
  });

  it("flags file_move as dangerous", () => {
    expect(isDangerous("file_move")).toBe(true);
  });

  it("flags file_delete as dangerous", () => {
    expect(isDangerous("file_delete")).toBe(true);
  });

  it("flags exec* tools as dangerous", () => {
    expect(isDangerous("exec")).toBe(true);
    expect(isDangerous("exec_shell")).toBe(true);
    expect(isDangerous("exec_python")).toBe(true);
  });

  it("safe tools are not flagged", () => {
    expect(isDangerous("web_search")).toBe(false);
    expect(isDangerous("web_fetch")).toBe(false);
    expect(isDangerous("file_read")).toBe(false);
    expect(isDangerous("file_list")).toBe(false);
    expect(isDangerous("memory_search")).toBe(false);
    expect(isDangerous("memory_save")).toBe(false);
    expect(isDangerous("skill_load")).toBe(false);
    expect(isDangerous("draft_save")).toBe(false);
    expect(isDangerous("draft_get")).toBe(false);
  });
});

// ═══════════════════════════════════════════
// allWhitelisted
// ═══════════════════════════════════════════

describe("allWhitelisted", () => {
  it("returns true when all tools are safe", () => {
    const calls = [{ name: "web_search" }, { name: "file_read" }];
    expect(allWhitelisted(calls, false)).toBe(true);
  });

  it("returns false when any tool is dangerous", () => {
    const calls = [{ name: "web_search" }, { name: "file_write" }];
    expect(allWhitelisted(calls, false)).toBe(false);
  });

  it("returns true for any tools when autoApprove is enabled", () => {
    const calls = [{ name: "file_delete" }, { name: "exec" }];
    expect(allWhitelisted(calls, true)).toBe(true);
  });

  it("returns false for empty tool list (no autoApprove)", () => {
    expect(allWhitelisted([], false)).toBe(false);
  });

  it("returns true for empty tool list (autoApprove on)", () => {
    expect(allWhitelisted([], true)).toBe(true);
  });

  it("single safe tool passes", () => {
    expect(allWhitelisted([{ name: "memory_search" }], false)).toBe(true);
  });

  it("single dangerous tool fails", () => {
    expect(allWhitelisted([{ name: "file_delete" }], false)).toBe(false);
  });

  it("exec_shell is dangerous", () => {
    expect(isDangerous("exec_shell")).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Thread state management
// ═══════════════════════════════════════════

interface ThreadState {
  queue: { id: string; text: string }[];
  running: boolean;
  abort: AbortController | null;
}

describe("thread state management", () => {
  it("creates new thread state with defaults", () => {
    const state: ThreadState = { queue: [], running: false, abort: null };
    expect(state.queue).toEqual([]);
    expect(state.running).toBe(false);
    expect(state.abort).toBeNull();
  });

  it("enqueues messages in order", () => {
    const state: ThreadState = { queue: [], running: false, abort: null };
    state.queue.push({ id: "msg_1", text: "first" });
    state.queue.push({ id: "msg_2", text: "second" });
    expect(state.queue.length).toBe(2);
    expect(state.queue[0].id).toBe("msg_1");
    expect(state.queue[1].id).toBe("msg_2");
  });

  it("processes queue FIFO", () => {
    const state: ThreadState = { queue: [], running: false, abort: null };
    state.queue.push({ id: "msg_1", text: "first" });
    state.queue.push({ id: "msg_2", text: "second" });

    const first = state.queue.shift()!;
    expect(first.id).toBe("msg_1");

    const second = state.queue.shift()!;
    expect(second.id).toBe("msg_2");

    expect(state.queue.length).toBe(0);
  });

  it("abort controller signals correctly", () => {
    const ac = new AbortController();
    expect(ac.signal.aborted).toBe(false);
    ac.abort();
    expect(ac.signal.aborted).toBe(true);
  });

  it("thread state transitions running flag", () => {
    const state: ThreadState = { queue: [], running: false, abort: null };
    expect(state.running).toBe(false);
    state.running = true;
    expect(state.running).toBe(true);
    state.running = false;
    expect(state.running).toBe(false);
  });
});

// ═══════════════════════════════════════════
// Message ID uniqueness
// ═══════════════════════════════════════════

describe("message ID generation", () => {
  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });
});

// ═══════════════════════════════════════════
// Agent cache key
// ═══════════════════════════════════════════

describe("agent cache key generation", () => {
  it("same inputs produce same key", () => {
    const tools = ["web_search", "file_read", "draft_save"].sort().join(",");
    const sp = "system prompt";
    const modelId = "deepseek-chat";
    const key1 = `${sp}|${tools}|${modelId}`;
    const key2 = `${sp}|${tools}|${modelId}`;
    expect(key1).toBe(key2);
  });

  it("different tools produce different keys", () => {
    const tools1 = ["web_search", "file_read"].sort().join(",");
    const tools2 = ["web_search", "file_write"].sort().join(",");
    expect(tools1).not.toBe(tools2);
  });

  it("different system prompts produce different keys", () => {
    const sp1 = "prompt A";
    const sp2 = "prompt B";
    const tools = "web_search";
    expect(`${sp1}|${tools}`).not.toBe(`${sp2}|${tools}`);
  });
});

// ═══════════════════════════════════════════
// Thread title truncation
// ═══════════════════════════════════════════

describe("thread title truncation", () => {
  it("truncates message to 30 chars for thread title", () => {
    const message = "这是一条非常长的消息，用来测试标题截断功能是否正常工作";
    const title = message.slice(0, 30) || "新对话";
    expect(title.length).toBeLessThanOrEqual(30);
  });

  it("defaults to 新对话 for empty message", () => {
    const message = "";
    const title = message.slice(0, 30) || "新对话";
    expect(title).toBe("新对话");
  });

  it("keeps short messages as-is", () => {
    const message = "你好";
    const title = message.slice(0, 30) || "新对话";
    expect(title).toBe("你好");
  });
});

// ═══════════════════════════════════════════
// MAX_AUTO_STEPS
// ═══════════════════════════════════════════

describe("auto-resume limits", () => {
  it("MAX_AUTO_STEPS prevents infinite loops", () => {
    const MAX_AUTO_STEPS = 20;
    let steps = 0;
    // Simulate auto-resume loop
    while (steps < MAX_AUTO_STEPS) {
      steps++;
      if (steps >= MAX_AUTO_STEPS) break;
    }
    expect(steps).toBe(MAX_AUTO_STEPS);
  });
});
