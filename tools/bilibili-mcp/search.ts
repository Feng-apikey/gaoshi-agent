import type { Page } from "playwright";
import { SEARCH_URL, SELECTORS, TIMEOUT, DELAY } from "./constants.ts";
import { sleep } from "./humanize.ts";

export async function searchVideos(page: Page, keyword: string, count: number = 10, order: string = "totalrank"): Promise<Array<{ title: string; bvid: string; url: string; author: string; play?: string; danmaku?: string }>> {
  const results: Array<{ title: string; bvid: string; url: string; author: string; play?: string; danmaku?: string }> = [];

  const orderParam = order === "click" ? "click" : order === "pubdate" ? "pubdate" : order === "dm" ? "dm" : "totalrank";
  const searchUrl = `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&order=${orderParam}&duration=0&tids=0`;

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.POST_SEARCH);

  try {
    const cardSelectors = [
      '[class*="video-list"] > [class*="video-item"]',
      '[class*="search-result"] > *',
      '[class*="card-list"] > [class*="card"]',
      '[class*="bili-video-card"]',
      '[class*="video-card"]',
    ];
    let cards = page.locator(cardSelectors[0]);
    for (const sel of cardSelectors) {
      const c = page.locator(sel);
      const cnt = await c.count().catch(() => 0);
      if (cnt > 0) { cards = c; break; }
    }

    const n = Math.min(count, 20);
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      if (!(await card.isVisible({ timeout: TIMEOUT.TAG_SUGGESTION }).catch(() => false))) break;

      const title = await card.locator('[class*="title"], [class*="desc"], a[title]').first().innerText().catch(() => "");
      const author = await card.locator('[class*="author"], [class*="up-name"]').first().innerText().catch(() => "");
      const play = await card.locator('[class*="play"], [class*="view"]').first().innerText().catch(() => "");
      const danmaku = await card.locator('[class*="danmaku"], [class*="dm"]').first().innerText().catch(() => "");
      const link = await card.locator("a").first().getAttribute("href").catch(() => "") ?? "";

      const bvidMatch = link.match(/\/video\/(BV[a-zA-Z0-9]+)/);
      const bvid = bvidMatch?.[1] ?? "";
      const fullUrl = link.startsWith("http") ? link : `https:${link}`;

      if (title) results.push({
        title: title.replace(/<[^>]+>/g, ""),
        bvid,
        url: fullUrl,
        author,
        play,
        danmaku,
      });
    }
  } catch {}

  return results;
}