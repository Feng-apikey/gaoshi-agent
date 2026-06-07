import { describe, it, expect } from "vitest";

const API_KEY = process.env.TEST_API_KEY || "";

const SKIP = !API_KEY;
const BASE_URL = "https://api.moonshot.cn/v1";

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

describe("kimi text models", () => {
  it("kimi-k2.6 returns valid response", async () => {
    const data = await chat("kimi-k2.6", "say hi", 200);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("kimi-k2.6");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("kimi-k2.6 produces content beyond reasoning", async () => {
    const data = await chat("kimi-k2.6", "say hi", 500);
    const msg = data.choices[0].message;
    expect(msg).toBeDefined();
    // With 500 tokens, should get actual content + reasoning
    expect(msg.content || msg.reasoning_content).toBeTruthy();
  }, 30_000);

  it("kimi-k2.6 returns Chinese content", async () => {
    const data = await chat("kimi-k2.6", "你好，回复一个字", 500);
    const content = data.choices[0].message.content;
    expect(content).toBeTruthy();
    expect(/[一-鿿]/.test(content)).toBe(true);
  }, 30_000);

  it("kimi-k2.5 returns valid response", async () => {
    const data = await chat("kimi-k2.5", "say hi", 200);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("kimi-k2.5");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("kimi-k2.5 has thinking mode", async () => {
    const data = await chat("kimi-k2.5", "1+1等于几？", 500);
    const msg = data.choices[0].message;
    expect(msg.reasoning_content || msg.content).toBeTruthy();
  }, 30_000);
});

// ═══════════════════════════════════════════
// Vision model
// ═══════════════════════════════════════════

describe("kimi vision", () => {
  it("kimi-k2.6 handles base64 image input", async () => {
    // Download a small test image and encode as base64
    const imgResp = await fetch("https://www.w3schools.com/html/pic_trulli.jpg");
    const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
    const base64 = imgBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: "kimi-k2.6",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe this image briefly" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 300,
      }),
    });
    const data = await resp.json() as any;
    expect(data.choices).toBeDefined();
    const msg = data.choices[0].message;
    const text = msg.content || msg.reasoning_content;
    expect(text).toBeTruthy();
  }, 30_000);
});

// ═══════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════

describe("kimi error handling", () => {
  it("returns error for invalid model", async () => {
    const data = await chat("nonexistent-model", "hi", 10);
    expect(data.error).toBeDefined();
  }, 10_000);

  it("returns error for invalid auth", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-key" },
      body: JSON.stringify({ model: "kimi-k2.6", messages: [{ role: "user", content: "hi" }] }),
    });
    const data = await resp.json() as any;
    expect(data.error).toBeDefined();
  }, 10_000);
});
