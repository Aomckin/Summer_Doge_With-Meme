# Meme Vault 代码现状速览

> 更新基线：v0.3.3 实现状态。本文用于后续对话快速恢复上下文；它描述的是**已经落地的代码**，不是下一阶段需求。

## 当前能力

- 本地 Meme 库：上传、缩略图、重复图片检测、搜索、标签筛选、随机查看、编辑、删除与分页加载。
- 桌面优先的原生 TypeScript 前端：瀑布流卡片、右侧详情面板、原图查看器、标签收纳/展开和窄窗口不溢出。
- Template 基础系统：网页可创建、查看、编辑和删除模板；Meme 可在上传或编辑时手动归类到一个已有模板。
- AI 图片分析：对已上传 Meme 生成中文描述、2 至 8 个标签建议，以及一个已有模板 ID 或 `null`；用户确认后才写入标签、可选描述和模板决定。
- 网页内 API 设置：维护 AI 提供商、模型和当前视觉模型；内置 OpenAI、Qwen、DeepSeek 与自定义 OpenAI 兼容接口预设。

## 明确尚未实现

- 尚未实现模板图片、AI 文案实验室、语义搜索、Meme 制作器、用户系统或云端存储。

## 技术结构

```text
app/
  api/             FastAPI 路由与 HTTP 错误转换
  services/        业务编排、事务控制（核心是 MemeService）
  repositories/    SQLAlchemy 查询与 flush
  models/          Meme、Template、Tag、MemeAIAnalysis、AIProvider、AIModel
  schemas/         Pydantic 请求/响应模型
  storage/         本地原图和缩略图读写、校验、哈希
  ai/              OpenAI Responses 与 OpenAI 兼容 Chat 客户端、预设、密钥处理
frontend/
  src/app.ts       页面状态与交互编排
  src/ui.ts        DOM 渲染、对话框、原图查看器
  src/settings.ts  API 设置子界面控制器
  src/api.ts       集中式 API 客户端
  src/types.ts     前端类型和 AppState
tests/             Pytest；前端测试位于 frontend/src/*.test.ts
```

后端采用 FastAPI + SQLAlchemy + SQLite + Pillow；前端采用 Vite + 原生 TypeScript + Vitest/jsdom，不使用 React、Vue 或 UI 组件库。

## 数据与存储

### Meme 与标签

`memes` 保存标题、描述、来源、文件元数据、SHA-256、尺寸和时间；图片二进制不进数据库。

- 原图：`data/images/`
- 缩略图：`data/thumbnails/`，PNG，最大 400 × 400
- 数据库：默认 `data/meme_vault.db`
- 支持：JPEG、PNG、WEBP、GIF；文件上限 10 MiB
- 标签：`tags` 与 `meme_tags` 多对多关联；前端多选标签表示“同时包含全部标签”。
- 模板：`templates` 与 Meme 为一对多；`memes.template_id` 可空，删除模板时应用层显式清空归属。

这些运行数据及 API 密钥文件均被 Git 忽略。

### AI 设置与分析记录

- `ai_providers`：名称、协议、基础 URL、超时、重试和加密后的 API Key。
- `ai_models`：提供商模型标识、是否支持视觉、启用状态、当前激活状态。
- `meme_ai_analyses`：模型名、AI 描述、标签建议 JSON、可空模板建议快照、创建/确认时间。
- API Key 使用 Fernet 加密，密钥默认保存在被忽略的 `data/.ai_settings.key`；也可由 `AI_SETTINGS_ENCRYPTION_KEY` 提供。

## 主要调用链

### 上传与媒体

```text
POST /api/memes
  -> MemeService.create_meme
  -> ImageStorage.save（格式/大小校验、哈希、原图、缩略图）
  -> MemeRepository + TagRepository + TemplateRepository
  -> 单次事务提交
```

数据库写入失败时会回滚并删除刚保存的图片文件。对外响应只暴露 `/media/images/...` 与 `/media/thumbnails/...`，不会返回服务器文件路径。

### 浏览、筛选与详情

```text
浏览器 AppState
  -> frontend/src/api.ts
  -> GET /api/memes、GET /api/tags、GET /api/memes/random
  -> MemeService -> Repository
```

- 初始并行加载标签、模板和首批 24 个 Meme。
- 搜索 300 ms 防抖；搜索或标签变化时会中止旧列表请求并重置分页。
- 宽屏瀑布流在全宽工作区下最多使用 7 列；右侧详情贴近视口右侧。
- 标签超过 8 个时收纳，已选中而被收纳的标签仍保持可见。
- 原图查看器使用原生 `dialog`，失败图片不会污染下一次查看状态。

### AI 分析（已实现）

```text
POST /api/memes/{meme_id}/analyze
  -> MemeService.analyze_meme
  -> 读取原图 + 现有标签 + 最多 200 个已有模板
  -> AIClient（OpenAI Responses 或 OpenAI 兼容 Chat）
  -> 规范化 2~8 个标签并校验 template_id 属于候选集合或为 null
  -> 保存 MemeAIAnalysis（不修改 Meme.template_id）
  -> 仅返回建议

POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm
  -> 校验用户选择必须来自该次建议
  -> 追加 AI 标签；按用户选择写入描述和最终模板
  -> 标签、描述、模板与 confirmed_at 在同一事务提交
```

AI 默认输出简体中文标签；固定外语梗、常用专有表达或外语更准确时可以保留外语。分析失败不修改 Meme；未配置模型/密钥返回 503，超时 504，上游或结构化输出错误 502。

AI 不能创建或命名 Template，只能返回后端本次提供的已有 `template_id` 或 `null`。用户可拒绝建议、改选其他当前存在的模板或清除归类。

## Template 与旧数据库兼容

- `GET/POST /api/templates` 与 `GET/PATCH/DELETE /api/templates/{id}` 提供完整 CRUD。
- 删除 Template 时，同一事务清空相关 `Meme.template_id` 和历史 `MemeAIAnalysis.suggested_template_id`，不删除 Meme 或分析记录。
- 新数据库由 ORM 创建完整外键；旧 SQLite 启动时幂等添加 `memes.template_id` 与 `meme_ai_analyses.suggested_template_id`，不重建表、不丢数据。
- 非 SQLite 数据库不执行 SQLite 专用迁移 SQL。

## API 设置

入口在前端顶部工具栏“API 设置”。设置界面支持：

- 新增、编辑、删除提供商；测试 `/models` 连接；刷新模型列表。
- 新增、编辑、删除模型；只有启用且支持视觉的模型可设为当前分析模型。
- OpenAI 使用 Responses API；Qwen、DeepSeek 和自定义提供商使用 OpenAI 兼容 Chat Completions。

当数据库未配置有效视觉模型时，服务仍兼容 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL` 与 `AI_TIMEOUT_SECONDS` 环境变量。

## 启动与验证

```powershell
# 后端开发服务
python -m uvicorn app.main:app --reload --port 8002

# 前端开发服务
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run dev

# 生产构建与验证
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m pytest -q
```

FastAPI 仅在 `frontend/dist/index.html` 存在时，在最后挂载 `/` 托管静态前端；`/api`、`/media`、`/docs` 优先于根挂载。

## 配置注意事项

- Vite 使用 `BACKEND_TARGET` 代理 `/api` 与 `/media`；当前代码默认值是 `http://127.0.0.1:8000`。
- README 的开发示例使用后端端口 `8002`。本地以 8002 启动时，应在 `frontend/.env` 设置 `BACKEND_TARGET=http://127.0.0.1:8002`；这是当前文档与 Vite 默认值之间已知的不一致，后续维护时应统一。
- `frontend/dist/` 被忽略。修改前端后必须执行构建，FastAPI 托管页面才会更新。

## 后续开发建议

下一阶段可进入 v0.4 Meme 文案实验室。模板图片、语义搜索、Meme 制作器、用户系统和云端存储仍未实现，不应视为 v0.3.3 能力。
