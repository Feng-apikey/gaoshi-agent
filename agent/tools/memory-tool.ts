import type { ToolDef } from "./types.ts";
import { createRetriever } from "../memory/retriever.ts";
import { save } from "../memory/manager.ts";
import type { MemoryType } from "../memory/types.ts";

const retriever = createRetriever();

export function createMemoryTool(): ToolDef[] {
  return [
    {
      name: "memory_search",
      description: "搜索本地记忆库。用于查找项目上下文、外部引用等之前保存的信息。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          type: { type: "string", description: "记忆类型：project/reference" },
          topK: { type: "number", description: "返回数量，默认 5" },
        },
        required: ["query"],
      },
      execute: async (args: any) => {
        const results = retriever.retrieve(args.query ?? "", {
          type: args.type as MemoryType | undefined,
          topK: args.topK ?? 5,
        });
        return {
          query: args.query,
          results: results.map(r => ({
            name: r.entry.name,
            type: r.entry.type,
            description: r.entry.description,
            snippet: r.snippet,
            score: r.score,
          })),
        };
      },
    },
    {
      name: "memory_save",
      description: "保存一条记忆。用于记住用户偏好、项目信息等，以便后续检索。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "记忆名称（kebab-case）" },
          description: { type: "string", description: "一句话摘要" },
          type: { type: "string", description: "类型：user/project/reference" },
          content: { type: "string", description: "记忆内容（Markdown）" },
        },
        required: ["name", "description", "type", "content"],
      },
      execute: async (args: any) => {
        // Enforce single user profile — ignore LLM's name for user type
        const name = args.type === "user" ? "user-profile" : args.name;
        save({
          name,
          description: args.description,
          type: args.type as MemoryType,
          content: args.content,
          updatedAt: new Date().toISOString(),
        });
        return { saved: true, name };
      },
    },
  ];
}
