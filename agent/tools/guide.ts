import type { ToolDef } from "./types.ts";

/**
 * Generate a compact tools usage guide for system prompt injection.
 */
export function buildToolsGuide(tools: ToolDef[]): string {
  const groups: Record<string, ToolDef[]> = {
    "内容发布": [],
    "内容管理": [],
    "文件操作": [],
    "网页搜索": [],
    "媒体处理": [],
    "系统操作": [],
    "记忆管理": [],
    "技能": [],
    "其他": [],
  };

  for (const t of tools) {
    const n = t.name;
    if (n === "publish") {
      groups["内容发布"].push(t);
    } else if (n.startsWith("file_") || n.startsWith("draft_")) {
      groups["内容管理"].push(t);
    } else if (n.startsWith("web_")) {
      groups["网页搜索"].push(t);
    } else if (n.startsWith("memory_")) {
      groups["记忆管理"].push(t);
    } else if (n === "exec") {
      groups["系统操作"].push(t);
    } else if (n.startsWith("analyze_") || n === "generate_image" || n === "generate_music" ||
               n === "text_to_speech" || n === "generate_video") {
      groups["媒体处理"].push(t);
    } else if (n.startsWith("skill_")) {
      groups["技能"].push(t);
    } else {
      groups["其他"].push(t);
    }
  }

  const lines: string[] = [];

  // Platform tools first — most important
  const platformOrder = ["内容发布", "内容管理"];
  for (const g of platformOrder) {
    const groupTools = groups[g];
    if (!groupTools?.length) continue;
    lines.push(`### ${g}`);
    for (const t of groupTools) {
      const desc = (t.description || t.name || "").slice(0, 70);
      lines.push(`- \`${t.name}\` — ${desc}`);
    }
    lines.push("");
  }

  // Rest
  for (const [group, groupTools] of Object.entries(groups)) {
    if (platformOrder.includes(group)) continue;
    if (!groupTools.length) continue;
    lines.push(`### ${group}`);
    for (const t of groupTools) {
      const desc = (t.description || t.name || "").slice(0, 70);
      lines.push(`- \`${t.name}\` — ${desc}`);
    }
    lines.push("");
  }

  lines.push("## 使用原则");
  lines.push("- 发布内容使用 publish 工具，platform 和 content_type 从草稿记录中获取");
  lines.push("- publish 是串行操作、会占用浏览器，多平台分发必须逐个调用，一个完成再下一个");
  lines.push("- publish 发布到的是平台草稿箱，不是直接公开");
  lines.push("- 发布前建议通过 skill_load 加载对应平台的内容创作技能");
  lines.push("- 搜索网页获取实时信息，不要凭记忆编造");
  lines.push("- exec 执行前会暂停等待用户审批");

  return lines.join("\n");
}
