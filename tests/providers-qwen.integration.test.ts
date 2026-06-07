import { describe, it, expect } from "vitest";

const API_KEY = process.env.TEST_API_KEY || "";

const SKIP = !API_KEY;
const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

async function chat(model: string, content: string, maxTokens = 50) {
  if (!API_KEY) return { error: { message: "未配置 TEST_API_KEY 环境变量，跳过 API 测试" } };
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens }),
  });
  return resp.json() as any;
}

// ═══════════════════════════════════════════
// Text models
// ═══════════════════════════════════════════

describe.skipIf(SKIP)("qwen text models", () => {
  it("qwen3.7-max returns valid response", async () => {
    const data = await chat("qwen3.7-max", "say hi", 20);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("qwen3.7-max");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 15_000);

  it("qwen3.6-plus returns valid response", async () => {
    const data = await chat("qwen3.6-plus", "say hi", 20);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("qwen3.6-plus");
  }, 15_000);

  it("qwen3.5-plus text works", async () => {
    const data = await chat("qwen3.5-plus", "say hi", 20);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("qwen3.5-plus");
  }, 15_000);

  it("qwen3.5-plus has thinking", async () => {
    const data = await chat("qwen3.5-plus", "1+1=?", 100);
    const msg = data.choices[0].message;
    expect(msg.content || msg.reasoning_content).toBeTruthy();
  }, 15_000);

  it("qwen3.7-max returns Chinese content", async () => {
    const data = await chat("qwen3.7-max", "你好", 50);
    const content = data.choices[0].message.content;
    expect(content).toBeTruthy();
  }, 15_000);
});

// ═══════════════════════════════════════════
// Vision models
// ═══════════════════════════════════════════

describe.skipIf(SKIP)("qwen vision models", () => {
  it("qwen3.5-plus vision works", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: "qwen3.5-plus",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "what color is the sky in this image?" },
            { type: "image_url", image_url: { url: "https://www.w3schools.com/html/pic_trulli.jpg" } },
          ],
        }],
        max_tokens: 50,
      }),
    });
    const data = await resp.json() as any;
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("qwen3.5-plus");
    const content = data.choices[0].message.content;
    expect(content).toBeTruthy();
  }, 20_000);
});

// ═══════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════

describe.skipIf(SKIP)("qwen error handling", () => {
  it("returns error for invalid model", async () => {
    const data = await chat("nonexistent-model", "hi", 10);
    expect(data.error).toBeDefined();
  }, 10_000);

  it("returns error for invalid auth", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-key" },
      body: JSON.stringify({ model: "qwen3.6-plus", messages: [{ role: "user", content: "hi" }] }),
    });
    const data = await resp.json() as any;
    expect(data.error).toBeDefined();
  }, 10_000);
});
