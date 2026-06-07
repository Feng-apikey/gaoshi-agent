# Changelog

## v0.2.0 (2026-06-03)

### Added
- bilibili-mcp (TS 重写，替代 Python 版)
- xiaohongshu-mcp (新建)
- GitHub Actions CI：push 自动跑 typecheck + test
- typecheck 脚本 (`npm run typecheck`)

### Fixed
- MCP 客户端重连 + 子进程泄漏修复 (`mcp/mcp-client.ts`)
- Range 头 NaN 校验 + fd 泄漏修复 (`api/routes/upload.ts`)
- GET 大文件流式传输 (`api/routes/upload.ts`)
- Agent 缓存 LRU 淘汰修正 (`api/routes/chat.ts`)
- Markdown 渲染器 5 个语法恢复 (`ui/src/components/chat/MessageBubble.vue`)
- marked 全局污染 → 独立实例
- SSE decoder 未 flush 修复 (`ui/src/api/chat.ts`)
- material_save 同名 ID 碰撞 (`tools/gaoshi-mcp/server.ts`)
- drafts PATCH tags 类型校验 (`api/routes/drafts.ts`)
- Ctrl+V 粘贴图片上传 (`ui/src/components/chat/ChatInput.vue`)

### Changed
- 登录/发布分离：loginState + fastLoginCheck + post-nav redirect（三平台统一）
- douyin/xhs/bilibili publish.ts 编码损坏修复
- XHS login 阈值 >=2 → >=3
- mcp/servers.json：bilibili + xhs 切换到 stdio TS 版
- SVG 从上传白名单移除
