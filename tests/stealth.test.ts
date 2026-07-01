// Stealth test — verify the init script makes the page read as "human".
//
// Strategy: launch Playwright's bundled chromium headless (no Edge dependency),
// apply STEALTH_INIT_SCRIPT, navigate to a data URL, evaluate the properties
// anti-bot scripts look at, and assert all values are "human-like".

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { STEALTH_INIT_SCRIPT } from "../publish/stealth.ts";

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
});

afterAll(async () => {
  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}
});

describe("STEALTH_INIT_SCRIPT", () => {
  it("navigator.webdriver → false (而不是 true)", async () => {
    const page = await context.newPage();
    await page.goto("data:text/html,<html><body>test</body></html>");
    const wd = await page.evaluate(() => navigator.webdriver);
    expect(wd).toBe(false);
    await page.close();
  });

  it("document.__webdriver_evaluate 已删", async () => {
    const page = await context.newPage();
    await page.goto("data:text/html,<html><body>test</body></html>");
    const hooks = await page.evaluate(() => ({
      webdriver_evaluate: typeof (document as any).__webdriver_evaluate,
      webdriver_script_function: typeof (document as any).__webdriver_script_function,
      selenium_unwrapped: typeof (document as any).__selenium_unwrapped,
      window_webdriver_evaluate: typeof (window as any).__webdriver_evaluate,
    }));
    expect(hooks.webdriver_evaluate).toBe("undefined");
    expect(hooks.webdriver_script_function).toBe("undefined");
    expect(hooks.selenium_unwrapped).toBe("undefined");
    expect(hooks.window_webdriver_evaluate).toBe("undefined");
    await page.close();
  });

  it("navigator.plugins 给出 5 个 PDF Viewer (真人 Edge 不为 0)", async () => {
    const page = await context.newPage();
    await page.goto("data:text/html,<html><body>test</body></html>");
    const plugins = await page.evaluate(() => {
      const list = navigator.plugins;
      const names: string[] = [];
      for (let i = 0; i < list.length; i++) names.push(list[i].name);
      return { count: list.length, names };
    });
    expect(plugins.count).toBeGreaterThanOrEqual(4);
    expect(pluginNames(plugins.names)).toContain("PDF Viewer");
    expect(pluginNames(plugins.names)).toContain("Microsoft Edge PDF Viewer");
    await page.close();
  });

  it("navigator.languages = ['zh-CN','zh','en-US','en']", async () => {
    const page = await context.newPage();
    await page.goto("data:text/html,<html><body>test</body></html>");
    const langs = await page.evaluate(() => Array.from(navigator.languages));
    expect(langs).toContain("zh-CN");
    expect(langs).toContain("zh");
    await page.close();
  });

  it("navigator.plugins.item(n) / namedItem 兼容", async () => {
    // PDF 检测代码经常用 plugins['name'] 或 plugins.item(0)
    const page = await context.newPage();
    await page.goto("data:text/html,<html><body>test</body></html>");
    const probe = await page.evaluate(() => {
      const p = navigator.plugins;
      return {
        item0: p.item(0)?.name ?? null,
        namedPDF: p.namedItem("PDF Viewer")?.name ?? null,
        length: p.length,
      };
    });
    expect(probe.item0).toBe("PDF Viewer");
    expect(probe.namedPDF).toBe("PDF Viewer");
    expect(probe.length).toBeGreaterThanOrEqual(4);
    await page.close();
  });
});

// 帮助函数 — vitest matcher 用数组断言时读 Element 数组没问题,raw 字符串数组也行
function pluginNames(arr: string[]): string[] { return arr; }
