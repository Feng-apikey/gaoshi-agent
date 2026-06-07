import type { Page, Locator } from "playwright";

// ── Random helpers ──

function rand(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number): number { return Math.random() * (max - min) + min; }

export const sleep = (ms: number): Promise<void> => {
  // Use percentage jitter for long waits, absolute jitter for short ones
  const pctJitter = Math.floor(ms * 0.2);
  const absJitter = Math.max(50, pctJitter);
  return new Promise(r => setTimeout(r, ms + rand(-absJitter, absJitter)));
};

// ── Mouse position tracker ──

let _mouseX = 400 + rand(-50, 50);
let _mouseY = 300 + rand(-50, 50);

export function resetMousePosition(): void {
  _mouseX = 400 + rand(-50, 50);
  _mouseY = 300 + rand(-50, 50);
}

// ── Quadratic Bezier ──

function bezierQuad(t: number, p0: number, cp: number, p1: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * cp + t * t * p1;
}

// ── Human-like mouse movement ──

export async function humanMouseMove(page: Page, toX: number, toY: number): Promise<void> {
  const fromX = _mouseX;
  const fromY = _mouseY;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 5) {
    await page.mouse.move(toX, toY);
    _mouseX = toX;
    _mouseY = toY;
    return;
  }

  const baseSteps = Math.max(8, Math.min(50, Math.round(dist / 10)));
  const steps = baseSteps + rand(-3, 5);

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const curvature = randFloat(-0.3, 0.3) * dist;
  const cpX = midX + perpX * curvature + randFloat(-20, 20);
  const cpY = midY + perpY * curvature + randFloat(-20, 20);

  const doOvershoot = Math.random() < 0.1;
  const finalX = doOvershoot ? toX + rand(-8, 8) : toX;
  const finalY = doOvershoot ? toY + rand(-8, 8) : toY;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.round(bezierQuad(eased, fromX, cpX, finalX));
    const y = Math.round(bezierQuad(eased, fromY, cpY, finalY));
    await page.mouse.move(x, y);
    const speed = t < 0.2 || t > 0.8 ? rand(2, 6) : rand(1, 3);
    await sleep(speed);
  }

  if (doOvershoot) {
    await sleep(rand(30, 80));
    const corrSteps = rand(3, 6);
    for (let i = 1; i <= corrSteps; i++) {
      const t = i / corrSteps;
      const x = Math.round(finalX + (toX - finalX) * t);
      const y = Math.round(finalY + (toY - finalY) * t);
      await page.mouse.move(x, y);
      await sleep(rand(1, 3));
    }
  }

  _mouseX = toX;
  _mouseY = toY;
}

// ── Element interaction ──

export async function humanMoveTo(page: Page, locator: Locator): Promise<{ x: number; y: number } | null> {
  try {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width * randFloat(0.3, 0.7);
      const targetY = box.y + box.height * randFloat(0.3, 0.7);
      await humanMouseMove(page, targetX, targetY);
      // Return element-relative coordinates for click positioning
      return { x: targetX - box.x, y: targetY - box.y };
    }
  } catch {}
  return null;
}

export async function humanClick(page: Page, locator: Locator): Promise<void> {
  const pos = await humanMoveTo(page, locator);
  await sleep(rand(50, 200));
  if (pos) {
    await locator.click({ position: pos });
  } else {
    await locator.click();
  }
}

export async function humanPause(minMs = 200, maxMs = 1500): Promise<void> {
  await sleep(rand(minMs, maxMs));
}

// ── Clipboard paste ──

export async function pasteText(page: Page, text: string): Promise<void> {
  const ok = await page.evaluate((t: string) => {
    const ta = document.createElement("textarea");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.value = t;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const r = document.execCommand("copy");
    document.body.removeChild(ta);
    return r;
  }, text);
  if (!ok) {
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await sleep(rand(50, 100));
    await page.evaluate((t: string) => {
      const ta = document.createElement("textarea");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.value = t;
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }, text);
  }
  await sleep(rand(50, 120));
  await page.keyboard.press("Control+v");
}

// ── Popups ──

const POPUP_TEXTS = ["我知道了", "知道了", "关闭", "跳过", "取消"];

export async function dismissPopups(page: Page): Promise<void> {
  for (const txt of POPUP_TEXTS) {
    try {
      const btn = page.getByRole("button", { name: txt }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await humanClick(page, btn);
        await sleep(rand(300, 600));
        break;
      }
    } catch {}
  }
}
