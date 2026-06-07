import type { Page } from "playwright";
import { SEARCH_URL, SELECTORS, TIMEOUT, DELAY } from "./constants.ts";
import { sleep } from "./humanize.ts";

export async function searchFeeds(
  page: Page,
  keyword: string,
  sortBy: string = "general",
  noteType: string = "all"
): Promise<Array<{ title: string; url: string; author: string; likes?: string }>> {
  const results: Array<{ title: string; url: string; author: string; likes?: string }> = [];

  const searchUrl = `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
  await sleep(DELAY.AFTER_NAV);
  await sleep(DELAY.POST_SEARCH);

  if (sortBy !== "general") {
    try {
      const sortLabels: Record<string, string> = {
        most_popular: "最热",
        most_forwarded: "最多转发",
        latest: "最新",
      };
      const label = sortLabels[sortBy];
      if (label) {
        const sortBtn = page.locator(`text=${label}`).first();
        if (await sortBtn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false)) {
          await sortBtn.click();
          await sleep(DELAY.POST_SEARCH);
        }
      }
    } catch {}
  }

  if (noteType !== "all") {
    try {
      const typeLabels: Record<string, string> = {
        video: "视频",
        note: "图文",
      };
      const label = typeLabels[noteType];
      if (label) {
        const typeBtn = page.locator(`text=${label}`).first();
        if (await typeBtn.isVisible({ timeout: TIMEOUT.ELEMENT_QUICK }).catch(() => false)) {
          await typeBtn.click();
          await sleep(DELAY.POST_SEARCH);
        }
      }
    } catch {}
  }

  try {
    const cardSelectors = [
      '[class*="note-item"]',
      '[class*="feed-item"]',
      '[class*="search-result"] > *',
      '[class*="result"] [class*="card"]',
      '[class*="list"] > [class*="item"]',
      'section[class*="note"]',
    ];

    let cards = page.locator(cardSelectors[0]);
    for (const sel of cardSelectors) {
      const c = page.locator(sel);
      if (await c.count().then(n => n > 0).catch(() => false)) { cards = c; break; }
    }

    const n = Math.min(20, await cards.count().catch(() => 0));
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      if (!(await card.isVisible({ timeout: TIMEOUT.TAG_SUGGESTION }).catch(() => false))) break;

      const title = await card.locator('[class*="title"], [class*="desc"], [class*="name"], a').first().innerText().catch(() => "");
      const author = await card.locator('[class*="author"], [class*="user"], [class*="creator"]').first().innerText().catch(() => "");
      const likes = await card.locator('[class*="like"], [class*="count"], [class*="collect"]').first().innerText().catch(() => "");
      const link = (await card.locator("a").first().getAttribute("href").catch(() => "")) ?? "";

      if (title) results.push({ title, url: link.startsWith("http") ? link : `https://www.xiaohongshu.com${link}`, author, likes });
    }
  } catch {}

  return results;
}