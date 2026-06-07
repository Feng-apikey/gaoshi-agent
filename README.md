# 稿事 Gaoshi

本地 AI 内容创作引擎——给一个主题，自动搜资料、写稿、配图，一键推到小红书 / 抖音 / B站草稿箱。

**不是通用 chatbot。** 稿事专做内容创作与多平台分发，内置各平台排版规范、图片尺寸、字数限制，从写稿到出图到推送到草稿箱，一条龙完成。

技术栈：TypeScript · LangGraph Agent · MCP Protocol · Playwright · SQLite · Vue 3 · Hono · Vercel AI SDK

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | >= 18 | [官网](https://nodejs.org) 下载 LTS |
| **npm** | >= 9 | 随 Node.js 自带 |
| **Windows** | 10 / 11 | macOS 未测试 |

---

## 快速开始

### 第一步：克隆项目

```bash
git clone https://github.com/Feng-apikey/gaoshi-agent.git
cd gaoshi-agent
```

### 第二步：一键安装

```bash
npm run setup
```

这个命令自动完成以下 8 步：

1. 检查 Node.js 版本
2. 安装根目录依赖
3. 安装 UI 依赖（Vue 3 + Vite）
4. 下载 Playwright Chromium（浏览器自动化用）
5. 编译 MCP 服务（稿事内置工具）
6. 构建前端
7. 初始化运行时目录（`data/`、`cache/`）
8. 从模板初始化记忆文件

全程约 3-5 分钟，视网络情况而定。

### 第三步：启动

```bash
npm run dev
```

一个命令启动全部服务：

- **HTTP 服务** → `http://localhost:3919`
- **Provider 初始化** → 从 `config/providers.json` 加载内置模型列表（DeepSeek / MiniMax / MiMo / 智谱 / Kimi / 通义千问）
- **MCP 工具注册** → 自动连接 gaoshi-mcp（草稿/素材/文件管理）
- **数据库初始化** → SQLite 自动建表（drafts / materials / provider_config / model_routing / threads / publish_log）

> 前端开发用 `npm run dev:all`，额外启动 Vite 热更新在 `http://localhost:5173`。

### 第四步：开始创作

1. 浏览器打开 `http://localhost:3919`
2. 左侧边栏 → **设置** → 勾选模型提供商，填入 API Key
3. 支持的厂商及模型（详细见 `config/providers.json`）：
   - **DeepSeek** — `deepseek-v4-pro`、`deepseek-v4-flash`
   - **MiniMax** — `minimax-m3`（文本+视觉+视频）、`minimax-m2.7`（文本）、`image-01`（图片）、`speech-2.8-hd`（TTS）、`music-2.6`（音乐）
   - **智谱 GLM** — `glm-5.1`、`glm-5-turbo`、`glm-4.7`（文本）、`GLM-5V-Turbo`（视觉/视频）、`GLM-Image`（图片）
   - **Kimi** — `kimi-k2.6`（文本+视觉+视频）、`kimi-k2.5`（文本+视觉）
   - **通义千问** — `qwen3.7-max`、`qwen3.6-plus`（文本）、`qwen3.5-plus`（文本+视觉+视频）
   - **小米 MiMo** — `mimo-v2.5-pro`（文本+视觉）
   - **自定义** — 任意 OpenAI 兼容接口均可添加
4. 模型路由按能力自动选择：文本走文本模型、生图走图片模型、语音走 TTS 模型
5. 回到聊天，输入主题或粘贴素材，Agent 自动搜索、写稿、配图

---

## 支持平台

| 平台 | 内容类型 | 发布方式 | 登录方式 |
|------|----------|----------|----------|
| **抖音** | 图文、短视频、长文 | Publish 工具 → 草稿箱 | Edge 浏览器已登录 session |
| **小红书** | 图文笔记、视频笔记、长文 | Publish 工具 → 草稿箱 | Edge 浏览器已登录 session |
| **B站** | 动态、视频、专栏 | Publish 工具 → 草稿箱 | Edge 浏览器已登录 session |

各平台的字数限制、图片尺寸、宽高比、标签数量等规范内置在 `config/platform-limits.json`，Agent 写稿时自动遵守。

---

## 常见问题

### 3919 打不开 / 页面空白

`npm run setup` 必须完整跑完。确认控制台无报错，`npm run dev` 正在运行。

### 报 "draft_save" 或 MCP 工具不可用

MCP 编译失败，手动执行：

```bash
npm run build:mcp
```

- `tools/gaoshi-mcp/dist/server.js` — 稿事内置工具（草稿存取、素材管理、图片渲染）

### API 返回乱码 / 无响应 / 模型不回复

检查设置页：
- 是否勾选了至少一个模型提供商
- API Key 是否正确（注意不要有多余空格）
- Base URL 是否可访问（公司网络可能有防火墙）

### 发布不工作 / 浏览器连接失败

稿事通过 CDP 协议连接用户本地 Edge 浏览器进行发布操作。如遇连接失败：

1. 确认 Edge 已启动并开启了调试端口：`msedge --remote-debugging-port=9222`
2. 确认 Playwright 已安装：`npx playwright install chromium`
3. 确认各平台创作者中心在 Edge 中已手动登录过一次

---

## 项目结构

```
gaoshi-pure/
├── agent/                    # AI Agent 核心
│   ├── core.ts               # LangGraph 状态图：消息流转、token 估算、工具调用循环
│   ├── system-prompt.ts      # 系统提示词模板
│   ├── checkpoint.ts         # 对话检查点（LangGraph SQLiteCheckpoint）
│   ├── tools/                # Agent 工具注册
│   │   ├── index.ts          # 工具加载入口（原生 + MCP 合并）
│   │   ├── platform-tools.ts # 平台发布工具（publish 统一入口）
│   │   ├── mcp-loader.ts     # MCP 清单懒加载
│   │   ├── exec-tool.ts      # 通用工具执行器
│   │   ├── file-tools.ts     # 文件读写工具
│   │   ├── media-tools.ts    # 图片生成/视频处理工具
│   │   ├── web-tools.ts      # 网页搜索工具
│   │   ├── memory-tool.ts    # 记忆存取工具（memory_save / memory_search）
│   │   ├── skill-tool.ts     # 技能加载工具
│   │   ├── guide.ts          # 工具使用指南（动态分组）
│   │   └── types.ts          # ToolDef 类型定义
│   ├── providers/            # 模型提供商管理
│   │   ├── store.ts          # Provider 持久化存储（SQLite）
│   │   ├── router.ts         # 模型路由器：按 capability（text/vision/image/tts/music）自动选模型
│   │   └── presets.ts        # 内置厂商预设（从 config/providers.json 加载）
│   ├── memory/               # Agent 记忆系统
│   │   ├── manager.ts        # 记忆 CRUD + 索引重建
│   │   ├── indexer.ts        # 倒排索引构建 + 搜索
│   │   ├── retriever.ts      # 记忆检索（类型过滤 + 过期校验）
│   │   ├── summary.ts        # 系统 prompt 注入（用户画像 + 记忆索引）
│   │   ├── tokenizer.ts      # 中文 bigram + 英文分词
│   │   └── types.ts          # 类型定义 + 过期策略
│   └── skills/               # 技能加载器（从 skills/ 目录加载 Markdown 技能文件）
│       └── loader.ts
│
├── api/                      # HTTP 服务层（Hono）
│   ├── index.ts              # 服务入口：注册路由、静态文件、优雅关闭
│   ├── validation.ts         # 草稿平台限制校验
│   ├── routes/
│   │   ├── chat.ts           # POST /api/chat — 对话接口（SSE 流式 + LangGraph Agent）
│   │   ├── drafts.ts         # CRUD /api/drafts — 草稿管理（标题/正文/标签/封面/摘要）
│   │   ├── materials.ts      # CRUD /api/materials — 素材管理（图片/视频/音频/文档）
│   │   ├── upload.ts         # POST /api/upload — 文件上传 + AI 自动打标签
│   │   ├── providers.ts      # CRUD /api/providers — 模型提供商配置
│   │   ├── routing.ts        # CRUD /api/routing — 模型路由配置
│   │   └── settings.ts       # GET+PUT /api/settings — 全局设置
│   └── static/               # 前端构建产物（build 后自动填充）
│
├── ui/                       # 前端界面（Vue 3 + Vite）
│   ├── src/
│   │   ├── App.vue           # 根组件：侧边栏 + 路由视图
│   │   ├── main.ts           # 入口
│   │   ├── components/
│   │   │   ├── chat/         # 聊天面板（消息列表、输入框、流式渲染）
│   │   │   ├── drafts/       # 草稿管理（列表、编辑、推送状态）
│   │   │   ├── materials/    # 素材库（网格视图、上传、标签筛选）
│   │   │   ├── layout/       # 布局组件（侧边栏、顶部栏）
│   │   │   └── settings/     # 设置页（Provider 配置、模型路由、通用设置）
│   │   ├── stores/           # reactive() 状态管理
│   │   │   ├── chat.ts       # 对话状态（消息列表、流式响应、会话切换）
│   │   │   ├── drafts.ts     # 草稿状态
│   │   │   ├── materials.ts  # 素材状态
│   │   │   └── settings.ts   # 设置状态
│   │   ├── api/              # 前端 API 调用封装
│   │   └── types/            # TypeScript 类型定义
│   └── dist/                 # 构建输出（npm run build:ui）
│
├── storage/                  # 数据库层
│   ├── db.ts                 # SQLite 连接（better-sqlite3 + WAL 模式）
│   └── schema.ts             # Drizzle ORM 表定义（6 张表）
│       │                     #   drafts — 草稿（标题/正文/标签/平台/图片/视频/封面/发布状态）
│       │                     #   publish_log — 发布记录
│       │                     #   provider_config — 模型提供商
│       │                     #   model_routing — 模型路由（按 capability 选模型）
│       │                     #   threads — 对话线程
│       │                     #   materials — 素材库（路径/分类/尺寸/AI 标签/使用次数）
│
├── publish/                  # 平台发布引擎（CDP + 浏览器自动化）
│   ├── index.ts              # 发布路由（publish(platform, type, draft_id)）
│   ├── browser-manager.ts    # CDP 连接管理（复用 Edge session）
│   ├── douyin.ts             # 抖音发布（图文/视频/长文）
│   ├── bilibili.ts           # B站发布（动态/视频/专栏）
│   └── xiaohongshu.ts        # 小红书发布（图文/视频/长文）
│
├── tools/                    # MCP 服务
│   └── gaoshi-mcp/           # 稿事内置 MCP（TypeScript）
│       ├── server.ts         # MCP Server 入口（草稿/素材/渲染/文件）
│       └── tools.ts          # 工具实现（draft CRUD / material_save / render_card / file_read）
│
├── mcp/                      # MCP Client 管理层
│   ├── mcp-client.ts         # MCP Client 管理器（连接/重连/断开/工具调用）
│   └── servers.json          # MCP 服务配置（gaoshi-mcp）
│
├── memory/                   # Agent 运行时记忆（gitignore）
│   ├── gaoshi.md             # Agent 身份与行为规则（系统 prompt 加载）
│   ├── user-profile.md       # 用户画像 type=user（永不过期）
│   ├── projects/             # 项目记忆 type=project（90 天过期，按需创建）
│   ├── reference/            # 参考记忆 type=reference（60 天过期，按需创建）
│   ├── MEMORY.md             # 自动生成索引（按类型分组）
│   └── .templates/           # 记忆模板（git 跟踪，setup 时复制到 memory/）
│
├── skills/                   # 平台内容技能库（Markdown）
│   ├── 小红书.md / 抖音.md / B站.md / 超帧.md  # 平台创作规范
│   ├── xiaohongshu/ / douyin/ / bilibili/       # 平台子技能
│   └── hyperframes/ / hyperframes-cli/          # Hyperframes 技能
│
├── config/
│   ├── providers.json        # 内置模型厂商配置（DeepSeek / MiniMax / 智谱 / Kimi / 通义千问 / MiMo）
│   ├── providers.example.json # 配置模板（不含 API Key，git 跟踪）
│   ├── platform-limits.json  # 平台限制规则（字数/图片数/宽高比/标签数）
│   └── settings.json         # 全局设置
│
├── scripts/
│   ├── setup.ts              # 一键安装脚本
│   ├── dev-all.ts            # 开发模式启动（API + Vite 热更新）
│   ├── clean.ts              # 清理脚本
│   └── test-mcp-draft.mjs    # MCP 草稿测试脚本
│
├── .github/workflows/        # GitHub Actions CI（push 自动 typecheck + test）
│   └── ci.yml
├── CHANGELOG.md              # 变更日志
├── tests/                    # 测试（Vitest，20 个文件）
│   ├── agent-core.test.ts    # Agent 核心逻辑
│   ├── agent-tools.test.ts   # Agent 工具调用
│   ├── checkpoint.test.ts    # 对话检查点
│   ├── chat-logic.test.ts    # 对话逻辑
│   ├── drafts-materials.test.ts # 草稿与素材联动
│   ├── fixes.test.ts         # Bug 修复回归测试
│   ├── materials-core.test.ts   # 素材核心逻辑
│   ├── mcp-tools.test.ts     # MCP 工具测试
│   ├── memory.test.ts        # 记忆系统
│   ├── providers*.test.ts    # 模型提供商（含集成测试）
│   ├── routing.test.ts       # 模型路由
│   ├── settings.test.ts      # 设置
│   ├── skills.test.ts        # 技能加载
│   ├── truncation.test.ts    # 截断逻辑
│   ├── upload-logic.test.ts  # 上传逻辑
│   └── validation.test.ts    # 请求校验
│
├── data/                     # 用户数据目录（运行时生成）
│   ├── images/               # 图片素材
│   ├── videos/               # 视频素材
│   ├── audio/                # 音频素材
│   └── documents/            # 文档素材
│
├── formatters/               # 平台格式适配器
├── schemas/                  # JSON Schema 定义
├── cache/                    # MCP 清单缓存
├── resources/                # 资源文件
├── test-hyperframes/         # Hyperframes 集成测试
├── logo.ico / logo.png       # 应用图标
└── package.json              # 项目配置（v0.2.0）
```

---

## 工具一览

### 平台发布（Native Agent Tool）

`publish(platform, content_type, draft_id)` — 统一发布入口，支持三个平台 × 三种内容类型：

- **platform**: `抖音` / `B站` / `小红书`
- **content_type**: `image_text`（图文）/ `video`（视频）/ `article`（长文）
- **draft_id**: 由 `draft_save` 返回的草稿 ID

publish 内部通过 CDP 协议连接用户本地 Edge 浏览器，复用用户已登录 session，操作完成后内容进入平台草稿箱。

### 稿事内置 MCP（stdio）

**草稿：** `draft_save` / `draft_get` / `draft_list` / `draft_delete`
**素材：** `material_save` / `material_list` / `material_get` / `material_update` / `material_delete`
**文件：** `file_read` / `file_list`
**其他：** `render_card`（AI 配图）、`system_status`（系统状态）

---

## npm scripts

| 命令 | 说明 |
|------|------|
| `npm run setup` | 一键安装：依赖 + Chromium + MCP + UI |
| `npm run dev` | 启动服务（`http://localhost:3919`） |
| `npm run dev:all` | 启动服务 + Vite 热更新（`http://localhost:5173`） |
| `npm run build` | 生产构建（API + UI + MCP） |
| `npm run build:ui` | 仅构建前端 |
| `npm run build:mcp` | 仅编译 MCP 服务 |
| `npm run build:manifests` | 仅重建 MCP 清单 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run start` | 生产模式启动（`node dist/server.js`） |
| `npm run test` | 运行全部测试 |
| `npm run test:watch` | 测试监视模式 |
| `npm run clean` | 清理构建产物 |
| `npm run preclean` | 构建前自动清理 dist/ + release/ |

## 免责声明

本工具仅供学习研究使用。使用者须自行承担以下风险：

- **仅发布到草稿箱**：所有发布工具仅将内容保存到草稿箱，不会直接公开发布。请在 App 或网页端人工审核后再手动发布。请勿使用任何声称可直接公开发布的第三方工具。
- **合规使用**：请遵守平台规则和当地法律法规，不得用于发布违法违规内容、垃圾广告或批量营销。

作者不对因使用本工具导致的任何账号损失或法律后果承担责任。

## 致谢

skills/ 目录中部分平台创作规范参考了社区开源项目。

## 未来方向

- [x] TS 版小红书 MCP 与 B站 MCP
- [x] 接入 Hyperframes
- [ ] 更多可选 Provider
- [ ] 发布 → 反馈 → 优化数据闭环（post metrics 追踪、agent 自适应调优）
- [ ] 自主 subagent 调度：遇并行任务或内容审核时自动 spawn 子 agent 分工执行，需发散思考时自主开启多 agent debate

## License

MIT
