import type { ToolDef } from "./types.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const SEARXNG_URL = "http://localhost:8888/search";
const SEARCH_TIMEOUT = 15000;

export function stripHtml(html: string, maxChars: number): string {
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
        const resp = await fetch(args.url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(SEARCH_TIMEOUT),
        }).catch(() => null);
        if (!resp?.ok) return { error: `HTTP ${resp?.status ?? "fetch failed"}` };
        return { url: args.url, content: stripHtml(await resp.text(), maxChars) };
      },
    },
    {
      name: "web_search",
      description: "搜索网页。通过 SearXNG（本地聚合必应+百度）搜索，返回标题、链接和摘要。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          count: { type: "number", description: "返回数量，默认 10，最大 20" },
        },
        required: ["query"],
      },
      execute: async (args: any) => {
        const query = encodeURIComponent(args.query);
        const count = Math.min(args.count ?? 10, 20);

        // 1. SearXNG (local, free, Bing + Baidu)
        try {
          const resp = await fetch(
            `${SEARXNG_URL}?q=${query}&format=json&categories=general&pageno=1`,
            { signal: AbortSignal.timeout(SEARCH_TIMEOUT) },
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            const results = (data.results ?? []).slice(0, count).map((r: any) => ({
              title: r.title ?? "",
              url: r.url ?? "",
              snippet: r.content ?? "",
            }));
            return { query: args.query, results };
          }
        } catch {}

        // 2. Bing API fallback
        const apiKey = process.env.BING_API_KEY;
        if (apiKey) {
          const resp = await fetch(
            `https://api.bing.microsoft.com/v7.0/search?q=${query}&count=${count}&mkt=zh-CN`,
            {
              headers: { "Ocp-Apim-Subscription-Key": apiKey },
              signal: AbortSignal.timeout(SEARCH_TIMEOUT),
            },
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

        return { error: "搜索暂不可用，请确认 SearXNG 已启动或 BING_API_KEY 已设置" };
      },
    },
  ];
}
