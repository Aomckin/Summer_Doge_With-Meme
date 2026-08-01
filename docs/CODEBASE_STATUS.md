# Meme Vault 代码现状速览

> 更新基线：v0.5.1 实现状态（2026-08-02）。本文描述已经落地的代码，不是下一阶段需求。

## 当前能力

- 本地 Meme 库：单图 API、固定入口的串行批量上传、缩略图、全局重复图片检测、搜索、标签筛选、随机查看、编辑、删除与分页加载。
- 复合 Meme：一个 Meme 包含一张或多张按零基 `position` 排序的图片；第一张是封面。
- 图片管理：向已有 Meme 追加单图、删除非最后图片、HTML 拖拽排序；完整删除会清理整组图片文件。
- 桌面优先的原生 TypeScript 前端：瀑布流封面卡片、图片数量角标、纵向图片组详情、可前后切换的原图查看器，以及明确的忙碌/错误状态。
- 手动弱关联：完整 Meme 之间建立双向、直接且不传递的边；支持搜索、多选批量添加和单条移除。
- Template 系统：网页 CRUD、Meme 手动归类、单张参考图、管理界面双侧缩略图预览、原子创建、独立图像向量模型和 Top-10 视觉候选。
- AI 组级分析：一次请求按顺序读取完整图片组，生成一条中文建议标题、一份中文描述、2 至 8 个标签建议和一个已有模板 ID 或 `null`；用户确认后才写入所选内容，建议标题默认不采用。
- 网页内 API 设置：维护 AI 提供商、图片分析模型和独立的模板视觉检索模型；密钥加密落盘。
- 文案实验室：每个 Meme 可保存多条独立文案；详情页支持统一编辑器、场景/语气/长度、复制、编辑、删除、未保存提醒，以及 AI 临时生成和草稿改写。

## 明确尚未实现

- 尚未实现聊天场景推荐 Meme、语义搜索、Meme 制作器、用户系统、分享权限或云端对象存储。
- 弱关联没有方向、原因、分组、强弱类型、传递推断或 AI 自动创建。
- 批量上传仍逐张复用单图 API，每个文件创建独立 Meme；不提供后端批量接口，也不在上传时组成复合 Meme。

## 技术结构

```text
app/
  api/             FastAPI 路由与 HTTP 错误转换
  services/        业务编排与事务控制（核心是 MemeService）
  repositories/    SQLAlchemy 查询与 flush
  models/          Meme、MemeImage、MemeRelation、Caption、Template、Tag、AI 设置/分析
  schemas/         Pydantic 请求与响应模型
  storage/         Meme 与模板参考图的本地原图/缩略图存储
  ai/              Responses、兼容 Chat、图像向量、预设与密钥处理
frontend/
  src/app.ts       页面状态与交互编排
  src/batch-upload.ts 批量上传对话框、文件队列与串行流程
  src/caption-lab.ts 文案编辑、已保存列表、AI 候选与脏状态
  src/ui.ts        DOM 渲染、对话框、图片组和原图查看器
  src/settings.ts  API 设置子界面
  src/api.ts       集中式 API 客户端
  src/types.ts     前端类型和 AppState
tests/             Pytest；前端测试位于 frontend/src/*.test.ts
```

后端采用 FastAPI + SQLAlchemy + SQLite + Pillow；前端采用 Vite + 原生 TypeScript + Vitest/jsdom，不使用 React、Vue 或 UI 组件库。

## 数据与迁移

### Meme 图片组

- `memes` 保存标题、描述、来源、模板归属、时间和兼容封面投影。
- `meme_images` 保存每张图片的文件元数据、全局唯一 SHA-256、`meme_id`、`position` 和创建时间。
- `(meme_id, position)` 唯一；`Meme.images` 按 position 升序加载并使用 delete-orphan 级联。
- 封面不是独立字段：position 最小的图片就是封面；排序或删除后由 `MemeService._sync_cover()` 同步旧 `memes` 图片列。
- 原图位于 `data/images/`，缩略图位于 `data/thumbnails/`；公开响应只暴露 `/media/...` URL。

SQLite 启动时先由 ORM 创建新表，再以 `INSERT ... SELECT ... WHERE NOT EXISTS` 为没有图片记录的旧 Meme 回填一张 position=0 的 `MemeImage`。回填复制旧元数据，不移动磁盘文件；重复启动不会重复写入。非 SQLite 数据库不执行 SQLite 专用迁移 SQL。

每个 SQLite DBAPI 连接都会执行 `PRAGMA foreign_keys=ON`，因此模型声明的父记录校验与 `ON DELETE` 动作会由数据库实际执行，而不是只依赖 ORM 调用顺序。

### 直接弱关联

`meme_relations` 只保存规范化无向边：较小 ID 写入 `meme_a_id`，较大 ID 写入 `meme_b_id`。唯一约束禁止重复边，check 约束禁止自身边。查询只返回与当前 Meme 直接相连的另一端，不计算传递闭包。

### 标签、模板与 AI

- `tags` 与 `meme_tags` 保存标签及用户/AI 来源。
- `templates` 与 Meme 一对多；模板可有一张参考图和可选图像向量。
- 新建含参考图模板通过单次事务完成文件保存、独立图片向量化和模板写入；任一步失败都会回滚记录并清理新文件。
- `qwen3-vl-embedding` 请求只发送 Base64 Data URI，独立图片模式不启用融合，接受单个 `type=image` 或 `type=vl` 向量；旧 `tongyi-embedding-vision` 保持兼容。通用 `embed_multimodal` 为后续 Meme 融合向量保留独立入口。
- `meme_ai_analyses` 保存一条完整 Meme 对应的一次组级建议快照；`suggested_title` 可空以兼容升级前的历史分析。
- `ai_providers`、`ai_models` 保存提供商、图片分析模型和独立图像向量模型设置。
- API Key 使用 Fernet 加密；密钥默认位于被忽略的 `data/.ai_settings.key`。

### Caption

- `captions` 通过 `meme_id` 归属单个 Meme，包含正文、可空场景/语气/长度、`manual`/`ai` 来源及创建/更新时间。
- 正文去除首尾空白且最长 2000 字；场景和语气最长 100 字；长度仅允许 `short`、`medium`、`long`。
- `Meme.captions` 使用 delete-orphan，外键同时声明 `ON DELETE CASCADE`。删除 Meme 会级联删除 Caption。
- AI 候选和完整提示词不入库；编辑已保存 Caption 时不允许修改来源。

## 主要调用链

### 创建、追加、排序与删除图片

```text
POST /api/memes
  -> MemeService.create_meme
  -> ImageStorage.save
  -> 创建 Meme + position=0 的 MemeImage
  -> 单事务提交

POST /api/memes/{id}/images
  -> MemeService.append_image
  -> 保存文件 -> 追加到末尾 -> 提交
  -> 数据库失败时回滚并删除新文件

PATCH /api/memes/{id}/images/order
  -> 校验提交 ID 恰好等于当前完整集合
  -> 临时负 position -> 最终 position
  -> 同步封面投影 -> 单事务提交

DELETE /api/memes/{id}/images/{image_id}
  -> 拒绝最后一张
  -> 删除关联对象 -> 临时负 position -> 连续重编号 -> 同步封面
  -> 提交后删除该原图与缩略图
```

完整删除 Meme 会先记住全部图片引用，删除所有直接关系并提交 ORM 级联，再逐一清理原图和缩略图。读取详情和 AI 分析前会检查整组文件，而不只检查封面。

### 浏览器图片组与关系交互

- 瀑布流每个 Meme 只渲染封面；多图显示数量角标。
- 详情页按 `images` 顺序纵向渲染，并标识封面。
- 追加、删除和排序操作期间禁用冲突控件；失败在图片管理区就地显示。
- 原图查看器从被点击的索引打开，按钮和左右方向键不会越过首尾；关闭会清空查看器状态。
- 选择 Meme 后异步加载直接关系并清除旧关系，避免闪现上一条 Meme 的数据。
- 添加关系使用独立对话框，在当前已加载资料库中按标题/描述筛选，排除自身和已关联项，可一次提交多个 ID。
- Meme 编辑成功后使用 `updateMeme` 返回值原地替换 `state.memes` 中对应索引、`selectedMeme`、详情和对应瀑布流卡片，不调用 `listMemes` 重载第一页。
- 编辑保持已加载数量、顺序、`offset`、`hasMore`、滚动位置及其他卡片节点不变；标签变化时只刷新标签筛选列表。

### 浏览器批量上传

- 顶部“图片上传”打开统一的单图/多图上传对话框；页面其他区域不接收拖拽文件。
- 选择或拖入的图片按添加顺序进入队列，标题默认取去掉最后一个扩展名的文件名并允许上传前逐项修改，描述为空。
- 标签、模板和来源是整批公共信息；开始后文件列表和公共字段锁定。
- `BatchUploadController` 逐项等待现有 `uploadMeme`，单项失败后继续；HTTP 409 稳定映射为 `skipped`，不解析错误文本。
- “停止上传”只设置暂停标志，当前请求完成后保留剩余 `pending`；继续上传沿用原顺序。“重试失败项”只把 `failed` 重置为 `pending`。
- 队列无失败时显示统计、自动关闭并刷新 Meme、标签和模板；存在失败时保留具体原因与重试入口。

### AI 有序多图分析

```text
POST /api/memes/{meme_id}/analyze
  -> MemeService.analyze_meme
  -> 按 position 读取全部 MemeImage 原图
  -> AIClient.analyze_images
  -> Responses/Chat payload 按顺序附带“第 N 张”与图片
  -> 生成一条建议标题及一份组级描述、标签和模板判断
  -> 保存一条 MemeAIAnalysis，不修改 Meme
```

分析快照的建议标题通过 `suggested_title` 返回。确认请求的 `apply_title` 默认为 `false`，只有用户显式勾选后才会在同一事务中更新 Meme 标题；历史快照没有建议标题时仍可继续使用描述、标签和模板确认。未配置模型/密钥返回 503，超时返回 504，上游或结构化输出错误返回 502。

### 文案实验室与 AI 文案

```text
GET/POST/PATCH/DELETE /api/memes/{meme_id}/captions...
  -> CaptionService
  -> CaptionRepository
  -> captions

POST .../captions/generate 或 .../rewrite
  -> CaptionService 按 position 读取全部 MemeImage
  -> 当前激活 AIClient 的 Responses/Chat 实现
  -> 去空白、去重并校验候选数量
  -> 只返回前端，不写数据库
```

`CaptionLabController` 独立维护当前 Meme 的列表、草稿快照、编辑状态、候选、错误和请求代次。`app.ts` 仅在选择 Meme 时调用 `setMeme`；详情重绘后由挂载事件恢复实验室。切换 Meme 会中止列表请求并通过代次忽略已经返回的旧列表或 AI 结果。非空脏草稿在新建、切换、折叠和离开页面前确认；临时候选本身不触发确认。

## v0.5 API

- `POST /api/memes/{meme_id}/images`
- `PATCH /api/memes/{meme_id}/images/order`
- `DELETE /api/memes/{meme_id}/images/{image_id}`
- `GET /api/memes/{meme_id}/relations`
- `POST /api/memes/{meme_id}/relations`
- `DELETE /api/memes/{meme_id}/relations/{related_meme_id}`
- `GET /api/memes/{meme_id}/captions`
- `POST /api/memes/{meme_id}/captions`
- `PATCH /api/memes/{meme_id}/captions/{caption_id}`
- `DELETE /api/memes/{meme_id}/captions/{caption_id}`
- `POST /api/memes/{meme_id}/captions/generate`
- `POST /api/memes/{meme_id}/captions/rewrite`
- `POST /api/templates/with-reference-image`

所有 Meme 响应包含有序 `images` 与 `image_count`；旧 `image_url`、`thumbnail_url`、尺寸、哈希等字段直接从 `images[0]` 派生并继续对应首图。

## 启动与验证

```powershell
# 后端
python -m uvicorn app.main:app --reload --port 8000

# 前端开发
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run dev

# 完整验证
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m pytest -q
git diff --check
```

v0.5.1 发布验证基线：前端 66 项测试通过，后端 133 项测试通过，TypeScript 类型检查和 Vite 生产构建通过。

Vite 默认把 `/api` 和 `/media` 代理到 `http://127.0.0.1:8000`。修改前端源码后必须重新构建，FastAPI 托管的生产页面才会更新。

## 下一阶段

下一阶段为 v0.6 语义搜索与向量化；聊天场景推荐 Meme 在向量化完成后于 v0.6.1 实现，Meme 制作器顺延至 v0.7。
