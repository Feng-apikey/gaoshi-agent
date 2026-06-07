import type { Page } from "playwright";
import { clearStorageState } from "./cookies.ts";
import { CREATOR_URL, MARKERS, TIMEOUT, DELAY } from "./constants.ts";
import { sleep } from "./humanize.ts";

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!url.includes("creator.xiaohongshu.com")) {
      await page.goto(CREATOR_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
      await sleep(DELAY.AFTER_NAV);
    }
    const bodyText = await page.locator("body").innerText({ timeout: TIMEOUT.BODY_TEXT }).catch(() => "");
    if (!bodyText) return false;
    if (MARKERS.LOGGED_IN.filter(m => bodyText.includes(m)).length >= 3) return true;
    for (const txt of MARKERS.LOGIN_PAGE) { if (bodyText.includes(txt)) return false; }
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/signin")) return false;
    return false;
  } catch {
    return false;
  }
}

export async function getLoginQrcode(page: Page): Promise<{ message: string }> {
  const url = page.url();
  const alreadyOnLogin = url.includes("/login") || url.includes("/signin");
  if (!alreadyOnLogin) {
    await page.goto(CREATOR_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT.PAGE_LOAD });
    await sleep(DELAY.AFTER_NAV);
  }
  return { message: "浏览器已打开小红书创作者平台登录页面，请在浏览器窗口中扫码" };
}

export async function waitForLogin(page: Page, timeoutMs: number = TIMEOUT.DEFAULT_LOGIN_WAIT): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(TIMEOUT.LOGIN_POLL_INTERVAL);
    const bodyText = await page.locator("body").innerText({ timeout: TIMEOUT.ELEMENT_VISIBLE }).catch(() => "");
    if (!bodyText) continue;
    if (MARKERS.LOGGED_IN.filter(m => bodyText.includes(m)).length >= 3) return true;
    const url = page.url();
    if (!url.includes("/login") && !url.includes("/signin") && MARKERS.LOGGED_IN.some(m => bodyText.includes(m))) return true;
  }
  return false;
}

export async function logout(page: Page): Promise<void> {
  clearStorageState();
  try { await page.goto("about:blank"); } catch {}
}
