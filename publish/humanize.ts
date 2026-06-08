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

type MoveStyle = 'normal' | 'straight' | 'hesitate';

function pickMoveStyle(dist: number): MoveStyle {
  if (dist < 80) return Math.random() < 0.5 ? 'normal' : 'straight';
  const r = Math.random();
  if (r < 0.70) return 'normal';
  if (r < 0.90) return 'straight';
  return 'hesitate';
}

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

  const style = pickMoveStyle(dist);

  if (style === 'hesitate') {
    const angle = randFloat(0, Math.PI * 2);
    const overshootDist = rand(25, 55);
    const nearX = toX + Math.cos(angle) * overshootDist;
    const nearY = toY + Math.sin(angle) * overshootDist;
    await bezierMove(page, _mouseX, _mouseY, nearX, nearY, 0.15, 0.05);
    _mouseX = nearX;
    _mouseY = nearY;
    await sleep(rand(200, 400));
    await bezierMove(page, _mouseX, _mouseY, toX, toY, 0.05, 0);
    _mouseX = toX;
    _mouseY = toY;
    return;
  }

  const curvatureRange = style === 'straight' ? 0.06 : 0.30;
  const overshootChance = style === 'straight' ? 0.03 : 0.10;
  await bezierMove(page, fromX, fromY, toX, toY, curvatureRange, overshootChance);
  _mouseX = toX;
  _mouseY = toY;
}

async function bezierMove(
  page: Page,
  fromX: number, fromY: number,
  toX: number, toY: number,
  curvatureRange: number,
  overshootChance: number,
): Promise<void> {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const baseSteps = Math.max(8, Math.min(50, Math.round(dist / 10)));
  const steps = baseSteps + rand(-3, 5);

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const curvature = randFloat(-curvatureRange, curvatureRange) * dist;
  const cpX = midX + perpX * curvature + randFloat(-20, 20);
  const cpY = midY + perpY * curvature + randFloat(-20, 20);

  const doOvershoot = Math.random() < overshootChance;
  const finalX = doOvershoot ? toX + rand(-8, 8) : toX;
  const finalY = doOvershoot ? toY + rand(-8, 8) : toY;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.round(bezierQuad(eased, fromX, cpX, finalX)) + rand(-1, 1);
    const y = Math.round(bezierQuad(eased, fromY, cpY, finalY)) + rand(-1, 1);
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
}

// ── Element interaction ──

export async function humanMoveTo(page: Page, locator: Locator): Promise<{ x: number; y: number } | null> {
  try {
    await locator.scrollIntoViewIfNeeded();
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

/** Simulate a human scanning what they just wrote before moving on. */
export async function humanReadPause(): Promise<void> {
  await sleep(rand(800, 2500));
}

// ── Clipboard paste ──

export async function pasteText(page: Page, text: string): Promise<void> {
  // Primary: native Clipboard API via CDP permission grant
  let copied = false;
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Browser.grantPermissions", {
      permissions: ["clipboardReadWrite"],
      origin: page.url(),
    });
    copied = await page.evaluate(async (t: string) => {
      try {
        await navigator.clipboard.writeText(t);
        return true;
      } catch {
        return false;
      }
    }, text);
  } catch {}

  // Fallback: legacy execCommand
  if (!copied) {
    copied = await page.evaluate((t: string) => {
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
    if (!copied) {
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
        continue;
      }
    } catch {}
  }
}

// ── Shared DOM helpers ──

/**
 * Pick the first visible locator from a chain of semantic candidates.
 */
export async function pickVisible(page: Page, factories: Array<() => Locator>, timeout = 3000): Promise<Locator | null> {
  for (const factory of factories) {
    const loc = factory();
    try {
      if (await loc.first().isVisible({ timeout })) return loc.first();
    } catch {}
  }
  return null;
}

/** Check if the current page has been redirected to a login/signin page. */
export function isOnLoginPage(page: Page): boolean {
  const url = page.url();
  return url.includes("/login") || url.includes("/signin");
}

/**
 * Wait for a file upload to complete by watching network idle, then a short DOM buffer.
 * Falls back to a generous timeout if network never settles (e.g. polling pages).
 */
export async function waitForUploadComplete(page: Page, isVideo: boolean): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: isVideo ? 120000 : 30000 });
  } catch {}
  await sleep(isVideo ? 2000 : 1000);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Start a background loop that simulates human idle behavior during long waits
 * (e.g. video upload). Returns a stop function.
 *
 * Three movement modes mixed probabilistically:
 *   A (60%) – micro-fidget: 2–5 tiny 5–40px shifts, wrist-only
 *   B (20%) – check progress: move toward top-center, small oscillations, 1–2s hold
 *   C (20%) – rest position: move to center-right, go still for 3–8s
 *
 * Timing follows burst clusters: 70% long pauses (12–35s), 30% short (3–10s).
 * 30% chance of a micro-scroll before each burst.
 */
/**
 * Wrap a long-running async operation with idle mouse movement.
 * Starts background fidgeting, awaits fn, stops fidgeting (even on error).
 */
export async function withIdleMouseMove<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const stop = startIdleMouseMove(page);
  try {
    return await fn();
  } finally {
    stop();
  }
}

export function startIdleMouseMove(page: Page): () => void {
  let running = true;

  // Sleep that checks `running` every 200ms so stop() takes effect promptly.
  async function idleSleep(maxMs: number): Promise<void> {
    const step = 200;
    const steps = Math.ceil(maxMs / step);
    for (let i = 0; i < steps; i++) {
      if (!running) return;
      await sleep(step);
    }
  }

  // ── Mode A: micro-fidget ──
  async function microFidget() {
    const moves = rand(2, 5);
    for (let i = 0; i < moves; i++) {
      if (!running) return;
      const tx = clamp(_mouseX + rand(-40, 40), 100, 1340);
      const ty = clamp(_mouseY + rand(-30, 30), 100, 800);
      await page.mouse.move(tx, ty, { steps: rand(2, 5) });
      _mouseX = tx;
      _mouseY = ty;
      await sleep(rand(100, 400));
    }
  }

  // ── Mode B: check progress (top of page) ──
  async function checkProgress() {
    const tx = rand(500, 900);
    const ty = rand(60, 180);
    await humanMouseMove(page, tx, ty);
    // Small oscillations — "reading" progress
    for (let i = 0; i < rand(2, 4); i++) {
      if (!running) return;
      _mouseX = tx + rand(-20, 20);
      _mouseY = ty + rand(-10, 10);
      await page.mouse.move(_mouseX, _mouseY, { steps: rand(2, 4) });
      await sleep(rand(300, 800));
    }
    await idleSleep(rand(800, 1500));
  }

  // ── Mode C: rest position (right-handed default) ──
  async function restPosition() {
    await humanMouseMove(page, rand(800, 1200), rand(300, 600));
    await idleSleep(rand(3000, 8000));
  }

  async function loop() {
    let first = true;
    while (running) {
      // First burst: short delay (2–8s) — user watches upload start before fidgeting.
      // Subsequent: power-law — mostly long pauses (12–35s), occasional short (3–10s).
      const waitMs = first
        ? rand(2000, 8000)
        : Math.random() < 0.7
          ? rand(12000, 35000)
          : rand(3000, 10000);
      first = false;
      await idleSleep(waitMs);
      if (!running) break;

      try {
        // 30% chance: micro-scroll before moving
        if (Math.random() < 0.3) {
          const dy = rand(30, 100) * (Math.random() < 0.5 ? 1 : -1);
          await page.mouse.wheel(0, dy);
          await sleep(rand(200, 500));
          // Sometimes scroll back partway
          if (Math.random() < 0.4) {
            await page.mouse.wheel(0, Math.round(-dy * randFloat(0.3, 0.6)));
            await sleep(rand(150, 400));
          }
        }

        const mode = Math.random();
        if (mode < 0.6) await microFidget();
        else if (mode < 0.8) await checkProgress();
        else await restPosition();
      } catch {
        // page closed, ignore
      }
    }
  }

  loop();
  return () => { running = false; };
}
