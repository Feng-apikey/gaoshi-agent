import type { ToolDef } from "./types.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function stripHtml(html: string, maxChars: number): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, "\n")
    .trim()
    .slice(0, maxChars);
}

export function createWebTools(): ToolDef[] {
  return [
    {
      name: "web_fetch",
      description: "获取网页内容。返回页面文本（HTML 标签已移除）。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "网页 URL" },
          maxChars: { type: "number", description: "最大返回字符数，默认 8000" },
        },
        required: ["url"],
      },
      execute: async (args: any) => {
        const maxChars = args.maxChars ?? 8000;
        const resp = await fetch(args.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (!resp?.ok) return { error: `HTTP ${resp?.status ?? "fetch failed"}` };
        return { url: args.url, content: stripHtml(await resp.text(), maxChars) };
      },
    },
    {
      name: "web_search",
      description: "搜索网页。优先用 BING_API_KEY，无 key 则抓取 Bing 搜索结果页。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          count: { type: "number", description: "返回数量，默认 10" },
        },
        required: ["query"],
      },
      execute: async (args: any) => {
        const query = encodeURIComponent(args.query);
        const count = args.count ?? 10;

        // Try API first
        const apiKey = process.env.BING_API_KEY;
        if (apiKey) {
          const resp = await fetch(
            `https://api.bing.microsoft.com/v7.0/search?q=${query}&count=${count}&mkt=zh-CN`,
            { headers: { "Ocp-Apim-Subscription-Key": apiKey } },
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            return {
              query: args.query,
              results: (data.webPages?.value ?? []).map((r: any) => ({
                title: r.name, url: r.url, snippet: r.snippet,
              })),
            };
          }
        }

        // Fallback: scrape Bing China search results
        const resp = await fetch(`https://cn.bing.com/search?q=${query}&count=${count}`, {
          headers: { "User-Agent": UA, "Accept-Language": "zh-CN" },
          signal: AbortSignal.timeout(15000),
        }).catch(() => null);
        if (!resp?.ok) return { error: "搜索失败" };

        const html = await resp.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const links = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) ?? [];
        for (const link of links.slice(0, count)) {
          const href = link.match(/href="(https?:\/\/[^"]+)"/i)?.[1];
          const text = link.replace(/<[^>]+>/g, "").trim();
          if (href && text && !href.includes("bing.com") && !href.includes("microsoft.com")) {
            results.push({ title: text.slice(0, 100), url: href, snippet: "" });
          }
        }
        return { query: args.query, results: results.slice(0, count) };
      },
    },
  ];
}
