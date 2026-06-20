import type { ToolDef } from "./types.ts";
import { publish } from "../../publish/index.ts";

export function createPlatformTools(): ToolDef[] {
  return [
    {
      name: "publish",
      description:
        "发布草稿到指定平台的草稿箱。串行操作，同一时间只能发布一个平台，多平台分发需逐个调用。" +
        "调用前请先通过 skill_load 加载对应平台的内容创作技能获取格式规范。" +
        "会自动检查登录状态，未登录会提示用户手动登录。发布后内容进入平台草稿箱，不会直接公开。" +
        "发布期间浏览器会被占用，请勿同时进行其他浏览器操作。",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            description: "目标平台：抖音、B站、小红书。需与草稿中 platform 字段一致。",
            enum: ["抖音", "B站", "小红书"],
          },
          content_type: {
            type: "string",
            description: "内容类型：image_text（图文，抖音/小红书）、dynamic（动态，B站图文）、video（视频）、article（长文）",
            enum: ["image_text", "dynamic", "video", "article"],
          },
          draft_id: { type: "string", description: "草稿 ID，由 draft_save 返回" },
        },
        required: ["platform", "content_type", "draft_id"],
      },
      execute: async (args: any) => {
        try {
          const result = await publish(args.platform, args.content_type, args.draft_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (e: any) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: e.message }) }],
            isError: true,
          };
        }
      },
    },
  ];
}
