import { describe, it, expect } from "vitest";

const API_KEY = process.env.TEST_API_KEY || "";

const SKIP = !API_KEY;
const BASE_URL = "https://api.deepseek.com/v1";

async function chat(model: string, content: string, maxTokens = 50) {
  if (!API_KEY) return { error: { message: "未配置 TEST_API_KEY 环境变量，跳过 API 测试" } };
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens }),
  });
  return resp.json() as any;
}

describe.skipIf(SKIP)("deepseek v4 models", () => {
  it("deepseek-v4-pro returns valid response", async () => {
    const data = await chat("deepseek-v4-pro", "say hi", 200);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("deepseek-v4-pro");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("deepseek-v4-pro produces content with enough tokens", async () => {
    const data = await chat("deepseek-v4-pro", "say hi", 500);
    const msg = data.choices[0].message;
    expect(msg.content || msg.reasoning_content).toBeTruthy();
  }, 30_000);

  it("deepseek-v4-flash returns valid response", async () => {
    const data = await chat("deepseek-v4-flash", "say hi", 200);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("deepseek-v4-flash");
  }, 20_000);

  it("deepseek-v4-flash has thinking mode", async () => {
    const data = await chat("deepseek-v4-flash", "1+1=?", 500);
    const msg = data.choices[0].message;
    expect(msg.reasoning_content || msg.content).toBeTruthy();
  }, 30_000);

  it("deepseek-v4-pro returns Chinese content", async () => {
    const data = await chat("deepseek-v4-pro", "你好，回复一个字", 500);
    const content = data.choices[0].message.content;
    if (content) {
      expect(/[一-鿿]/.test(content)).toBe(true);
    }
  }, 30_000);

  it("old model name deepseek-chat still works", async () => {
    const data = await chat("deepseek-chat", "say hi", 20);
    expect(data.choices).toBeDefined();
  }, 15_000);
});

describe.skipIf(SKIP)("deepseek error handling", () => {
  it("returns error for invalid model", async () => {
    const data = await chat("nonexistent-model", "hi", 10);
    expect(data.error).toBeDefined();
  }, 10_000);

  it("returns error for invalid auth", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-key" },
      body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] }),
    });
    const data = await resp.json() as any;
    expect(data.error).toBeDefined();
  }, 10_000);
});
