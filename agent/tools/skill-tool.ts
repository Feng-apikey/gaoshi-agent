import type { ToolDef } from "./types.ts";
import { searchSkills, loadSkill } from "../skills/loader.ts";

export function createSkillTool(): ToolDef[] {
  return [
    {
      name: "skill_load",
      description: "加载一个创作技能。用于获取平台特定的内容创作技巧、格式要求、工具建议等。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "技能名称" },
        },
        required: ["name"],
      },
      execute: async (args: any) => {
        const content = loadSkill(args.name);
        if (!content) return { error: `技能 "${args.name}" 不存在` };
        return { content };
      },
    },
    {
      name: "skill_search",
      description: "搜索可用技能。返回匹配的技能名称和描述。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          topK: { type: "number", description: "返回数量，默认 5" },
        },
        required: ["query"],
      },
      execute: async (args: any) => {
        const results = searchSkills(args.query, args.topK ?? 5);
        return { results };
      },
    },
  ];
}
