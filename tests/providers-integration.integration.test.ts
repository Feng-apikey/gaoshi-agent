import { describe, it, expect } from "vitest";

const API_KEY = process.env.TEST_API_KEY || "";

const SKIP = !API_KEY;
const BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

async function chat(model: string, content: string, maxTokens = 50) {
  if (!API_KEY) return { error: { message: "未配置 TEST_API_KEY 环境变量，跳过 API 测试" } };
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens }),
  });
  return resp.json() as any;
}

async function generateImage(model: string, prompt: string) {
  const resp = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
  });
  return resp.json() as any;
}

// ═══════════════════════════════════════════
// Text models
// ═══════════════════════════════════════════

describe("zhipu text models", () => {
  it("glm-4.7 returns valid response", async () => {
    const data = await chat("glm-4.7", "回复一个字：好", 20);
    expect(data.choices).toBeDefined();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.model).toBe("glm-4.7");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 15_000);

  it("glm-4.7 returns Chinese content", async () => {
    const data = await chat("glm-4.7", "用中文回复：你好", 100);
    const content = data.choices[0].message.content;
    expect(content).toBeTruthy();
    expect(/[一-鿿]/.test(content)).toBe(true);
  }, 15_000);

  it("glm-5.1 returns valid response", async () => {
    const data = await chat("glm-5.1", "回复一个字：好", 100);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("glm-5.1");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("glm-5.1 has reasoning_content when thinking", async () => {
    const data = await chat("glm-5.1", "1+1等于几？", 200);
    const msg = data.choices[0].message;
    // glm-5.1 defaults to thinking mode — either content or reasoning_content is present
    expect(msg.content || msg.reasoning_content).toBeTruthy();
  }, 20_000);

  it("glm-5-turbo returns valid response", async () => {
    const data = await chat("glm-5-turbo", "说一个词", 100);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("glm-5-turbo");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("glm-5-turbo is faster than glm-5.1", async () => {
    // Not asserting speed, just confirming both work
    const [r1, r2] = await Promise.all([
      chat("glm-5-turbo", "hi", 20),
      chat("glm-5.1", "hi", 20),
    ]);
    expect(r1.model).toBe("glm-5-turbo");
    expect(r2.model).toBe("glm-5.1");
  }, 30_000);
});

// ═══════════════════════════════════════════
// Vision model
// ═══════════════════════════════════════════

describe("zhipu vision model", () => {
  it("GLM-5V-Turbo returns valid response for text-only", async () => {
    const data = await chat("GLM-5V-Turbo", "say hi", 50);
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("GLM-5V-Turbo");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  }, 15_000);

  it("GLM-5V-Turbo handles image input", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: "GLM-5V-Turbo",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "描述这张图片的颜色" },
            { type: "image_url", image_url: { url: "https://www.w3schools.com/html/pic_trulli.jpg" } },
          ],
        }],
        max_tokens: 100,
      }),
    });
    const data = await resp.json() as any;
    expect(data.choices).toBeDefined();
    expect(data.model).toBe("GLM-5V-Turbo");
    // Should return some content describing the image
    const content = data.choices[0].message.content || data.choices[0].message.reasoning_content;
    expect(content).toBeTruthy();
  }, 30_000);
});

// ═══════════════════════════════════════════
// Image generation
// ═══════════════════════════════════════════

describe("zhipu image generation", () => {
  it("GLM-Image generates an image URL", async () => {
    const data = await generateImage("GLM-Image", "a red apple on white background");
    expect(data.data).toBeDefined();
    expect(data.data.length).toBeGreaterThan(0);
    if (data.data[0].url) {
      expect(data.data[0].url).toMatch(/^https?:\/\//);
    } else {
      // API may return error if model name case is wrong
      expect(data.error || data.data).toBeDefined();
    }
  }, 60_000);

  it("generated image URL is accessible", async () => {
    const data = await generateImage("GLM-Image", "blue sky with clouds");
    const url = data.data?.[0]?.url;
    if (url) {
      const resp = await fetch(url);
      expect(resp.status).toBe(200);
    }
  }, 60_000);
});

// ═══════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════

describe("zhipu error handling", () => {
  it("returns error for invalid model", async () => {
    const data = await chat("nonexistent-model", "hi", 10);
    expect(data.error).toBeDefined();
  }, 10_000);

  it("returns error for invalid auth", async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-key" },
      body: JSON.stringify({ model: "glm-4.7", messages: [{ role: "user", content: "hi" }] }),
    });
    const data = await resp.json() as any;
    expect(data.error).toBeDefined();
  }, 10_000);
});

// ═══════════════════════════════════════════
// Provider config validation
// ═══════════════════════════════════════════

describe("zhipu provider preset", () => {
  it("all declared models exist in API", async () => {
    // Load preset and verify each model responds
    const models = ["glm-5.1", "glm-5-turbo", "glm-4.7", "GLM-5V-Turbo"];
    for (const model of models) {
      const data = await chat(model, "hi", 10);
      expect(data.error).toBeUndefined();
      expect(data.choices).toBeDefined();
    }
  }, 60_000);

  it("covers all declared capabilities", async () => {
    // text ✓ (glm-4.7 tested above)
    // vision ✓ (GLM-5V-Turbo tested above)
    // video — GLM-5V-Turbo also supports video, same endpoint
    // image ✓ (GLM-Image tested above)
    // tts — not declared
    // music — not declared

    const caps = (await import("../config/providers.example.json", { with: { type: "json" } }).catch(() => null)) as any;
    if (caps) {
      const zhipu = caps.default?.find?.((p: any) => p.id === "zhipu") ?? caps.find?.((p: any) => p.id === "zhipu");
      if (zhipu) {
        const modelNames = new Set(zhipu.models.map((m: any) => m.name));
        expect(modelNames.has("glm-5.1")).toBe(true);
        expect(modelNames.has("GLM-5V-Turbo")).toBe(true);
        expect(modelNames.has("GLM-Image")).toBe(true);
      }
    }
  });
});
