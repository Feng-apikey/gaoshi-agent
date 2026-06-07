import type { ToolDef } from "./types.ts";
import { exec } from "node:child_process";

export function createExecTool(): ToolDef[] {
  return [
    {
      name: "exec",
      description: "执行系统命令。用于 ffmpeg 视频处理、Python 脚本等。执行前会触发人工审核中断。",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          cwd: { type: "string", description: "工作目录，默认 data/" },
          timeout: { type: "number", description: "超时秒数，默认 60" },
        },
        required: ["command"],
      },
      execute: (args: any) => new Promise(resolve => {
        const timeout = (args.timeout ?? 60) * 1000;
        const child = exec(args.command, {
          cwd: args.cwd ?? undefined,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf-8",
        }, (error, stdout, stderr) => {
          if (error) {
            resolve({
              error: error.message,
              stdout: stdout.slice(0, 5000),
              stderr: stderr.slice(0, 5000),
              exitCode: error["code"] ?? -1,
            });
          } else {
            resolve({ stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 5000), exitCode: 0 });
          }
        });
      }),
    },
  ];
}
