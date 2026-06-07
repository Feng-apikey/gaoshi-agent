import type { ToolDef } from "./types.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDB } from "../../storage/db.ts";
import { materials } from "../../storage/schema.ts";
import { eq } from "drizzle-orm";

const DATA_DIR = path.join(process.cwd(), "data");

function safePath(subpath: string): string {
  const resolved = path.resolve(DATA_DIR);
  const full = path.resolve(DATA_DIR, subpath);
  if (full !== resolved && !full.startsWith(resolved + path.sep)) throw new Error("路径越界");
  return full;
}

function syncMaterialForDeletedFile(filePath: string): void {
  try {
    const db = getDB();
    const absPath = path.resolve(DATA_DIR, filePath);
    const m = db.select().from(materials).where(eq(materials.path, absPath)).get() as any;
    if (m) db.delete(materials).where(eq(materials.id, m.id)).run();
  } catch {}
}

export function createFileTools(): ToolDef[] {
  return [
    {
      name: "file_read",
      description: "读取 data/ 目录内的文件内容。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于 data/ 的文件路径" },
          encoding: { type: "string", description: "编码，默认 utf-8" },
        },
        required: ["path"],
      },
      execute: async (args: any) => {
        const p = safePath(args.path);
        if (!fs.existsSync(p)) return { error: "文件不存在" };
        const content = fs.readFileSync(p, args.encoding ?? "utf-8");
        return { content: (content as string).slice(0, 50000), path: args.path };
      },
    },
    {
      name: "file_write",
      description: "写入文件到 data/ 目录。父目录不存在则自动创建。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于 data/ 的文件路径" },
          content: { type: "string", description: "文件内容" },
        },
        required: ["path", "content"],
      },
      execute: async (args: any) => {
        const p = safePath(args.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, args.content, "utf-8");
        return { written: true, path: args.path, size: args.content.length };
      },
    },
    {
      name: "file_move",
      description: "移动或重命名 data/ 目录内的文件。",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "源路径（相对 data/）" },
          to: { type: "string", description: "目标路径（相对 data/）" },
        },
        required: ["from", "to"],
      },
      execute: async (args: any) => {
        const src = safePath(args.from);
        const dst = safePath(args.to);
        if (!fs.existsSync(src)) return { error: "源文件不存在" };
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
        return { moved: true, from: args.from, to: args.to };
      },
    },
    {
      name: "file_delete",
      description: "删除 data/ 目录内的文件。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于 data/ 的文件路径" },
        },
        required: ["path"],
      },
      execute: async (args: any) => {
        const p = safePath(args.path);
        if (!fs.existsSync(p)) return { error: "文件不存在" };
        fs.unlinkSync(p);
        syncMaterialForDeletedFile(args.path);
        return { deleted: true, path: args.path };
      },
    },
    {
      name: "file_list",
      description: "列出 data/ 目录内的文件和子目录。",
      inputSchema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "子目录，留空为根目录" },
        },
      },
      execute: async (args: any) => {
        const dir = safePath(args.dir ?? ".");
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).map(name => {
          const stat = fs.statSync(path.join(dir, name));
          return { name, isDirectory: stat.isDirectory(), size: stat.size };
        });
      },
    },
  ];
}
