import type { Page } from "playwright";

export function rand(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number): number { return Math.random() * (max - min) + min; }
export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Mouse position tracker ──
// Playwright doesn't expose current mouse position, so we track it ourselves.
let _mouseX = 400 + rand(-50, 50);
let _mouseY = 300 + rand(-50, 50);

export function resetMousePosition(): void {
  _mouseX = 400 + rand(-50, 50);
  _mouseY = 300 + rand(-50, 50);
}

// ── Bezier curve mouse movement ──
// Generates a curved path from (x0,y0) to (x1,y1) with a random control point,
// then moves the mouse along it step-by-step with variable speed.

function bezierQuad(t: number, p0: number, cp: number, p1: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * cp + t * t * p1;
}

export async function humanMouseMove(page: Page, toX: number, toY: number): Promise<void> {
  const fromX = _mouseX;
  const fromY = _mouseY;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Very short distance �?just move directly
  if (dist < 5) {
    await page.mouse.move(toX, toY);
    _mouseX = toX;
    _mouseY = toY;
    return;
  }

  // Step count proportional to distance, with some randomness
  const baseSteps = Math.max(8, Math.min(50, Math.round(dist / 10)));
  const steps = baseSteps + rand(-3, 5);

  // Random control point �?offset perpendicular to the line of travel
  // This creates the natural curve of human hand movement
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const curvature = randFloat(-0.3, 0.3) * dist; // 30% of distance as max offset
  const cpX = midX + perpX * curvature + randFloat(-20, 20);
  const cpY = midY + perpY * curvature + randFloat(-20, 20);

  // Small chance of overshoot (10%)
  const doOvershoot = Math.random() < 0.1;
  const finalX = doOvershoot ? toX + rand(-8, 8) : toX;
  const finalY = doOvershoot ? toY + rand(-8, 8) : toY;

  // Move along the Bezier curve
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Ease-in-out: slower at start and end, faster in the middle
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.round(bezierQuad(eased, fromX, cpX, finalX));
    const y = Math.round(bezierQuad(eased, fromY, cpY, finalY));
    await page.mouse.move(x, y);

    // Variable delay: slower at start/end, faster in middle
    const speed = t < 0.2 || t > 0.8 ? rand(2, 6) : rand(1, 3);
    await sleep(speed);
  }

  // If overshot, correct back to target
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

export async function humanMoveTo(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  try {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width * randFloat(0.3, 0.7);
      const targetY = box.y + box.height * randFloat(0.3, 0.7);
      await humanMouseMove(page, targetX, targetY);
    } else {
      const vp = page.viewportSize();
      const tx = (vp?.width ?? 800) * randFloat(0.3, 0.7);
      const ty = (vp?.height ?? 600) * randFloat(0.3, 0.7);
      await humanMouseMove(page, tx, ty);
    }
  } catch {}
}

export async function humanClick(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  await humanMoveTo(page, locator);
  // Natural pause before clicking (reaction time)
  await sleep(rand(50, 200));
  await locator.click();
}

export async function humanPause(minMs = 200, maxMs = 1500): Promise<void> {
  await sleep(rand(minMs, maxMs));
}
