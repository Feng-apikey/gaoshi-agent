import type { Page, Locator } from "playwright";

// ── Random helpers ──

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms + rand(-ms * 0.2, ms * 0.2)));
}

// ── Mouse ──

export async function humanMove(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) return;
  const tx = box.x + box.width * rand(0.3, 0.7);
  const ty = box.y + box.height * rand(0.3, 0.7);
  // Move in small steps for human-like curve
  const steps = Math.floor(rand(3, 8));
  const startX = tx - rand(-100, 100);
  const startY = ty - rand(-50, 50);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = startX + (tx - startX) * t + Math.sin(t * Math.PI) * rand(-5, 5);
    const y = startY + (ty - startY) * t + Math.sin(t * Math.PI) * rand(-3, 3);
    await page.mouse.move(x, y);
    await new Promise(r => setTimeout(r, rand(5, 15)));
  }
}

export async function humanClick(page: Page, target: Locator): Promise<void> {
  await humanMove(page, target);
  await sleep(rand(50, 150));
  await target.click();
}

// ── Keyboard ──

export async function humanType(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.press(ch);
    await new Promise(r => setTimeout(r, rand(30, 120)));
  }
}

// ── Popups ──

const POPUP_TEXTS = ["我知道了", "知道了", "关闭", "跳过", "取消"];

export async function dismissPopups(page: Page): Promise<void> {
  for (const txt of POPUP_TEXTS) {
    try {
      const btn = page.getByRole("button", { name: txt });
      if (await btn.isVisible({ timeout: 1500 })) {
        await humanClick(page, btn);
        await sleep(500);
      }
    } catch {}
  }
}
