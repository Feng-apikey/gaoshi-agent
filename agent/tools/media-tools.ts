import type { ToolDef } from "./types.ts";
import { getModel, resolveModel } from "../providers/router.ts";
import { getProvider } from "../providers/store.ts";
import { generateText } from "ai";
import { stripReasoning } from "../core.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as os from "node:os";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { extToMime } from "../../storage/media-types.ts";
import { getDB } from "../../storage/db.ts";
import { materials } from "../../storage/schema.ts";

// ── MiniMax native API client ──

async function minimaxPost(endpoint: string, data: Record<string, unknown>): Promise<any> {
  const provider = getProvider("minimax");
  if (!provider) throw new Error("MiniMax provider not configured");

  const url = `${provider.baseURL.replace(/\/v1\/?$/, "")}${endpoint}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`MiniMax API error ${resp.status}: ${errBody}`);
  }
  return resp.json();
}

// ── Video frame extraction ──

function extractFrames(videoPath: string): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(os.tmpdir(), `gaoshi_frames_${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const ff = spawn("ffmpeg", [
      "-i", videoPath, "-vf", "fps=1/5", "-vframes", "6", "-f", "image2",
      path.join(tmpDir, "frame_%02d.jpg"),
    ], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    let stderr = "";
    ff.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const bufs: Buffer[] = [];
    ff.on("close", (code) => {
      try {
        for (const f of fs.readdirSync(tmpDir).sort()) bufs.push(fs.readFileSync(path.join(tmpDir, f)));
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      if (code !== 0 || bufs.length === 0) {
        reject(new Error(`ffmpeg 退出码 ${code}，提取到 ${bufs.length} 帧${stderr ? ' — ' + stderr.slice(0, 200) : ''}`));
      } else {
        resolve(bufs);
      }
    });
    ff.on("error", (err) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      reject(new Error(`ffmpeg 未找到或无法启动: ${err.message}`));
    });
  });
}

export function createMediaTools(): ToolDef[] {
  return [
    // ── Image analysis ──

    {
      name: "analyze_image",
      description: "使用视觉模型分析图片内容。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "图片文件路径" },
          question: { type: "string", description: "问题，留空返回通用描述" },
        },
        required: ["path"],
      },
      execute: async (args: any) => {
        if (!fs.existsSync(args.path)) return { error: "文件不存在" };
        const buffer = fs.readFileSync(args.path);
        const ext = path.extname(args.path).toLowerCase();
        const mime = extToMime(ext);

        try {
          const model = getModel("vision");
          const { text } = await generateText({
            model,
            maxTokens: 32768,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: args.question ?? "详细描述这张图片的内容、风格和特点。" },
                { type: "image", image: buffer.toString("base64"), mimeType: mime },
              ],
            }],
          });
          return { description: stripReasoning(text) };
        } catch (err: any) {
          if (err.message?.includes("vision") || err.message?.includes("视觉")) {
            return { error: "当前提供商不支持图片理解能力，请在设置中添加支持 vision 的提供商（如智谱 GLM-4V-Plus、Moonshot kimi-k2.6 或通义 qwen-vl-max）" };
          }
          return { error: err.message };
        }
      },
    },

    // ── Video analysis ──

    {
      name: "analyze_video",
      description: "使用视觉模型分析视频内容。提取关键帧、场景、运镜、色调等信息。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "视频文件路径" },
          question: { type: "string", description: "分析问题，留空返回通用描述" },
        },
        required: ["path"],
      },
      execute: async (args: any) => {
        if (!fs.existsSync(args.path)) return { error: "文件不存在" };
        const buffer = fs.readFileSync(args.path);
        const ext = path.extname(args.path).toLowerCase();
        const mime = extToMime(ext);
        if (!mime.startsWith("video/")) return { error: `不支持的视频格式: ${ext}` };
        const question = args.question ?? "详细分析这段视频的内容、场景、运镜方式和视觉风格。";

        // 1. Try video-native model
        try {
          const route = resolveModel("video");
          const provider = getProvider(route.providerId);

          // MiniMax M3: native multimodal, direct API call to bypass AI SDK file-part limitation
          if (provider?.id === "minimax") {
            const videoB64 = buffer.toString("base64");
            const result = await minimaxPost("/v1/chat/completions", {
              model: route.model || "minimax-m3",
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: question },
                  { type: "video_url", video_url: { url: `data:${mime};base64,${videoB64}` } },
                ],
              }],
              max_tokens: 4096,
            });
            const reply = result?.choices?.[0]?.message?.content ?? "";
            return { description: stripReasoning(reply), method: "video-native" };
          }

          // Other providers: try via AI SDK
          const model = getModel("video");
          const { text } = await generateText({ model, maxTokens: 32768, messages: [{ role: "user", content: [
            { type: "text", text: question },
            { type: "file", data: buffer.toString("base64"), mimeType: mime },
          ]}] });
          return { description: stripReasoning(text), method: "video-native" };
        } catch {}

        // 2. Fallback: ffmpeg key frames → vision model
        try {
          const model = getModel("vision");
          const frames = await extractFrames(args.path);
          if (!frames.length) return { error: "无法提取视频帧，请安装 ffmpeg" };

          const imageParts = frames.map(f => ({ type: "image" as const, image: f.toString("base64"), mimeType: "image/jpeg" as const }));
          const { text } = await generateText({ model, maxTokens: 32768, messages: [{ role: "user", content: [
            { type: "text", text: `这是从视频中提取的 ${frames.length} 个关键帧（按时间顺序）。${question}` },
            ...imageParts,
          ]}] });
          return { description: stripReasoning(text), method: "frame-extraction", frameCount: frames.length };
        } catch (err: any) {
          if (err.message?.includes("vision") || err.message?.includes("视频") || err.message?.includes("video")) {
            return { error: "当前提供商不支持视频/图片理解能力，请在设置中添加支持 vision 的提供商" };
          }
          return { error: "视频分析不可用：没有 video 模型且帧提取失败", detail: err.message };
        }
      },
    },

    // ── Image generation (MiniMax native API) ──

    {
      name: "generate_image",
      description: "使用 AI 生成图片。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "图片描述" },
          aspectRatio: { type: "string", description: "宽高比：1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16" },
        },
        required: ["prompt"],
      },
      execute: async (args: any) => {
        try {
          const route = resolveModel("image");
          const provider = getProvider(route.providerId);

          if (provider?.id === "minimax") {
            const result = await minimaxPost("/v1/image_generation", {
              model: route.model || "image-01",
              prompt: args.prompt,
              aspect_ratio: args.aspectRatio || "1:1",
              n: 1,
              prompt_optimizer: true,
            });
            const imageUrls: string[] = result?.data?.image_urls ?? [];
            if (!imageUrls.length) return { error: "未生成图片" };

            // Download → save to data/images/ as a managed material (DB row + content hash)
            const imgResp = await fetch(imageUrls[0]);
            const imgBuf = Buffer.from(await imgResp.arrayBuffer());

            const id = randomBytes(8).toString("hex");
            const imagesDir = path.join(process.cwd(), "data", "images");
            fs.mkdirSync(imagesDir, { recursive: true });
            const filePath = path.join(imagesDir, `${id}.png`);
            fs.writeFileSync(filePath, imgBuf);

            const contentHash = createHash("sha256").update(imgBuf).digest("hex");

            try {
              const db = getDB();
              db.insert(materials).values({
                id,
                name: `${id}.png`,
                path: filePath,
                category: "image",
                mimeType: "image/png",
                size: imgBuf.length,
                width: 0,
                height: 0,
                tags: "[]",
                description: "",
                generatedBy: `${route.providerId}/${route.model || "image-01"}`,
                useCount: 0,
                contentHash,
                createdAt: new Date().toISOString(),
              }).run();
            } catch (err: any) {
              // Don't fail the whole tool if DB insert fails — caller still gets the file path
              return { success: true, id, path: filePath, url: imageUrls[0], prompt: args.prompt, warning: `DB insert failed: ${err.message}` };
            }

            return { success: true, id, path: filePath, url: imageUrls[0], prompt: args.prompt };
          }

          return { status: "not_wired", hint: `生图能力已配置 ${route.model}，但该提供商暂未对接原生 API。` };
        } catch (err: any) {
          return { error: err.message, hint: "请检查模型路由设置中的 image 能力配置" };
        }
      },
    },

    // ── Text to speech (MiniMax native API) ──

    {
      name: "text_to_speech",
      description: "文本转语音。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要转换的文本" },
          voice: { type: "string", description: "音色 ID，默认 male-qn-qingse" },
          speed: { type: "number", description: "语速 0.5-2.0，默认 1.0" },
        },
        required: ["text"],
      },
      execute: async (args: any) => {
        try {
          const route = resolveModel("tts");
          const provider = getProvider(route.providerId);

          if (provider?.id === "minimax") {
            const result = await minimaxPost("/v1/t2a_v2", {
              model: route.model || "speech-2.8-hd",
              text: args.text.slice(0, 10000),
              voice_setting: {
                voice_id: args.voice || "male-qn-qingse",
                speed: args.speed || 1.0,
                vol: 1.0,
                pitch: 0,
              },
              audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: "mp3",
                channel: 1,
              },
            });

            // MiniMax returns audio data in response
            const audioData = result?.data?.audio || result?.audio || result?.extra_info?.audio;
            if (!audioData) return { error: "未返回音频数据", raw: JSON.stringify(result).slice(0, 200) };

            // Try hex first (MiniMax default), fall back to base64
            let audioBuf: Buffer;
            if (/^[0-9a-fA-F]+$/.test(audioData)) {
              audioBuf = Buffer.from(audioData, "hex");
            } else {
              audioBuf = Buffer.from(audioData, "base64");
            }
            const outPath = path.join(os.tmpdir(), `gaoshi_tts_${Date.now()}.mp3`);
            fs.writeFileSync(outPath, audioBuf);

            return { success: true, path: outPath, format: "mp3", text: args.text.slice(0, 50) + "..." };
          }

          return { status: "not_wired", hint: `TTS 能力已配置 ${route.model}，但该提供商暂未对接原生 API。` };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },

    // ── Music generation (MiniMax native API) ──

    {
      name: "generate_music",
      description: "使用 AI 生成音乐/配乐。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "音乐风格/情绪/场景描述" },
          lyrics: { type: "string", description: "歌词，支持 [Intro][Verse][Chorus] 标记" },
        },
        required: ["prompt"],
      },
      execute: async (args: any) => {
        try {
          const route = resolveModel("music");
          const provider = getProvider(route.providerId);

          if (provider?.id === "minimax") {
            const result = await minimaxPost("/v1/music_generation", {
              model: route.model || "music-2.6",
              prompt: args.prompt,
              lyrics: args.lyrics || "",
            });

            const audioData = result?.data?.audio;
            if (!audioData) return { error: "未返回音乐文件", raw: JSON.stringify(result).slice(0, 200) };

            // Music API returns hex-encoded MP3, same format as TTS
            let audioBuf: Buffer;
            if (/^[0-9a-fA-F]+$/.test(audioData)) {
              audioBuf = Buffer.from(audioData, "hex");
            } else {
              audioBuf = Buffer.from(audioData, "base64");
            }
            const outPath = path.join(os.tmpdir(), `gaoshi_music_${Date.now()}.mp3`);
            fs.writeFileSync(outPath, audioBuf);

            return { success: true, path: outPath, prompt: args.prompt };
          }

          return { status: "not_wired", hint: `音乐生成能力已配置 ${route.model}，但该提供商暂未对接原生 API。` };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },
  ];
}
