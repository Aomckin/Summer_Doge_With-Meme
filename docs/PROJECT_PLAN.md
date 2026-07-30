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

### v0.5：Meme 文案实验室

- [ ] 根据 Meme 生成多个候选文案
- [ ] 支持语气、使用场景和长度选择
- [ ] 支持普通、抽象、可爱、阴阳怪气、简短、高攻击性、低攻击性、二次元语气
- [ ] 保存历史文案并支持一键复制
- [ ] 根据聊天场景推荐 Meme

### v0.6：语义搜索

- [ ] 为 Meme 描述生成向量
- [ ] 根据自然语言搜索 Meme
- [ ] 实现相似 Meme 推荐和场景匹配
- [ ] 评估向量数据库或本地向量存储方案

### v0.7：Meme 制作器

- [ ] 选择 Meme 模板
- [ ] 添加顶部和底部文字
- [ ] 调整字号、位置和文字描边
- [ ] 实时预览并导出图片
- [ ] 将制作结果重新加入 Meme 库

第一阶段仅实现模板式编辑，不构建复杂图像编辑器。

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
当前状态：v0.4.2 编辑稳定性与 AI 建议标题已完成
后端：Python + FastAPI
前端：Vite + 原生 TypeScript
数据库：SQLite
ORM：SQLAlchemy
图片处理：Pillow
图片存储：本地文件系统
测试：Vitest + jsdom + Pytest
AI：OpenAI Responses API + OpenAI 兼容 Chat Completions + 有序多图组级分析 + 网页厂商/模型配置 + 模板视觉匹配
下一步：v0.5——Meme 文案实验室
```
