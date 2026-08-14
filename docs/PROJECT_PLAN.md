# Meme Vault 项目长期开发蓝图

> 本文是项目唯一的长期进度清单。每次只实施一个阶段；完成相关实现与测试后，更新对应复选框并停止，等待下一条指令。

## 1. 项目定位

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。

核心能力：

- 本地保存 Meme 图片，并维护标题、描述、来源和标签。
- 按标题、描述和标签检索，或随机抽取 Meme。
- 使用大模型识别图片、推荐标签、生成描述和配套文案。
- 根据聊天场景寻找合适的 Meme，并逐步支持语义搜索。
- 后续提供网页端模板制作、网络上传、用户系统和内容审核。

## 2. 技术方案与约束

- 后端：Python、FastAPI、SQLAlchemy、SQLite、Pydantic、Pillow、Pytest。
- 前端：TypeScript；初期使用 HTML、CSS 和原生 TypeScript，复杂度确有需要时再评估 Vue 或 React。
- 文件存储：第一阶段使用本地文件系统；以后可替换为 S3、MinIO、阿里云 OSS 或其他对象存储。
- AI：后期通过大模型 API 实现图片识别、标签推荐、描述和文案生成、场景匹配及语义搜索。
- 所有 API Key 必须从环境变量或后端设置接口接收，不得写入代码或提交到 Git；经设置接口保存时必须加密落盘，公开响应不得返回明文。
- 数据库只保存元数据、图片路径、标签、描述和时间；图片二进制不得写入数据库。
- 前端不得直接访问数据库或图片目录，所有操作必须经过后端 API。

## 3. 开发原则

### 职责分离

项目按 API 路由、业务服务、数据仓库、文件存储、数据模型、请求/响应结构分层。API 路由只负责接收请求、校验参数、调用 Service 和返回响应，不承载数据库操作、文件保存或业务编排。

所有 Meme 业务统一从 `MemeService` 进入，包括 `create_meme`、`get_meme`、`list_memes`、`update_meme`、`delete_meme`、`get_random_meme`。

### 小步开发

每次只完成一个明确阶段。开始前说明目标、调用链、涉及文件和明确不做的内容；完成后说明实际文件职责、调用链、测试与结果、三个关键知识点，更新本文进度，然后停止。

代码以易理解为先：职责清晰、命名直观、避免过度抽象和不必要的设计模式，只为关键流程添加简短注释。

## 4. 目标目录蓝图

目录按需创建，禁止在项目开始时一次性创建所有空文件。

```text
meme-vault/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── api/memes.py
│   ├── services/meme_service.py
│   ├── repositories/meme_repository.py
│   ├── repositories/tag_repository.py
│   ├── storage/image_storage.py
│   ├── models/meme.py
│   ├── models/tag.py
│   ├── schemas/meme.py
│   └── schemas/tag.py
├── frontend/
│   ├── index.html
│   ├── src/main.ts
│   ├── src/api.ts
│   ├── src/types.ts
│   └── styles/main.css
├── data/images/
├── data/thumbnails/
├── tests/
│   ├── test_health.py
│   ├── test_meme_api.py
│   ├── test_meme_service.py
│   └── test_image_storage.py
├── docs/PROJECT_PLAN.md
├── .env.example
├── .gitignore
├── requirements.txt
└── README.md
```

## 5. 核心数据模型

### Meme

字段：`id`、`title`、`description`、`original_filename`、`stored_filename`、`file_path`、`thumbnail_path`、`mime_type`、`file_size`、`width`、`height`、`file_hash`、`source`、`created_at`、`updated_at`。

其中 `file_hash` 用于重复检测；路径字段优先保存原图和缩略图的文件名或相对引用，并兼容读取旧绝对路径；原始文件名与系统安全存储名分开记录。

### Tag

字段：`id`、`name`、`category`、`description`、`created_at`。分类暂定为 `emotion`、`scene`、`character`、`style`、`source`、`custom`。

### MemeTag

Meme 与 Tag 为多对多关系。关联字段为 `meme_id`、`tag_id`、`source`、`confidence`；`source` 区分用户与 AI，用户手动标签可不设置 `confidence`。

## 6. API 蓝图

统一使用 `/api` 前缀：

- `GET /api/health`：返回 `{ "status": "ok" }`。
- `POST /api/memes`：接收图片、`title`、`description`、`source`、`tags`。
- `GET /api/memes`：支持分页、标题关键词、标签筛选和创建时间排序。
- `GET /api/memes/{meme_id}`：获取单个 Meme。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源和标签。
- `DELETE /api/memes/{meme_id}`：删除记录、标签关联、原图和缩略图，并处理部分失败的一致性。
- `GET /api/memes/random`：随机获取；后期支持按标签限定范围。
- `GET /api/tags`：获取标签列表。

上传流程：接收上传 → 校验格式和大小 → 计算 SHA-256 → 检测重复 → 保存原图 → 生成缩略图 → 写入数据库 → 关联标签 → 返回 Meme 信息。

## 7. 版本路线与进度

### v0.1：后端基础与 Meme 存储（已完成）

目标：形成最小可用的 Meme 上传与查询闭环。

#### 阶段 0：项目初始化

- [x] 初始化 Git 仓库
- [x] 创建基础 `.gitignore`
- [x] 创建 Python 虚拟环境说明
- [x] 创建最小 `requirements.txt`
- [x] 创建基础 README
- [x] 确认阶段 0 项目环境能够正常启动（Web 应用从阶段 1 开始）

验收：目录清晰，Git 状态正常，README 包含安装和启动方式。

#### 阶段 1：FastAPI 最小应用

- [x] 创建 `app/main.py` 和 FastAPI 应用
- [x] 实现 `GET /api/health`
- [x] 编写健康检查测试
- [x] 确认 Swagger 页面可访问

验收：健康检查返回 `{ "status": "ok" }`。

#### 阶段 2：数据库连接

- [x] 创建 SQLite 配置、SQLAlchemy Engine 和 Session
- [x] 创建数据库依赖函数
- [x] 确认数据库文件可正常生成

验收：应用可连接 SQLite，Session 可正常创建和关闭。

#### 阶段 3：Meme 数据模型

- [x] 创建 Meme ORM 模型
- [x] 创建 Meme 请求与响应 Schema
- [x] 自动创建 Meme 数据表
- [x] 编写模型基础测试

验收：可写入并读取一条 Meme 记录。

#### 阶段 4：Meme Repository

- [x] 创建 `MemeRepository`
- [x] 实现 `create`、`get_by_id`、`list`、`update`、`delete`
- [x] 编写 Repository 测试

验收：Repository 不依赖 FastAPI 请求对象，只负责数据库操作。

#### 阶段 5：图片存储

- [x] 创建 `ImageStorage`
- [x] 校验 JPEG、PNG、WEBP、GIF 格式
- [x] 限制文件大小并拒绝非图片文件
- [x] 生成安全文件名并计算 SHA-256
- [x] 保存原图并使用 Pillow 读取尺寸
- [x] 生成缩略图
- [x] 删除原图和缩略图
- [x] 编写图片存储测试

验收：有效图片可保存，非法或超限文件被拒绝，缩略图可生成，结果包含路径和图片信息。

#### 阶段 6：Meme Service

- [x] 创建 `MemeService`
- [x] 统一处理创建、查询、修改和删除流程
- [x] 数据库失败时回滚已保存文件
- [x] 处理记录存在但图片缺失的情况
- [x] 编写 Service 测试

验收：所有 Meme 业务操作统一从 `MemeService` 进入。

#### 阶段 7：Meme API

- [x] 创建并注册 Meme Router
- [x] 实现上传、列表、详情、修改和删除接口
- [x] 编写 API 测试

验收：可在 Swagger 中完成上传 → 列表 → 详情 → 修改标题 → 删除的闭环。

#### 阶段 8：标签基础功能

- [x] 创建 Tag 模型和 MemeTag 关联表
- [x] 创建 `TagRepository`
- [x] 支持上传和修改时设置标签
- [x] 支持按标签查询
- [x] 实现标签列表接口
- [x] 编写标签测试

验收：多对多关系正确，同名标签不重复创建。

#### 阶段 9：随机 Meme

- [x] 实现随机获取 Meme
- [x] 支持按标签随机
- [x] 空数据库时返回清晰错误
- [x] 编写随机接口测试

#### 阶段 10：v0.1 收尾

- [x] 整理 README、启动方式、API 用法和目录结构
- [x] 运行全部测试
- [x] 检查 `.env` 与数据库文件未被提交
- [x] 创建 Git 版本提交
- [x] 标记 v0.1 完成

### v0.1.1：后端媒体访问与检索收尾（已完成）

- [x] 原图和缩略图提供同源 HTTP URL
- [x] API 不再返回服务器本地路径
- [x] 新记录保存可迁移文件名，并兼容旧数据库路径引用
- [x] DELETE 可清理图片已缺失的 Meme 记录
- [x] Meme 列表支持在标题和描述中进行关键词搜索
- [x] Pytest 使用并忽略 `.pytest_tmp/`
- [x] 补充行为测试、README 和项目计划

验收：媒体 URL 可由浏览器访问；公开响应不含本地路径；`q` 可与标签和分页组合；缺图记录可删除；全部测试通过。

### v0.2：TypeScript 前端

- [x] 创建前端基础目录并配置 TypeScript
- [x] 实现 Meme 上传、网格展示和详情视图
- [x] 实现标题搜索、标签筛选和随机按钮
- [x] 实现编辑和删除
- [x] 处理加载状态和错误提示

验收：Vite 开发代理与 FastAPI 生产托管正常；上传、网格、详情、搜索、多标签筛选、随机、编辑、删除、分批加载和错误重试形成完整闭环；类型检查、前端测试、生产构建与 Pytest 全部通过。

### v0.3：AI 自动标签

- [x] 创建统一 AI 客户端并从环境变量读取 API Key
- [x] 创建图片分析接口并生成图片描述
- [x] 优先推荐已有标签，限制 AI 任意新建标签
- [x] 用户确认后才保存标签
- [x] 记录模型名和置信度
- [x] 处理 API 超时与失败

### v0.3.1：网页 API 设置

- [x] 增加模型厂商设置与常用 OpenAI、Qwen、DeepSeek 预设
- [x] 增加模型列表、手动编辑和在线刷新
- [x] 支持连接测试、超时与重试参数
- [x] 支持选择一个启用的视觉模型用于图片分析
- [x] API Key 加密保存且公开响应不返回明文
- [x] 保留 v0.3 环境变量配置作为无网页配置时的回退
- [x] 增加前后端行为测试与响应式设置界面

验收：网页可完成添加厂商 → 测试连接 → 刷新/编辑模型 → 选择视觉模型；DeepSeek 文本模型不会误设为图片分析模型；密钥明文不进入数据库、日志或 API 响应；类型检查、前端测试、生产构建与 Pytest 全部通过。

### v0.3.2：响应式画廊与标签收纳（已完成）

- [x] 将画廊改为随图片原始宽高比排列的响应式瀑布流，避免裁剪长图。
- [x] 扩展工作区宽度，右侧详情面板贴近视口右侧；宽屏下可展示最多七列 Meme。
- [x] 支持点击查看受视口限制的完整原图，并处理图片加载失败后的状态恢复。
- [x] 标签超过八个时折叠显示，提供展开/收起按钮，已选标签始终可见。

验收：窗口缩放时列数和卡片宽度响应变化；图片不被固定比例裁切；原图可完整查看；标签过多不挤占画廊空间。

### v0.3.3：模板归类与 AI 模板匹配（已完成）

- [x] 建立模板数据模型、Meme 的可空模板归属、仓储、服务、接口和前端选择器。
- [x] 在已有 AI 标签分析中，仅从已有模板候选返回一个 `template_id` 或 `null`。
- [x] 用户确认后才保存模板归属；AI 不创建、不命名、不自动保存模板。

### v0.4：复合 Meme 与手动弱关联（已完成）

- [x] 一个 Meme 支持一张或多张有序图片，第一张为封面。
- [x] 支持向已有 Meme 追加单图、删除非最后图片和拖拽排序。
- [x] 详情页纵向展示完整图片组，原图查看器支持按钮与方向键前后切换。
- [x] AI 在一次请求中按 position 顺序分析完整图片组，并只产生一条组级分析记录。
- [x] 完整 Meme 之间支持手动、双向、直接且不传递的弱关联。
- [x] 弱关联支持标题/描述搜索、多选批量添加和单条移除。
- [x] SQLite 启动迁移幂等回填旧 Meme 的首张 `MemeImage`，不移动或删除原文件。
- [x] 更新前端版本、README、代码现状文档，并通过前后端测试与生产构建。

验收：单图兼容字段继续指向封面；图片排序和删除同步封面投影；最后一张不能删除；完整删除会清理全部图片文件和直接关系；关系双向但不传递；AI 客户端按序收到完整图片组。

### v0.4.1：拖拽与批量上传（已完成）

- [x] 顶部工具栏增加统一“图片上传”入口，支持拖入和选择一张或多张图片。
- [x] 每张图片按文件名生成默认标题，允许上传前逐项修改，并通过现有单图 API 创建独立 Meme。
- [x] 整批共享标签、模板和来源，开始上传后锁定文件列表和公共信息。
- [x] 上传严格按选择顺序串行执行，单项失败不阻断后续，HTTP 409 重复图片记为跳过。
- [x] 支持当前请求完成后暂停、继续剩余任务，以及只重试失败项。
- [x] 全部成功或跳过时自动关闭并刷新 Meme、标签和模板；存在失败时保留对话框和具体原因。
- [x] 增加控制器与应用集成测试，并更新版本和项目文档。

验收：批量队列可预览、移除和清空；共享元数据逐项传入；顺序、暂停、继续、重试、重复跳过和关闭确认均有前端测试；不新增后端批量接口。

### v0.4.2：编辑稳定性与 AI 建议标题（已完成）

- [x] Meme 编辑成功后使用接口返回结果原地替换状态和对应卡片，不重新请求 Meme 第一页。
- [x] 保持已加载数量、顺序、offset、hasMore、滚动位置及其他卡片节点不变；标签变化时只刷新标签筛选列表。
- [x] AI 图片组分析生成一条简体中文建议标题，并保存在兼容历史记录的可空分析快照字段中。
- [x] “采用建议标题”默认关闭，只有用户勾选并确认后才更新 Meme 标题。
- [x] 补充后端、迁移、API 和前端回归测试，并同步项目版本与状态文档。

验收：加载两页后编辑不会再次调用 listMemes；AI 建议标题可预览、默认不采用、确认失败保留选择，旧分析记录继续可用。

### v0.5.0：Meme 文案实验室（已完成）

- [x] 新增独立 Caption 模型、Repository、Service 和嵌套路由；删除 Meme 时级联删除文案。
- [x] 支持手写、保存、编辑、复制、删除多条独立文案，以及场景、语气和短/中/长元数据。
- [x] 新增独立 `CaptionLabController`，处理统一编辑器、默认折叠列表、脏状态确认、局部错误和旧请求失效。
- [x] 复用当前视觉模型生成 3、5、8 条临时候选，并支持润色、缩短、扩写和换语气。
- [x] AI 候选默认不入库；直接保存标记为 `ai`，编辑已有文案保留原来源。
- [x] 补充前后端测试并更新 README、代码现状和项目版本。

验收：Caption CRUD 和级联删除正确；AI 按顺序读取完整图片组并校验去重后的候选数量；切换 Meme 后旧请求不覆盖新页面；未保存草稿会确认；现有浏览、编辑、分页、复合图片、批量上传和 AI 分析回归通过。

### v0.5.1：模板参考图向量化与管理修复（已完成）

- [x] 修复 DashScope `qwen3-vl-embedding` 模板参考图向量化，请求使用 Base64 Data URI、1024 维独立图片模式并兼容 `type=vl`。
- [x] 保留旧 `tongyi-embedding-vision` 图片响应兼容，并为后续 Meme 融合向量提供独立 `embed_multimodal` 客户端方法。
- [x] 新建含参考图模板改为原子接口，向量化失败时回滚数据库并清理原图和缩略图，避免幽灵模板。
- [x] 模板管理列表显示参考图缩略图；左侧表单提供本地选图预览，编辑时显示现有参考图。
- [x] 补充嵌入客户端、模板服务/API 和前端交互测试，并更新版本与项目文档。

验收：百炼请求不包含本地路径、相对 URL 或回环地址；单图只接受一个有效图片/视觉向量；上游错误信息保留；失败创建不留下模板或图片文件；模板管理双侧均可查看参考图。

### v0.5.2：Codex Luna 离线标签维护（已完成）

- [x] 按 `meme_id` 分批导出完整有序图片组、现有标签、标签词典和候选模板。
- [x] 提供仅监听本机的轻量页面、图片预览、PowerShell 预设和 Luna 提示词复制。
- [x] 候选使用严格 Schema并保护手动标签；原 v0.5.2 双阶段导入已在 v0.6.1 统一审核池中移除。

验收：不调用应用配置的外部 AI Provider；已有批次不覆盖；Luna 候选只进入人工审核池，不能直接修改 Meme。

### v0.5.3：ZIP 压缩包批量导入（已完成）

- [x] 新增持久化 `ImportJob` / `ImportJobItem` 模型、Schema、Repository、Service 和六个任务 API。
- [x] 上传流复制到临时 ZIP，使用 `zipfile` 逐成员读取；忽略垃圾成员并防护路径穿越、ZIP Bomb、超大成员数和总解压体积。
- [x] 抽取无提交 Meme 创建流程，以单项 SAVEPOINT 隔离失败，每 100 张默认统一提交；查重早于缩略图生成，批次失败清理全部本批文件。
- [x] 单线程顺序执行 SQLite 写入，支持取消、失败项重试、临时归档清理和启动中断状态恢复。
- [x] 前端保留普通图片队列并增加 ZIP 模式、公共元数据、进度轮询、弹窗恢复、取消、失败分页和重试。
- [x] 完成 README、代码现状、版本号和全量前后端测试/构建更新。

验收：250 张有效图片按 100/100/50 三批生成独立 Meme；重复、损坏和不安全路径不影响其他成员；限额、取消、批次回滚清理、启动恢复和旧功能回归通过。批量导出不属于本版本，仍未实现。

### v0.5.4：单个下载与批量下载（已完成）

- [x] 单图 Meme 和指定图片返回可读名称的原图附件；复合 Meme 返回有序 ZIP 与 manifest。
- [x] 新增共享安全文件名规则，处理中文、危险字符、保留名、长度、同名和 ZIP 路径边界。
- [x] 新增独立 ExportJob/Item、Repository、Service、Manager 和创建/查询/明细/下载/取消/删除 API。
- [x] 支持全部、完整筛选、模板和多标签 AND 查询，以及 flat/template/tag 三种目录结构。
- [x] 使用 ZIP_STORED、Zip64、磁盘 `.part`、原子 rename、24 小时过期清理和 512 MiB 磁盘安全余量。
- [x] 新增独立批量下载弹窗、任务恢复、失败分页、直接下载链接，以及详情/查看器原图下载按钮。
- [x] 保持 v0.5.3 上传与导入行为不变，并完成前后端全量回归与文档更新。

验收：批量查询不受 24 张前端分页限制；tag 复制与估算正确；缺图继续并生成 completed_with_errors；取消、重启、过期、空间不足和删除清理正确。

### v0.5.5：标签管理与标签芯片编辑器（已完成）

- [x] 标签列表使用单次聚合查询返回 `usage_count`，主资料库默认隐藏零引用标签，管理器可查询全部标签并按名称或使用数搜索排序。
- [x] 新增独立 `TagService`，支持标签重命名、按 `user/manual > codex > ai` 关系优先级原子合并、仅删除空标签和确认后批量清理空标签。
- [x] 顶部新增独立标签管理器，显示统计、筛选与逐行操作，并同步主资料库筛选、当前 Meme 详情和标签列表，不整页刷新。
- [x] 新增共享标签芯片编辑器，支持键盘操作、去重、删除、使用中标签自动补全和自由新建，并替换 Meme 编辑、普通上传及 ZIP 导入的逗号输入。
- [x] 更新 FastAPI/前端版本、README、代码现状与前后端回归测试。
- [x] 完成 TypeScript、Vitest、生产构建和 Pytest 全量验证。

验收：空标签不会出现在主资料库筛选栏且不会被自动删除；管理操作具备正确状态码和事务回滚；合并不产生复合主键冲突；三处标签输入均提交字符串数组且界面不再要求英文逗号。

### v0.5.6：资料库分页、展示密度与稳定乱序浏览（已完成）

- [x] 新增兼容的 `GET /api/memes/page`，返回当前页、完整筛选总数、总页数和有效页码；旧 `GET /api/memes` 响应保持不变。
- [x] Repository 复用 filtered IDs 子查询完成 COUNT 与当前页查询，多标签 AND 不重复计数；默认按 Meme ID 升序。
- [x] 使用 Meme ID、浏览 seed 和固定模数/乘数生成数据库确定性排序键，支持跨页稳定乱序与重新洗牌。
- [x] 主资料库支持首末页、前后页、紧凑数字页码、输入跳转及 24/48/96 每页数量；搜索、标签和排序变化正确重置页码并保护过期响应。
- [x] 超大/大/中/小卡片密度使用响应式瀑布流；超大档展示原图，其余档展示缩略图，卡片与每页数量偏好经验证后写入 localStorage。
- [x] 模板管理器在完整模板数组上固定每页 12 条，支持前后翻页、输入跳转及创建/编辑/删除后的页码修正。
- [x] 保持标签管理、标签芯片、随机单个 Meme、上传、下载、导出、复合图片、详情、模板和 AI 调用链兼容，并补充前后端测试和文档。

验收：主资料库不会在浏览器加载完整数据后分页；同一筛选与 seed 的跨页顺序稳定；批量下载仍提交完整 query/tags 筛选而非当前页 ID；TypeScript、Vitest、生产构建和 Pytest 全量验证通过。

### v0.6：多模态语义索引、自然语言搜索与相似 Meme（已完成）

- [x] 新增 `MemeEmbedding`，使用 SQLite 小端 Float32 BLOB 保存归一化的 1024 维融合向量；模板参考图 JSON 向量保持不变。
- [x] 集中构建标题、描述、标签、模板和前 5 张有序图片的固定文档内容与稳定 `source_hash`，完成 EXIF、GIF 首帧、透明通道和 1024 最大边预处理。
- [x] 扩展 DashScope 客户端的 `embed_fused()`、usage/request_id 解析、429/5xx/网络/超时重试和 Provider 能力验证，仅支持 `qwen3-vl-embedding` fusion。
- [x] 新增持久化 `EmbeddingJob`/`EmbeddingJobItem`、任务快照、1～8 外部工作线程、单协调线程顺序 SQLite 写入、取消、失败重试和启动中断恢复。
- [x] 新增惰性进程内 NumPy 矩阵索引、generation 失效、10 分钟/50 项查询 LRU、自然语言搜索、标签 AND 过滤、正式分页与相似 Meme API。
- [x] 标题、描述、标签、模板和图片业务变更在原事务中标记已有向量 `stale`；普通保存、上传和导入不调用 Provider。
- [x] 前端新增关键词/语义模式、显式提交、score 展示、索引管理器和独立的语义相似 Meme 详情区域；旧响应由 AbortController/请求身份保护。
- [x] 完成向量、内容哈希、融合客户端、任务协调、失效、搜索缓存、相似推荐和前端交互测试，并更新 README、代码现状和版本。

验收：向量只保存在本地 SQLite，搜索只使用当前激活模型兼容的 ready 向量并由本地 NumPy 排序；翻页不重复调用 Provider；索引任务不并发写 SQLite且不会在启动时自动恢复消费；关键词分页、稳定乱序、上传、下载、标签、模板和 AI 全量回归继续通过。

### v0.6-R：语义模块解耦（已完成）

- [x] 基础 Meme、Tag、Template 服务通过轻量失效接口在原事务内更新 stale 与数据库 generation，不再导入语义索引、NumPy 或 Embedding Provider。
- [x] 删除全局 SemanticIndex 通知注册表；语义索引查询时比较数据库 generation 并惰性重载。
- [x] 由 `app.models` 统一注册 ORM 模型，删除无消费者的 `Meme.embedding` 与 `MemeEmbedding.model_record` relationship，同时保留数据库外键。
- [x] 拆分 Meme 向量与 Embedding Job Repository，单项和批量重建共用 `MemeEmbeddingService`。
- [x] 提取公开 Meme Response mapper，恢复 Luna 标签维护的独立轻量导入链，并增加实际 import、mapper、generation 与工作流架构回归测试。

验收：本轮只调整依赖方向和内部职责，不改变 API、向量格式、索引算法、搜索排序或前端行为；v0.6.1 未开始。

### v0.6.1：AI 分析工作流重构与批量元数据补全（已完成）

- [x] 新增统一 `MemeEnrichmentSuggestion`、稳定 source hash、历史状态、审计记录和字段级安全 Apply。
- [x] 网页单项分析、Provider 后台批量 Job 和 Luna 离线候选共用 `MemeEnrichmentService` 与审核池。
- [x] Provider Job 支持范围筛选、1/2/4/8 并发、限流重试、取消、失败重试、启动中断和 Token 统计，不自动修改 Meme。
- [x] Luna 导出升级为标题、描述、标签和已有模板候选，默认 20、可选 10/20/50；导入不再区分 dry-run/apply，所有格式都直接创建待人工审核 Suggestion。
- [x] 前端新增“元数据整理”任务与建议审核工作台，支持字段选择、全部采用、拒绝、重分析、过滤、来源、过期警告、安全批量新增标签和 IME 安全快捷键。
- [x] 保留旧 `MemeAIAnalysis` 与 v0.5.2 标签 JSONL 兼容路径；Suggestion 创建/拒绝不使向量过期，实际 Apply 才调用 DerivedDataInvalidation。

验收：AI 和 Luna 只生产候选；Meme 修改后旧候选默认不可静默覆盖；后台任务单项失败不终止整批且重启不自动继续消费；单项与批量不复制保存逻辑；现有 Caption、语义、上传、分页、下载、标签和模板流程继续通过。

### v0.6.2：聊天场景推荐 Meme（已完成）

- [x] 使用独立 Context 与可选 Intent 构造 Scene Query，显式回应意图优先表达，不调用 LLM。
- [x] 新增薄推荐 API，复用现有 `SemanticSearchService`、Embedding Provider、查询缓存和 `SemanticIndex`，默认每批 12 条。
- [x] 顶部新增“场景召唤” Dialog、快捷意图、加载/错误/空状态和原语义排序的“再来一批”。
- [x] 推荐项支持查看详情、打开原图和下载；关闭 Dialog 清空私人聊天正文并中止旧请求，不写浏览器存储或数据库。
- [x] 补充 Query Builder、API 错误映射、前端竞态与隐私边界测试，并更新版本和项目文档。

验收：聊天上下文与回应意图保持独立；聊天正文只发送给当前 Embedding Provider，不持久化；推荐不调用额外 LLM、不修改 Meme、不重建 Embedding，现有语义搜索与浏览/详情/下载行为保持兼容。

### v0.6.3：近重复巡检与复合 Meme 合并（已完成）

- [x] 新增 ID Range 即时巡检，复用当前兼容 ready 向量和 `SemanticIndex`，支持 Top K、阈值、Pair 规范化去重、全索引范围外匹配与缺失统计。
- [x] 新增最小 `MemeSimilarityIgnore`，Pair 自动规范化、唯一约束、双 FK Cascade，并支持创建和撤销 API。
- [x] 新增单事务 Source → Target Merge，迁移有序图片、标签、Caption 和规范化弱关联，保留 Target 元数据并删除 Source。
- [x] Merge 不复制或删除图片文件，不迁移 Source 机器判断；Target Embedding 标记 stale，Source 派生数据和 Ignore 由 Cascade 清理。
- [x] 顶部新增“宝库巡检”对比界面，支持导航、查看完整图片组、双向主 Meme 选择、明确二次确认、弱关联和 Ignore。
- [x] 补充巡检、Ignore、图片/标签/Caption/关系/派生数据/回滚与前端竞态测试，并更新版本和文档。

验收：Semantic Similarity 只用于找值得人工检查的 Pair，不描述为重复概率且不自动操作；Merge 中途失败完整回滚，物理文件不动；合并后所有涉及 Source/Target 的旧候选立即移除，需重建 Target Embedding 后再巡检。

### v0.7：Meme 制作器（已完成）

- [x] 选择带静态 Reference Image 的现有 Meme 模板，无参考图与 GIF 明确禁用
- [x] Phase 2 升级为 0..20 个自由文本框，支持添加、选择、删除和同步摘要
- [x] 每个文本框独立调整文字、字号、X/Y、宽度、黑色描边和左/中/右对齐
- [x] 画布直接拖动文本框，并通过左右 handle 调整文本区域宽度
- [x] 以原图真实尺寸 Canvas 实时预览并导出 PNG
- [x] 将 PNG 作为普通 File 复用现有 Upload API，自动继承模板并记录 `source=meme-maker`

Phase 2 当时只实现模板上的自由文本排版，不构建复杂图像编辑器；v0.7.1 已进一步补充本地静态底图、黑白文字/描边和单层前后移动，但当时仍不支持 GIF Maker、图片图层、旋转、滤镜、Undo/Redo 或草稿持久化。

### v0.7.1：制作器实用性增强（已完成）

- [x] 每个文本框独立选择黑/白文字与黑/白描边；`strokeWidth=0` 表示无描边。
- [x] 复制当前文本框并生成新 ID、偏移 3% 后选中；继续遵守 20 个上限。
- [x] 使用数组顺序作为图层顺序，支持上移一层、下移一层和边界禁用。
- [x] 方向键按 0.5% 微调位置，Shift + 方向键按 2% 移动；表单和 contenteditable 焦点不触发。
- [x] 支持本地 PNG/JPEG/WEBP 临时底图、自然尺寸 Canvas、Object URL 释放和 Local 保存 `template_id=null`。
- [x] P1 提供经典 Meme、中文粗体、常规无衬线系统字体预设和不影响文字/位置/宽度的样式重置。

v0.7.1 当时仍不提供图片图层、旋转、Undo/Redo、GIF Maker、任意颜色选择、字体上传或复杂图层面板；Undo/Redo 已在 v0.7.2 补齐。

### 当前 v0.7.2 实现摘要

- [x] 新增最多 50 步会话内 Undo/Redo，只保存深拷贝的文本框、选择和标题状态。
- [x] 拖动、Resize 与 Slider 连续操作合并为一步历史；无状态变化不产生空历史。
- [x] 支持 Ctrl+Z、Ctrl+Y、Ctrl+Shift+Z、Ctrl+D、Delete、Escape、Arrow 与 Shift+Arrow，并统一输入焦点保护。
- [x] 文本框拖动接近 X/Y 中心 1.25% 时吸附到 50%，overlay 显示临时中心辅助线。
- [x] Font Size、X、Y、Width、Stroke Width 提供 Slider + Numeric Input 双向精调、decimal step 与统一 clamp。

History 不保存底图对象、Canvas、Blob、DOM 或渲染结果，关闭 Maker 后清空；不提供持久化 History、分支树、对象吸附、网格或自定义参考线。

### v0.7.3：底图取景与输出画布（已完成）

- [x] 拆分 Background Source、Output Canvas 与 Background Transform，支持原图、1:1、4:3、3:4、16:9。
- [x] 固定比例使用原图范围内最大内接输出尺寸，不主动上采样；文本框继续使用 Output Canvas 百分比坐标。
- [x] 背景支持 10%–400% Zoom、X/Y 百分比 Pan、空白画布直接拖动、Fit、Fill 和 Reset。
- [x] Ratio、Zoom、Pan、Fit、Fill、Reset 与连续背景拖动进入现有 50 步 Undo/Redo。
- [x] Preview、PNG Export 与 Save 共享相同背景几何和 Renderer；Template/Local 继续复用普通 Upload 归属规则。

裁剪通过输出画布与背景取景实现，当前不存在自由 Crop Rectangle；不提供旋转、镜像、滤镜、图片图层、自定义像素尺寸或 AI 构图。

### v0.7.4：Meme Forge 完整化增强与第一阶段封版（已完成）

- [x] TextBox 支持任意 Hex fill/stroke、三档字重、行高、字距、文本背景框与文字阴影。
- [x] 背景框按多行内容 bounds 外扩 Padding，支持独立透明度和圆角；阴影使用 Canvas 原生参数。
- [x] 会话内复制/粘贴视觉样式，不复制文字、ID、位置或宽度；Reset 保留内容与布局。
- [x] 输出支持常用尺寸、64–4096px 自定义宽高、比例锁定及 Canvas Background Color。
- [x] 所有新增 TextBox/Canvas 状态接入 50 步 Undo/Redo；Preview、Export、Save 共用 Renderer。
- [x] 无新增后端模型/API/服务，无新增 npm/Python 依赖。

Meme Forge 第一阶段至此封版并进入真实使用观察期；仍不提供旋转、图片图层、Sticker、滤镜、GIF 编辑、草稿文件或复杂图层系统。

### v0.8：多图拼装与快捷图像层（已完成）

- [x] 新增独立 `imageLayers[]` 与 Session Image Source Registry，不建立统一 `Layer[]`。
- [x] 支持多文件选择、Canvas Drag & Drop、Clipboard Paste、从当前底图创建图片层及底图显示/隐藏。
- [x] 支持图片层互斥选择、移动、四角自由 Resize、中心吸附、方向键微调、复制、删除和图片层内部排序。
- [x] 集中实现独立 Frame Mask 与 Content Transform：Frame Move/Resize 不隐式 Fit/Fill，Content Pan 不改变 Frame；几何区图片层缩放同步缩放 Frame、内容和裁切偏移，显式 Fit、Fill、Reset 才重算裁切构图。
- [x] History 保存图片层 `sourceId` 与可序列化 Frame/Content 状态；Frame Move、Frame Resize、Content Pan、图片层几何缩放、多文件导入各自合并为一步，Registry 保留到 Maker 关闭。
- [x] Preview、Export、Save 固定按 Canvas Color → 可见 Background → ImageLayers → TextBoxes 渲染，最终 PNG 继续复用现有 Upload API。
- [x] 无后端改动，无新增 npm/Python 依赖；仍不支持旋转、蒙版、滤镜、统一图层、GIF/视频或项目草稿。

### v0.8.1～v0.8.3：Forge 工作流闭环强化（已完成）

- [x] v0.8.1：Forge 内新增轻量 Vault 素材选择器，复用现有 Meme 查询、模板过滤、媒体 URL 与 Session Registry；Viewer 当前图可直接加入 Forge。
- [x] v0.8.2：新增九种快捷布局，对当前图片层批量更新 Frame 并显式 Fill + Center；精确布局作用于前 N 张，通用平铺最多六张，一次布局为一步 History。
- [x] v0.8.3：本地/Vault 替换来源保留 Frame、层级与透明度并重置 Content；补齐透明度、清空图片层、清空文本框与整体重置，全部支持 Undo/Redo。
- [x] Preview、Export、Save 继续共用 Renderer；不新增后端模型/API/存储服务，不新增 npm/Python 依赖。
- [x] 当前仍不支持旋转、滤镜、Sticker、GIF 编辑、自由蒙版、专业图层系统或可编辑工程保存。

### v1.0：可公开访问版本

- [ ] 用户系统、权限控制与分享链接
- [ ] 网络上传入口和上传收件箱
- [ ] 内容审核
- [ ] 对象存储与数据库迁移
- [ ] API 限流、数据备份和部署文档

## 8. 错误处理规范

后端提供清晰、统一、可定位的错误响应，至少覆盖：非图片文件、文件超限、重复图片、Meme 不存在、数据库写入失败、图片保存失败、图片文件丢失、AI API 失败、参数格式错误、标签不存在或非法。禁止只返回模糊的“操作失败”。

## 9. 测试要求

优先验证：图片正确保存、非法文件拒绝、重复检测、数据库记录创建、删除时同步清理图片、数据库失败时清理已保存文件、API 状态码、标签关系、空库随机接口响应。

每个阶段完成后运行相关测试；v0.1 完成前运行全部测试。

## 10. Git 原则

每阶段完成并验证后再提交。提交信息示例：

```text
chore: initialize meme vault project
feat: add FastAPI health endpoint
feat: add SQLite database setup
feat: add meme data model
feat: add image storage service
feat: add meme upload API
feat: add tag management
test: add meme API tests
docs: complete v0.1 documentation
```

不得提交：

```text
.venv/
__pycache__/
.env
data/*.db
data/images/*
data/thumbnails/*
.pytest_cache/
```

需要保留空图片目录时可使用 `.gitkeep`。

## 11. 当前状态

```text
### v0.6.4：Meme 牌组 / 收藏夹（已完成）

- 新增 Collection / CollectionItem 多对多数据模型、CRUD、membership 同步和加入顺序。
- 新增顶部牌组管理、牌组内容浏览及 Meme 详情多选归属。
- 删除与移除操作保持 Meme 安全，Collection 与 Tag、Embedding、Enrichment 完全独立。
- Merge 自动迁移 Source Collection membership 并去重、保留合理位置。
- 已补齐后端、前端及 Merge 集成回归测试。

### v0.6.5：快速取用链 / 复制与出库效率优化（已完成）

- 新增共享 `meme-actions.ts`，集中处理图片 MIME、读取、PNG 转换、剪贴板写入和可理解错误。
- 主资料库卡片、详情、Viewer、Scene Summon 与 Collection 均提供就地复制；下载继续复用原有后端 API。
- 单图静态 Meme 可直接复制；复合 Meme 在 Viewer 中按当前图片复制；GIF 明确提示使用下载，不复制首帧。
- 快捷操作具备独立 busy 状态、成功/失败反馈、键盘与窄屏可达性，并与打开详情/移除牌组隔离。

### v0.7.2：编辑历史与排版辅助（已完成）

- 新增浏览器原生 Canvas 制作器，静态 Template Reference Image 是唯一底图来源。
- 单一 `textBoxes[]` 模型支持最多 20 个文本框；每个框独立控制 X/Y、宽度、字号、描边和对齐。
- 共享测量逻辑支持手动换行、中英文自动换行、bounds 与画布边界 clamp；数组末尾作为最上层。
- 独立交互 overlay 支持点击选中、拖动和左右 handle resize，编辑器装饰不进入导出 PNG。
- Preview、PNG Export 与 Save 共用 `meme-renderer.ts`；Canvas 内部始终保持参考图原始分辨率。
- Save 把 PNG Blob 转成 File 并复用现有 `uploadMeme`，自动传入当前 Template、`source=meme-maker` 和空 tags。
- 无新增后端 API、模型、数据库表、第三方依赖或 AI/Embedding 调用。
- 文本框支持黑白文字/描边、复制、单层前后移动、键盘微调、系统字体预设与样式重置。
- 底图支持 Template 或本地 PNG/JPEG/WEBP；切换时保留文本框，本地 Object URL 在切换/关闭时释放。
- Template 保存继承模板；Local 保存显式使用 `template_id=null`，两者继续走普通 Upload。
- 50 步 Undo/Redo 恢复 TextBox、Selection 和 Title；背景资源不进入历史，关闭即清空。
- 全局非输入区支持撤销/重做、复制、删除、取消选择和位置微调快捷键。
- Drag 中心吸附只针对 Canvas X/Y=50%，辅助线位于 overlay；数值属性支持 Slider 与 Numeric 双向精调。

当前状态：v0.8.3 Meme Forge 工作流闭环强化已完成
后端：Python + FastAPI
前端：Vite + 原生 TypeScript
数据库：SQLite
ORM：SQLAlchemy
图片处理：Pillow
图片存储：本地文件系统
测试：Vitest + jsdom + Pytest
AI：OpenAI Responses API + OpenAI 兼容 Chat Completions + 有序多图元数据建议 + Provider/Luna 统一审核池 + 持久化批量任务 + 文案生成/改写 + 网页厂商/模型配置 + 模板视觉匹配
下一步：真实使用验收；不自动扩展旋转、蒙版、滤镜或统一图层系统
```
