# Meme Vault 代码现状速览

> 更新基线：v1.0.0 Phase 1 UX Debt Cleanup 与 Vault Inspector Upgrade（2026-08-18）。本文描述已经落地的代码，不是下一阶段需求。

## 当前能力

- Tag 使用显示名 + `normalized_name` 双字段；大小写不敏感去重但保留 UI 大小写，使用中的 Tag 可事务性强制删除并令受影响语义数据过期。
- 主资料库支持 `#4496`、`Meme 4496` 等 ID 精确跳转和 24/48/96 分页。
- 动态 Template Selector 共享实时子串搜索；主资料库模板筛选也可即时搜索。
- 宝库巡检支持全库或 ID Range Source Set、全局 SemanticIndex 候选、左右直接删除、Ignore、弱关联和 Merge。
- GIF 复制会尝试将原始 `image/gif` 写入剪贴板；浏览器不支持时明确提示下载，不会转 PNG 冒充动画。

- 本地 Meme 库：原图/复合图片组下载、持久化批量 ZIP 导出、单图 API、普通串行批量上传、持久化 ZIP 批量导入、缩略图、全局重复图片检测、搜索、标签筛选、随机查看、编辑、删除与正式分页浏览。
- 复合 Meme：一个 Meme 包含一张或多张按零基 `position` 排序的图片；第一张是封面。
- 图片管理：向已有 Meme 追加单图、删除非最后图片、HTML 拖拽排序；完整删除会清理整组图片文件。
- 桌面优先的原生 TypeScript 前端：超大/大/中/小响应式瀑布流封面卡片、图片数量角标、纵向图片组详情、可前后切换的原图查看器，以及明确的忙碌/错误状态；超大档使用原图，其余档使用缩略图。
- 主资料库通过 `GET /api/memes/page` 只读取当前页，支持 24/48/96 每页数量、完整总数、越界收敛和基于 Meme ID/seed 的稳定乱序；模板管理器在完整模板数组上每页渲染 12 条。
- 多模态语义索引：标题、描述、规范化标签、模板和前 5 张有序图片由集中构建器生成一个 1024 维融合向量，归一化后以小端 Float32 BLOB 保存在 SQLite。
- 自然语言搜索：查询向量调用当前 `qwen3-vl-embedding`，标签在排序前按 AND 过滤；当前模型兼容的 ready 文档向量由进程内 NumPy 矩阵计算余弦 score，翻页复用 10 分钟 LRU 结果。
- 聊天场景推荐：独立输入最近聊天内容和可选回应意图，服务端构造 Scene Query 后复用现有语义搜索；默认每批 12 条，后续批次保持原语义排名，前端支持详情、原图查看器和下载。
- 快速取用：单图 Meme 在资料卡、详情、场景推荐和牌组中可直接复制或下载；Viewer 始终复制当前图片。PNG 原样写入系统剪贴板，JPEG/WebP 保持原尺寸转换为 PNG，GIF 明确引导使用下载。
- 宝库巡检：以最多 1000 个 Meme ID 范围为源，在整个当前 SemanticIndex 内寻找 Top K 近似 Pair；只读已有兼容 ready 向量，支持阈值、去重、Ignore 和缺失统计，不调用 Provider。
- 复合 Meme 合并：显式 Source → Target，单事务迁移有序图片、标签、Caption 和弱关联；Target 元数据与首图保留，Source 删除，物理图片文件不复制、不移动、不删除。
- 相似 Meme：完全使用已保存的同模型、同维度融合向量，不调用 Provider；前端与人工直接关联分区展示。
- 持久化 EmbeddingJob：任务创建时快照 Meme 与 source hash；一个协调线程管理最多 8 个只读/外部请求线程，所有 SQLite 结果由协调线程顺序写入。
- 手动弱关联：完整 Meme 之间建立双向、直接且不传递的边；支持搜索、多选批量添加和单条移除。
- Template 系统：网页 CRUD、Meme 手动归类、单张参考图、管理界面双侧缩略图预览、原子创建、独立图像向量模型和 Top-10 视觉候选。
- Meme 制作器：在 Template/Local 底图、最多 20 个自由文本框和完整文字/输出能力之上，支持最多 30 个 PNG/JPEG/WEBP 图片层；可多选文件导入、拖放、剪贴板粘贴、从底图创建，独立移动/Resize/Crop/Fit/Fill/透明度/替换/排序，并进入 50 步 Undo/Redo。PNG Preview/Export/Save 共用同一 Renderer；无后端渲染或 AI 调用。
- AI 元数据整理：网页单项、Provider 批量 Job 与 Luna 离线候选统一写入 `MemeEnrichmentSuggestion`；Luna 导入直接进入人工审核池，不再经过 dry-run/CLI apply；建议创建和拒绝不修改 Meme，网页审核可按字段安全采用并写审计。
- 持久化 EnrichmentJob：支持全部、当前筛选、缺描述/标签/模板、文件名标题、从未分析和过期建议范围；1/2/4/8 并发、取消、失败重试、启动中断恢复和 Token 统计。
- 网页内 API 设置：维护 AI 提供商、图片分析模型和独立的模板视觉检索模型；密钥加密落盘。
- 文案实验室：每个 Meme 可保存多条独立文案；详情页支持统一编辑器、场景/语气/长度、复制、编辑、删除、未保存提醒，以及 AI 临时生成和草稿改写。
- Codex 离线元数据维护：默认每批 20、可选 10/20/50，导出完整有序图片组、当前元数据、标签和模板词典；新格式显式导入只创建统一 Suggestion，不直接修改 Meme。
- 标签管理：聚合统计每个标签的 Meme 使用数，主资料库默认隐藏零引用标签；独立管理器支持搜索、排序、重命名、按来源优先级合并、删除单个空标签和二次确认清理全部空标签。
- 标签芯片输入：Meme 编辑、普通批量上传和 ZIP 导入共用可访问的数组编辑器，支持键盘确认/取消、去重、删除和最多 8 条使用中标签自动补全；提交前仍由 API 客户端统一规范化。
- Mobile Ingest：`/mobile` 提供独立、手机竖屏优先的轻量多图投喂页；逐文件复用 `uploadMeme` 与 `POST /api/memes`，显示选中文件、逐项进度、成功/失败统计和失败文件名，并支持连续上传两轮。
- External Meme API：可信局域网消费者可通过 `GET /api/memes/random` 随机取用可用 Meme，通过 `GET /api/memes/semantic?q=...&limit=1` 复用现有语义索引并从本地 Top 5 可用候选中随机取一张，再通过 `GET /api/memes/{id}/image` 按真实 MIME 获取原始封面；响应只暴露相对 URL，不暴露磁盘路径。

## 明确尚未实现

- 尚未实现自动聊天记录解析、聊天平台接入、统一自由图层、图片与文字交叉排序、旋转/蒙版/滤镜、GIF 制作、用户系统、分享权限或云端对象存储。
- 弱关联没有方向、原因、分组、强弱类型、传递推断或 AI 自动创建。
- ZIP 导入逐项创建独立 Meme，不组成复合 Meme；批量导出查询后端完整范围，不依赖前端分页。
- 巡检不提供自动判断、全库后台 Job、聚类、像素差异、Merge Undo 或 Ignore 管理器；语义相似度不等于重复概率。

### 原图下载与批量导出

- `GET /api/memes/{id}/download` 对单图返回原图，对复合 Meme 返回按 position 排序的 ZIP 和 manifest；指定 image 下载会校验归属。
- 普通下载与导出复用 `download_names.py`，清理路径穿越、控制字符、危险字符、Windows 保留名和同名 ZIP 条目。
- `ExportJob`/`ExportJobItem` 独立于导入任务，支持 all/filtered、flat/template/tag、进度、取消、失败明细、下载、删除、中断和过期状态。
- `MemeRepository.list_all_for_export` 复用列表的关键词与多标签 AND 语义，但没有 offset/limit。
- 导出使用单线程执行器、`ZIP_STORED`、Zip64、`.part` 与原子 rename；图片磁盘读取期间不持有长数据库事务。
- ready ZIP 保留 24 小时；启动、创建和读取任务时清理过期文件。tag 模式按全部标签复制，创建前按复制次数估算并保留 512 MiB 安全空间。
- 前端 `batch-download.ts` 独立维护范围、组织方式、轮询、恢复、失败分页、取消、直接 ZIP 下载和删除；关闭弹窗停止轮询但不取消后端。

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
  src/meme-actions.ts 图片复制能力检测、读取、转换、剪贴板写入与轻反馈
  src/meme-maker.ts 模板加载、编辑状态、Preview 调度、PNG 导出与上传编排
  src/meme-maker-interaction.ts 坐标换算、顶层命中、pointer 拖动与左右 resize 状态机
  src/meme-image-layer.ts 图片层数据模型、Frame/Crop 几何、Fit/Fill 与命中测试
  src/meme-renderer.ts 文本框换行、测量、bounds、绘制和共享 Canvas 渲染
  src/pagination.ts 共享页码限制与紧凑页码 token 逻辑
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
- `GET /api/tags` 使用 `LEFT OUTER JOIN + COUNT + GROUP BY` 一次返回 `usage_count`，默认 `HAVING count > 0`；管理器通过 `include_empty=true` 查看全部标签，不执行逐标签 COUNT。
- `TagService` 拥有重命名、合并、空标签删除和清理事务；合并先删除同 Meme 的冲突源关联，再迁移剩余复合主键，来源优先级为 `user/manual > codex > ai`。
- 零引用标签不会在启动、Meme 编辑或 Meme 删除时自动清理；只有显式删除/清理管理接口会删除 Tag 本体。
- `templates` 与 Meme 一对多；模板可有一张参考图和可选图像向量。
- 新建含参考图模板通过单次事务完成文件保存、独立图片向量化和模板写入；任一步失败都会回滚记录并清理新文件。
- `qwen3-vl-embedding` 请求只发送 Base64 Data URI，独立图片模式不启用融合，接受单个 `type=image` 或 `type=vl` 向量；旧 `tongyi-embedding-vision` 保持兼容。通用 `embed_multimodal` 为后续 Meme 融合向量保留独立入口。
- `meme_ai_analyses` 保存一条完整 Meme 对应的一次组级建议快照；`suggested_title` 可空以兼容升级前的历史分析。
- `meme_enrichment_suggestions` 保存 Luna/Provider/手动导入的标题、描述、标签增删和已有模板建议、生成来源、模型快照、字段置信度、状态、稳定 source hash 与审核时间；历史保留，旧 pending 可标记 superseded。
- `enrichment_jobs` / `enrichment_job_items` 保存批量范围、分析字段、模型快照、并发、计数、Token、失败明细和 Suggestion 关联；`enrichment_audits` 保存创建、拒绝和 Apply 的字段及前后快照。
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

- `reloadMemes()` 调用 `listMemePage` 并用响应直接替换当前页；请求使用 AbortController 与控制器身份检查，过期响应不能覆盖新页。
- 搜索、标签、每页数量和排序变化回到第一页；随机排序的 seed 在翻页和筛选时保持，重新洗牌才替换。每页数量与卡片大小分别持久化到 localStorage。
- 分页栏始终保留首尾页和当前页附近数字，中间缺口使用省略号；服务端返回的有效页码是前端最终状态依据。

- 瀑布流每个 Meme 只渲染封面；多图显示数量角标。
- 详情页按 `images` 顺序纵向渲染，并标识封面。
- 追加、删除和排序操作期间禁用冲突控件；失败在图片管理区就地显示。
- 原图查看器从被点击的索引打开，按钮和左右方向键不会越过首尾；关闭会清空查看器状态。
- 选择 Meme 后异步加载直接关系并清除旧关系，避免闪现上一条 Meme 的数据。
- 添加关系使用独立对话框，在当前已加载资料库中按标题/描述筛选，排除自身和已关联项，可一次提交多个 ID。
- Meme 编辑成功后使用 `updateMeme` 返回值原地替换 `state.memes` 中对应索引、`selectedMeme`、详情和对应瀑布流卡片，不调用 `listMemes` 重载第一页。
- 编辑保持当前页数量、顺序、页码、滚动位置及其他卡片节点不变；标签变化时继续同步标签筛选列表。

### 浏览器批量上传

- 顶部“图片上传”打开统一的单图/多图上传对话框；页面其他区域不接收拖拽文件。
- 选择或拖入的图片按添加顺序进入队列，标题默认取去掉最后一个扩展名的文件名并允许上传前逐项修改，描述为空。
- 标签、模板和来源是整批公共信息；开始后文件列表和公共字段锁定。
- `BatchUploadController` 逐项等待现有 `uploadMeme`，单项失败后继续；HTTP 409 稳定映射为 `skipped`，不解析错误文本。
- “停止上传”只设置暂停标志，当前请求完成后保留剩余 `pending`；继续上传沿用原顺序。“重试失败项”只把 `failed` 重置为 `pending`。
- 队列无失败时显示统计、自动关闭并刷新 Meme、标签和模板；存在失败时保留具体原因与重试入口。

### ZIP 持久化导入

```text
POST /api/import-jobs
  -> UploadFile 每 1 MiB 复制到 data/import_archives
  -> 创建 ImportJob 并提交
  -> HTTP 202
  -> 单线程 ImportJobManager
  -> ZipFile.infolist 安全预检
  -> ZipFile.open 逐成员读取
  -> ImageStorage.validate（格式、大小、哈希）
  -> MemeService.create_meme_no_commit
  -> 单项 SAVEPOINT；每 chunk_size 项外层 commit
```

- `ImportJob` 保存公共元数据、计数器、当前文件、归档引用和完整生命周期时间；`ImportJobItem` 保存每个图片成员的 success/skipped/failed、`meme_id` 和错误。
- 安全预检限制 20,000 个成员、20 GiB 总解压体积和 1000:1 单成员压缩比；绝对路径、Windows 驱动器路径和 `..` 图片成员逐项失败。
- 批次提交失败会回滚整批记录并清理本批已写原图/缩略图；重复图在缩略图生成前跳过。
- 取消在当前成员安全结束后停止，删除临时 ZIP；无失败完成也清理 ZIP，有失败则保留到重试成功或任务删除。
- 应用启动把遗留 `running`/`cancelling` 标记为 `interrupted`；导入执行器 `max_workers=1`，第一版不使用 Celery、Redis 或 WebSocket。
- 前端在普通图片/ZIP 两种模式间切换；ZIP 只显示归档摘要，轮询进度，弹窗关闭后继续，任务 ID 通过 localStorage 恢复，失败项分页展示。

### 多模态语义索引与任务线程边界

```text
Meme / Tag / Template / 图片写事务
  -> DerivedDataInvalidation 在同一事务中把已有 MemeEmbedding 标记为 stale
  -> 同一事务递增数据库 semantic index generation
  -> commit
  -> 不调用 Provider，也不通知内存对象

EmbeddingJob 创建
  -> 固定当前 model record / model identifier / dimension
  -> 集中内容构建器为候选 Meme 生成 source_hash
  -> 持久化 EmbeddingJobItem 快照
  -> HTTP 202
  -> 单协调线程按 max_workers 提交外部请求
  -> 工作线程各自创建只读 Session，预处理图片并调用 embed_fused
  -> 协调线程顺序写向量、项目状态、计数和 Token
```

- `meme_embeddings.meme_id` 唯一并随 Meme 级联删除；ready 行必须有 BLOB。搜索还要求 `model_record_id`、`model_id_snapshot`、1024 维和 `meme_fused_v1` 全部兼容。
- `meme_embedding_content.py` 是文档文本、图片选择、source hash 和图片 Data URI 的唯一构建位置；API、Job 和搜索服务不重复拼接文档内容。
- 文档 hash 不含时间、绝对路径、source、Caption、直接关联、历史分析或模板参考图。图片只含前 5 张的 `position` 和 `file_hash`，因此相同业务内容产生相同 hash。
- 图片优先缩略图、缺失时回退原图；Pillow 处理 EXIF、GIF 首帧、1024 最大边和透明 PNG/RGB JPEG，不产生永久衍生文件。
- `embedding_vectors.py` 统一拒绝空、零范数、NaN、Infinity 和维度错误；读取 BLOB 必须精确等于 `dimension * 4` 字节。
- 基础 `MemeService`、`TagService`、`TemplateService` 只依赖轻量 `DerivedDataInvalidation`；导入这些服务不会加载 NumPy、`SemanticIndex` 或 Embedding Provider。
- `MemeEmbeddingRepository` 只管理 Meme 向量和数据库 generation，`EmbeddingJobRepository` 只管理 Job/Item；单项重建和批量任务共用 `MemeEmbeddingService` 的生成、校验和持久化流程。
- `SemanticIndex` 首次查询才从 SQLite 加载当前模型 ready 向量，不保留 ORM 对象；查询时比较数据库 generation，变化后在锁内惰性重建矩阵，不使用全局实例注册表或通知双写。
- `app.models` 是唯一 ORM 模型注册入口；`Meme.embedding` 和 `MemeEmbedding.model_record` 等无消费者 relationship 已删除，数据库外键仍保留。
- `SemanticSearchResultCache` 的 key 包含模型记录、模型标识、index generation、规范化 query 和 tags；TTL 10 分钟、上限 50、LRU 淘汰，重启清空。
- 任务取消后不再提交新请求，已发请求允许完成；启动时 running/cancelling 改为 interrupted，不自动恢复。运行中模型或 Provider 配置变化会停止继续提交，已写结果保留。
- 第一版只支持单进程本地部署和 DashScope `qwen3-vl-embedding` fusion；没有 Redis、向量数据库、定时消费、自动上传向量化或多进程同步。

### 自然语言搜索与相似 Meme API

- `POST /api/semantic-search` 校验 2～500 字符 query、24/48/96 page size，查询使用独立 retrieval instruction；标签过滤在余弦排序前执行，同分按 Meme ID 升序。
- `GET /api/memes/{id}/similar` 不调用外部服务，排除自身，只比较当前兼容 ready 向量；Meme 不存在为 404，当前 Meme 无有效向量为 409。
- `POST /api/memes/{id}/embedding/rebuild` 仅服务单个 Meme，并把配置、超时和上游错误映射为 503/504/502。
- 前端语义模式不对输入做自动请求；Enter/按钮显式提交，标签、分页和卡片密度继续有效，普通排序隐藏，score 以小数显示且不解释为概率。
- 详情相似请求使用 AbortController 与 Meme ID 检查；未索引时只显示手动重建入口，不自动产生 Provider 费用。

### v0.6.2 聊天场景推荐

```text
POST /api/meme-recommendations/chat
  -> ChatRecommendationRequest 校验并 trim context / response_intent
  -> build_scene_query 优先表达显式回应意图
  -> ChatRecommendationService
  -> SemanticSearchService.search(tags=[], template_id=None, page_size=12)
  -> 当前 Embedding Provider 生成查询向量
  -> SemanticIndex 返回原排序分页结果
```

- `context` 必填且最多 4000 字符，`response_intent` 可空且最多 200 字符；两者保持独立，快捷 Chip 不参与 Tag Filter。
- Scene Query Builder 是纯逻辑，不调用 LLM；推荐不创建聊天表、不写查询正文、不修改 Meme、不触发 Embedding rebuild。
- `ChatRecommendationController` 独立维护 Dialog 状态；关闭时中止请求并清空正文、意图和结果，不写 localStorage/sessionStorage。
- 推荐卡片显示封面、标题、核心标签和 score，详情与原图通过现有应用回调打开，下载继续使用原有 Meme 下载接口；“再来一批”只是语义搜索后续页。

### v0.6.3 近重复巡检与 Merge

```text
POST /api/similarity-inspection
  -> 校验 inclusive ID Range / Top K / threshold
  -> 读取范围内当前模型 compatible ready MemeEmbedding
  -> 每个源 BLOB 反序列化后调用 SemanticIndex.search(exclude self)
  -> Top K -> threshold -> canonical Pair -> Ignore 过滤 -> score DESC
  -> 公共 Meme mapper 返回左右详情和弱关联状态

POST /api/memes/{target_id}/merge
  -> MemeMergeService 显式加载 Target / Source
  -> Source 图片临时负 position -> 改归属 -> Target 后连续重排
  -> 复用 TagRepository 来源/置信度优先级合并 Tag
  -> Caption 改归属 -> 收集并规范化重建 Weak Relation
  -> 同事务 invalidate Target -> 删除 Source -> commit
```

- `meme_similarity_ignores` 只保存规范化 `(meme_a_id, meme_b_id)`，具有唯一与 `a < b` 约束；任一 Meme 删除后 FK Cascade 清理，不迁移到合并后的 Target。
- Merge 保留 Target 标题、描述、来源、模板、created_at 和原首图；Source 图片按原顺序追加，不复制或删除磁盘文件。
- Tag union 使用现有 `user/manual > codex > ai` 规则，同来源选更高 confidence，用户来源 confidence 为 null；Caption 原记录完整迁移，不去重。
- Source 关系先收集邻居，再删除所有 Target/Source 边并重建 Target 规范无向边，避免自环与重复。
- Source Embedding、AI Analysis、Enrichment Suggestion 等机器判断不迁移；Source 删除 Cascade 清理，Target Embedding 标记 stale，不自动 rebuild。
- `VaultInspectorController` 即时保存候选；Ignore/弱关联移除当前 Pair，Merge 移除所有涉及两端的旧 Pair，旧请求由 AbortController 与 generation 保护。

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

### v0.6.1 统一元数据整理

```text
POST /api/memes/{id}/enrichment 或 EnrichmentJob / Luna importer
  -> MemeEnrichmentService 读取完整有序图片组和当前元数据
  -> Provider 或 Luna 生成统一 Candidate
  -> Luna importer 直接创建 pending Suggestion
  -> 规范化标签并按名称解析已有模板
  -> 保存 MemeEnrichmentSuggestion；不修改 Meme、不使 embedding stale
  -> 审核台按字段 Apply
  -> 重新加载 Meme + 校验 source_hash + 单事务修改
  -> DerivedDataInvalidation + EnrichmentAudit + commit
```

- source hash 固定包含标题、描述、排序标签、模板 ID 和全部图片的 position/file_hash；Meme 后续变化会把待审候选标为 stale，默认拒绝 Apply。
- Provider Prompt 允许标题/描述返回 null，优先复用最多 500 个已有标签，只按已有模板名称返回结果，不要求模型生成伪精确置信度。
- Job 协调线程是唯一 SQLite 写入者；外部请求线程只读图片并调用 Provider。429、5xx、网络和超时按 Provider 上限退避重试，支持 Retry-After；其他 4xx 不重试。
- 工作台显示完整图片组和当前值/建议值，支持筛选、字段选择、全部采用、拒绝、重分析、Luna/Provider 来源、过期警告、A/S/R/J/K/方向键及 IME 保护。
- 第一版安全批量操作只自动采用未过期建议中的新增标签；覆盖标题/描述、删除标签和改模板必须逐项确认。

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

## 主要 API

- `GET /api/memes/page`
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
- `POST /api/import-jobs`
- `GET /api/import-jobs/{job_id}`
- `GET /api/import-jobs/{job_id}/items`
- `POST /api/import-jobs/{job_id}/cancel`
- `POST /api/import-jobs/{job_id}/retry-failed`
- `DELETE /api/import-jobs/{job_id}`
- `GET/PATCH/DELETE /api/tags...`
- `POST /api/tags/{source_tag_id}/merge`
- `POST /api/tags/cleanup-empty`
- `POST /api/enrichment-jobs`
- `GET /api/enrichment-jobs/{job_id}` 与 `/items`
- `POST /api/enrichment-jobs/{job_id}/cancel` 与 `/retry-failed`
- `DELETE /api/enrichment-jobs/{job_id}`
- `GET /api/enrichment-suggestions` 与 `/{suggestion_id}`
- `POST /api/enrichment-suggestions/{suggestion_id}/apply|reject|reanalyze`
- `POST /api/memes/{meme_id}/enrichment`

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

v0.6.3 在不修改现有向量格式、Provider 或 ZIP Import 的前提下补齐批量导入后的人工治理闭环。巡检候选即时计算且不持久化；只有 Merge、现有 Weak Relation 和 Ignore 产生长期数据。

### v0.6.4 Meme 牌组 / 收藏夹

- `Collection` 保存名称、可选描述和时间戳；`CollectionItem` 以 `(collection_id, meme_id)` 唯一约束实现 Meme 与牌组的多对多关系，并保留 `position`/`added_at`。
- Collection API 提供 CRUD、详情内有序 Meme 列表、单项加入/移除，以及 `PUT /api/memes/{id}/collections` 原子同步多选 membership。
- 删除牌组只级联删除 CollectionItem；删除 Meme 只清理其 CollectionItem，另一侧实体均保留。
- 顶部牌组 Manager 负责管理与浏览；Meme 详情可加载并保存当前多选归属，操作后不刷新主图库分页、搜索、Tag Filter 或滚动位置。
- 牌组卡片复用现有 Meme 卡片响应与详情、Viewer、下载路径；“从牌组移除”只删除关联。
- Collection 与 Tag 职责独立：Tag 描述内容语义/分类，Collection 表达用户的私有组织与快捷取用。
- Collection membership 不参与 Meme `source_hash`，不会触发 Embedding stale，也不属于 Enrichment Suggestion。
- Meme Merge 在同一事务内迁移 Source membership：Target 已在牌组时保留 Target 原位置并删除重复项；仅 Source 在牌组时把原 Item 改指向 Target，尽量保留原 position。
- v0.6.4 未实现拖拽排序、智能牌组、AI 推荐、权限、分享或云同步。

Vite 默认把 `/api` 和 `/media` 代理到 `http://127.0.0.1:8000`。修改前端源码后必须重新构建，FastAPI 托管的生产页面才会更新。

## v0.8.3 Meme Forge 工作流闭环边界

- 底图可来自现有 Template Reference Image 或本地 PNG/JPEG/WEBP；GIF 不支持，本地图只存在当前会话。
- 文本框可选黑/白文字与黑/白描边，可调整文字、X/Y、宽度、字号、系统字体预设和左/中/右对齐；最多 20 个，数组顺序即绘制顺序。
- 支持复制、单层前后移动、0.5% 方向键微调与 Shift 2% 快速移动；输入控件焦点不触发移动。
- 固定架构为 Canvas Background → `imageLayers[]` → `textBoxes[]`；图片可内部排序，文字始终位于图片上方，不建立通用 `Layer[]`。
- `MemeImageLayer` 只保存 `sourceId`、百分比 `frameX/frameY/frameWidth/frameHeight`、画布绝对百分比 `contentX/contentY`、独立 `contentScale` 与 opacity；`MemeImageSource` Registry 保存解码图像和自然尺寸，同一来源可供多个独立裁切层复用。
- 来源注册表保留到 Maker 关闭，删除层不销毁来源以支持 Undo；会话结束统一释放 Object URL 与已解码资源。
- 本地图片输入支持多文件选择、Canvas Drop 和图片剪贴板；PNG/JPEG/WEBP 可用，GIF/非图片/解码失败/超过 50 MiB 文件逐项拒绝，合法文件继续导入。
- Forge 的 Vault 素材选择器复用现有 `GET /api/memes` 查询与媒体 URL，提供关键词、模板过滤和轻量分页；选中封面/第一张图后直接进入 Session Image Source Registry，不新增后端表或媒体服务。
- Viewer 的“加入 Meme Forge”传递当前正在查看的具体图片；Forge 若尚无底图，会用该图尺寸初始化隐藏背景画布并创建可撤销的图片层，之后仍可切换模板或本地底图。
- 图片 Frame 是纯矩形 Mask：移动/Resize Frame 不重新居中或缩放 Content，Crop Mode 拖动只平移 Content。几何区的图片层缩放固定为 10%–500%，按目标 `contentScale` 求比例，以 Frame 中心同步缩放 Frame、内容尺寸和 Content 相对偏移，从而保留当前裁切构图；缩放不受画布边界限制，Frame 可超出画布。普通对象移动继续把 Frame 与 Content 同量平移；显式 Fit、Fill、Reset Crop 才重新计算裁切构图。
- 当前底图可建立独立图片层并隐藏/显示；隐藏不清除底图来源或取景状态，Template/Local 保存归属规则不变。
- History 保存深拷贝的图片层、文本框、互斥选择、标题、Canvas/Background State 与 `backgroundVisible`，上限 50；图片只保存 `sourceId`，File、Blob、Bitmap、Canvas 和 DOM 不进入快照。
- Ctrl+Z/Y/Shift+Z、Ctrl+D、Delete、Escape 与 Arrow 系列只在非输入焦点生效；拖动、Resize 与 Slider 连续操作合并为一步。
- Drag 在中心线 1.25% 阈值内吸附 X/Y=50%；辅助线位于 overlay 且 pointerup 后隐藏。字号、X/Y、宽度和描边提供双向 Slider/Numeric 精调。
- 选中框与左右 resize handle 使用独立 DOM overlay，导出 PNG 只包含内容 Canvas。
- Output Canvas 独立于底图自然尺寸；支持原图、1:1、4:3、3:4、16:9，固定比例不主动上采样，CSS 只缩放预览。
- 背景支持 10%–400% Zoom、X/Y 百分比 Pan、空白画布拖动、Fit、Fill 与当前比例 Reset；画布未覆盖区域固定填白。
- History 额外保存轻量 Output Canvas 与 Background Transform；背景文件、Object URL、Canvas、Blob 和 DOM 仍不进入快照。
- Preview、Export 与 Save 使用完全一致的背景、图片层和文本渲染逻辑；Overlay 装饰不进入 Export，输出固定为 PNG。
- 快捷布局支持左右/上下二分、三横/三竖、上二下一、上一下二、2×2 与最多六张横/纵平铺；布局只作用于所需的前 N 层，并为每层显式执行 Fill + Center，整个布局只记录一步 History。
- 替换本地/Vault 来源保留 Frame、数组层级和 opacity，重置 Content 为 Fill + Center；清空全部图片层、清空全部文本框、重置当前 Forge 状态均为单步且可 Undo/Redo。
- 保存复用 `POST /api/memes`：Template 模式继承模板，Local 模式传 `template_id=null`；不自动生成 Embedding 或调用 Enrichment。
- 图片层裁切使用矩形 Frame + Canvas clip，不提供自由多边形/圆形 Crop、蒙版、旋转、滤镜、持久化/分支式 History、GIF Maker 或草稿持久化。
- 文本视觉支持 Hex fill/stroke、背景框颜色/透明度/Padding/圆角、阴影颜色/模糊/偏移、三档字重、行高和字距；字体仍仅使用系统预设。
- 样式剪贴板仅复制视觉与排版字段，不复制文字、ID、X/Y 或宽度，关闭 Maker 后释放。
- 输出支持常用像素预设及 64–4096px 自定义宽高；比例锁定按修改前比例联动，解锁后独立，画布背景色先于底图绘制。
- v0.8.3 明确不支持旋转、Sticker、Shape、滤镜、Blend Mode、自由蒙版、图片/文字任意交叉排序、多选/Group、GIF 编辑、项目草稿或复杂图层系统。
## v1.0.0 Card Motion Feature Freeze

- 主库 Meme Card 的最终动态层由 Motion Preset、Card Size Multiplier、Aspect Ratio 衰减、Lift/Tilt/Magnetic Follow，以及仅在“喝了假酒”档启用的 `DrunkPhysicsController` 组成。
- 假酒物理使用单一 `requestAnimationFrame`、`IntersectionObserver` viewport-near 集合和每卡独立随机 phase/speed/amplitude；Hover 卡片降低环境层强度，触屏与 reduced-motion 不启用。
- Card Motion 系统自此 Feature Freeze：后续只接受缺陷修复、性能优化和可访问性修复，不再增加新特效或新动态层。
