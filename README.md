# Meme Vault v0.5.3

Meme Vault 支持单图或按顺序组成的复合 Meme：首图作为瀑布流封面，详情页按顺序展示所有图片。完整 Meme 之间可手动建立双向、直接且不传递的弱关联；AI 分析会在一次请求中按顺序读取完整图片组。

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。当前版本为 v0.5.3，除图片上传、元数据管理、关键词检索、标签筛选和随机 Meme 外，还提供普通串行批量上传、持久化 ZIP 批量导入、有序多图 Meme、手动直接关联、模板参考图与视觉匹配、需要用户确认的 AI 图片组标题/描述/标签/已有模板建议、网页内模型管理、Meme 详情页文案实验室、Codex Luna 离线标签维护，以及响应式瀑布流画廊。编辑 Meme 时会原地更新对应状态和卡片，保持已加载分页、顺序、滚动位置及其他卡片不变；开发路线和进度见 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)。

## 环境要求

- Python 3.11 或更高版本
- Node.js 20.19 或更高版本
- Git

## 创建虚拟环境

在项目根目录运行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

如果 PowerShell 阻止执行激活脚本，可在当前终端临时允许本地脚本：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 安装依赖

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## 启动应用

### 开发模式

先安装前端依赖：

```powershell
npm.cmd --prefix frontend install
```

分别在两个终端启动后端与 Vite 开发服务器：

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

```powershell
npm.cmd --prefix frontend run dev
```

开发页面默认位于 <http://127.0.0.1:5173>。Vite 会把 `/api` 和 `/media` 代理到 <http://127.0.0.1:8000>。

如需使用其他后端地址，在 `frontend/.env` 中设置：

```dotenv
BACKEND_TARGET=http://127.0.0.1:8000
```

可以复制 [`frontend/.env.example`](frontend/.env.example) 作为起点。这个变量只配置 Vite 开发代理，不会进入浏览器构建产物。

### 生产构建

先构建前端，再启动或重启 FastAPI：

```powershell
npm.cmd --prefix frontend run build
python -m uvicorn app.main:app
```

`build` 会先执行 `tsc --noEmit` 类型检查，再执行 Vite 构建。只有 `frontend/dist/index.html` 存在时，FastAPI 才会在根路径托管网页；没有构建产物时，后端 API 仍可独立启动。

生产模式可访问：

- 网页管理台：<http://127.0.0.1:8000/>
- 健康检查：<http://127.0.0.1:8000/api/health>
- Swagger API 文档：<http://127.0.0.1:8000/docs>

健康检查预期返回：

```json
{"status":"ok"}
```

## 运行测试

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
python -m pytest -v
```

如果 PowerShell 允许执行 npm 脚本，也可以把 `npm.cmd` 简写为 `npm`。

Pytest 的临时文件统一写入项目根目录的 `.pytest_tmp/`，该目录已被 Git 忽略。

## Codex Luna 离线标签整理

不调用 Meme Vault 在线 AI Provider 的本地整理入口：

```powershell
.\tagging.ps1
```

浏览器页面可导出批次、按顺序预览完整图片组、复制 Luna 提示词并执行 dry-run。
真实导入没有网页按钮，仍必须人工复核后显式使用 `--apply`。完整说明见
[`docs/LUNA_TAGGING_WORKFLOW.md`](docs/LUNA_TAGGING_WORKFLOW.md)。

## TypeScript 前端

- 顶部工具栏提供标题/描述搜索、API 设置、模板管理、随机抽取和统一的“图片上传”入口。
- 左侧资料库按网格展示 Meme，并支持多标签筛选和分批加载。
- 瀑布流卡片只显示首图封面；多图 Meme 会显示图片数量角标。
- 右侧详情面板按顺序纵向展示完整图片组，并提供追加、删除和拖拽排序；最后一张图片不能删除，排序后的第一张自动成为封面。
- 原图查看器可从任意图片打开，并通过按钮或左右方向键在当前图片组内切换。
- “相关 Meme”只显示手动建立的直接弱关联；添加对话框支持按标题/描述搜索、多选批量添加和单条移除。
- 搜索输入使用 300ms 防抖；多标签沿用后端的“同时包含全部标签”语义。
- 图片上传对话框支持拖入或选择多张图片、缩略图预览、上传前移除/清空，并把公共标签、模板和来源应用到每个独立 Meme；每张图片的标题默认取去掉扩展名的文件名，也可在上传前单独修改。
- 批量队列严格串行；可在当前请求结束后暂停并继续，只重试失败项，重复图片按 HTTP 409 标记为跳过。
- 上传对话框可切换到 ZIP 模式：浏览器只上传一个压缩包且不渲染成员预览；任务创建后轮询持久化进度，关闭弹窗不影响后台执行，重新打开可恢复当前任务。
- ZIP 模式支持公共标签、模板、来源和 1～1000 的批次大小（默认 100）；失败明细分页显示，并可取消任务或只重试失败成员。
- 编辑表单可以选择已有模板；选择“无模板”会通过 JSON `null` 清除归类。
- 列表、批量上传、随机、保存和删除均提供独立的加载或错误反馈。
- 详情面板可发起 AI 图片分析，预览描述、标签建议、已有模板建议、置信度和使用的模型。
- AI 建议只有在用户选择并点击“确认采用”后才会写入；用户可拒绝模板建议、改选其他模板或清除归类。
- 文案实验室在 Meme 详情页内默认折叠，支持手写、编辑、复制、删除多条独立文案，并在切换 Meme、折叠或离开页面前提醒未保存草稿。
- AI 可结合完整有序图片组、标题、描述、标签、模板及场景/语气/长度生成 3、5 或 8 条临时候选，也可润色、缩短、扩写或换一种语气；候选只有主动保存后才入库。

## 文案实验室

选择 Meme 后展开“文案实验室”即可使用统一编辑器。场景和语气既可选常用预设，也可自由输入；长度可选短、中、长。已保存文案按更新时间倒序显示，默认收起较早记录。

AI 灵感生成和草稿改写复用当前激活的视觉模型、厂商、密钥、超时和重试设置，不新增独立文案模型。AI 候选仅存在于当前页面状态：替换草稿不会自动保存，直接“保存为新文案”时来源记录为 `ai`；编辑已有文案则始终保留原来源。聊天场景推荐 Meme 顺延至 v0.6.1，在 v0.6 向量化完成后实现。

## 模板管理与归类

点击顶部“模板管理”可查看、创建、编辑和删除模板。模板包含名称、可选描述和一张可选参考图；选择文件后左侧立即显示本地预览，已有模板在管理列表和编辑表单中显示参考图缩略图。配置独立的图像向量模型后，参考图会用于筛选视觉候选。上传或编辑 Meme 时可以选择一个已有模板；详情页显示当前模板或“未归类”。

使用 `qwen3-vl-embedding` 时，模板参考图会转换为 Base64 Data URI 并以独立图片向量请求百炼，不启用融合向量；同时保留旧 `tongyi-embedding-vision` 响应兼容。新建含参考图模板使用原子接口，图片向量化失败时会回滚数据库和文件，不产生空壳模板。

删除模板不会删除 Meme：相关 `Meme.template_id` 会在同一事务中清空，历史 AI 分析保留，但对应的 `suggested_template_id` 也会清空，避免悬空引用。

## API 设置与 AI 图片分析

点击网页顶部的“API 设置”，可以管理模型厂商和模型列表：

- 厂商页支持 OpenAI、Qwen、DeepSeek 和自定义 OpenAI 兼容接口，提供密钥、基础 URL、协议、超时与重试参数。
- 模型页可添加、编辑和删除模型，并将一个已启用的视觉模型设为当前图片分析模型。
- “测试”会请求厂商的 `/models` 接口；“刷新模型”会导入新发现的模型，新模型默认停用，需确认视觉能力后手动启用。
- DeepSeek 官方当前预设模型为文本模型，因此会显示在列表中，但不能直接设为图片分析模型。
- API Key 由后端加密后写入本地数据库，公开 API 只返回“是否已配置”和末四位提示，绝不返回明文。

首次保存密钥时，应用会自动生成被 Git 忽略的 `data/.ai_settings.key`。备份或迁移数据库时必须同时保存该文件，否则旧密钥无法解密。也可以通过 `AI_SETTINGS_ENCRYPTION_KEY` 提供固定的 Fernet Key。

v0.3 环境变量方式继续作为无网页配置时的兼容回退：

```powershell
$env:OPENAI_API_KEY = "your-api-key"
```

可选配置：

```powershell
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:AI_TIMEOUT_SECONDS = "30"
```

默认回退模型面向低成本图片整理任务，可通过 `OPENAI_MODEL` 替换。应用不会自动读取 `.env`，可复制 [`.env.example`](.env.example) 后由终端或部署环境注入；真实密钥不得提交到 Git。

内置预设参考厂商官方文档，并可通过在线刷新获取账号当前可用的模型：

- [OpenAI 模型列表](https://developers.openai.com/api/docs/models/all)
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models)
- [Qwen 视觉理解模型](https://help.aliyun.com/zh/model-studio/vision-model/)

分析分为两个阶段：

1. `POST /api/memes/{meme_id}/analyze` 按 position 顺序读取 Meme 的全部原图，在一次请求中把完整图片组、已有标签和模板候选交给模型，只生成一份组级描述、标签建议以及一个已有 `template_id` 或 `null`，但不修改 Meme。
2. 服务端再次校验 AI 返回的模板 ID 必须属于本次候选集合，并把它保存为分析快照。
3. `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm` 在一个事务中追加用户选中的标签，并可采用描述和用户最终选择的模板。

后端会优先提供已有标签给模型，并再次规范化输出：每次返回 2 至 8 个不重复标签。标签默认使用简体中文；常用外语专用表达、固定外语梗名，或使用外语才能更准确表达 Meme 含义时，会保留原外语标签。超时返回 504，未配置密钥返回 503，上游或响应格式错误返回 502。

## 数据库配置

默认数据库文件为 `data/meme_vault.db`，首次建立连接时自动生成。该文件已被 Git 忽略。

应用启动时会自动创建当前版本所需的数据表，包括 `memes`、`meme_images`、`meme_relations`、`captions`、`templates`、`tags`、`meme_tags`、`meme_ai_analyses`、`ai_providers`、`ai_models`、`import_jobs` 和 `import_job_items`。删除 Meme 时其 Caption 通过外键和 ORM 关系级联删除。

从旧 SQLite 数据库启动时，基础设施层会幂等补齐历史版本字段，并为每条尚无 `meme_images` 记录的旧 Meme 回填一张 position=0 的首图。迁移只复制已有图片元数据，不移动或重写磁盘文件；重复启动不会重复回填，也不会删除或重建已有表。非 SQLite 数据库不会执行这些 SQLite 专用 SQL。

数据库操作封装在 Repository 中。Repository 执行查询和 `flush`，事务提交或回滚由 `MemeService` 统一控制。

ZIP 导入由单线程 `ImportJobManager` 顺序执行，避免多个导入任务并发写 SQLite。应用启动时会把遗留的 `running`/`cancelling` 任务标记为 `interrupted`，不会永久卡在运行中。

## 图片存储

- 原图保存到 `data/images/`，缩略图保存到 `data/thumbnails/`。
- 浏览器可通过 `/media/images/<文件名>` 访问原图，通过 `/media/thumbnails/<文件名>` 访问缩略图。
- 支持 JPEG、PNG、WEBP 和 GIF，默认文件大小上限为 10 MiB。
- 存储文件使用随机 UUID 命名，缩略图统一保存为 PNG，最大尺寸为 400×400。
- 新数据库记录只保存文件名，不绑定项目绝对路径；读取旧记录时也兼容原先保存的 Windows 或其他绝对路径。
- 图片内容使用 SHA-256 计算哈希；原图和缩略图文件均不会提交到 Git。
- 每张图片在 `meme_images` 中独立保存元数据和零基 `position`；同一图片哈希不能跨 Meme 重复收录。
- `memes` 中原有图片字段暂时保留为兼容封面投影，并始终同步为图片组的第一张。

## 业务服务

所有 Meme 创建、查询、列表、修改和删除操作统一通过 `MemeService`。Service 负责协调 Repository 与 ImageStorage，并控制数据库事务：数据库写入失败时回滚事务并删除已保存文件；读取记录时会报告图片缺失，但 DELETE 仍能清理这类残留数据库记录。

## Meme API

所有接口均以 `/api` 开头，可在 <http://127.0.0.1:8000/docs> 使用 Swagger 操作：

- `POST /api/memes`：使用 multipart 表单上传图片及标题、描述、来源、标签和可选 `template_id`。
- `POST /api/import-jobs`：流式接收一个 ZIP 及公共元数据，持久化任务后立即返回 HTTP 202。
- `GET /api/import-jobs/{job_id}`、`GET /api/import-jobs/{job_id}/items`：读取任务进度和分页成员结果。
- `POST /api/import-jobs/{job_id}/cancel`、`POST /api/import-jobs/{job_id}/retry-failed`：取消或重试失败成员。
- `DELETE /api/import-jobs/{job_id}`：删除终态任务及其保留的临时 ZIP。
- `GET /api/memes`：获取列表，支持搜索标题和描述的 `q`、分页参数 `offset`/`limit`，以及可重复的 `tags` 参数。
- `GET /api/memes/random`：随机获取 Meme，可使用重复的 `tags` 参数限定范围。
- `GET /api/memes/{meme_id}`：获取详情。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源、标签数组或可空 `template_id`。
- `DELETE /api/memes/{meme_id}`：删除记录、原图和缩略图。
- `POST /api/memes/{meme_id}/images`：向现有 Meme 追加一张图片。
- `PATCH /api/memes/{meme_id}/images/order`：提交当前 Meme 的完整图片 ID 顺序。
- `DELETE /api/memes/{meme_id}/images/{image_id}`：删除一张图片；最后一张会被拒绝。
- `GET /api/memes/{meme_id}/relations`：获取直接关联的 Meme。
- `POST /api/memes/{meme_id}/relations`：用 `meme_ids` 数组批量添加双向直接关联。
- `DELETE /api/memes/{meme_id}/relations/{related_meme_id}`：移除一条直接关联。
- `GET /api/tags`：按名称排序获取标签列表。
- `GET/POST /api/templates`：获取模板列表或创建模板。
- `POST /api/templates/with-reference-image`：原子创建模板、保存参考图并生成独立图片向量。
- `GET/PATCH/DELETE /api/templates/{template_id}`：获取、修改或删除模板。
- `POST /api/memes/{meme_id}/analyze`：生成并记录 AI 描述、标签和已有模板建议，不直接修改 Meme。
- `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm`：确认选中的 AI 标签，并可采用描述和最终模板选择。
- `GET/POST /api/memes/{meme_id}/captions`：读取当前 Meme 的文案或保存一条手写/AI 文案。
- `PATCH/DELETE /api/memes/{meme_id}/captions/{caption_id}`：编辑或删除属于当前 Meme 的文案。
- `POST /api/memes/{meme_id}/captions/generate`：基于完整图片组和可选元数据生成临时候选，不写数据库。
- `POST /api/memes/{meme_id}/captions/rewrite`：润色、缩短、扩写或换语气，不写数据库。

## ZIP 导入的事务与清理

`POST /api/import-jobs` 以 1 MiB 块把上传流复制到 `data/import_archives/`，不会调用无参数的 `archive.read()`。后台先检查 ZIP 成员数、总解压体积和异常压缩比，再用 `zipfile` 逐项打开候选图片，不把整个压缩包解压到内存或目录。目录、系统垃圾、隐藏文件、非图片和嵌套压缩包被忽略；绝对路径和 `..` 成员记录为失败，不参与文件路径拼接。

每张图先复用 `ImageStorage.validate` 做大小、真实格式和 SHA-256 校验；查重发生在原图落盘和缩略图生成前。非重复项调用 `MemeService.create_meme_no_commit`，每项位于 SAVEPOINT 内，每 `chunk_size` 项提交外层事务。单项失败不会回滚同批其他项；外层批次提交失败时，整批数据库变更回滚，并按本批文件清单删除原图和缩略图。

无失败的完成任务和取消任务会删除临时 ZIP；含失败成员的完成任务暂时保留 ZIP，供 `retry-failed` 精确重读这些成员，任务删除或重试全部成功后再清理。批量导出仍未实现，留待后续独立版本。
- `/api/ai-settings/providers`：模型厂商的列表、新增、修改与删除。
- `/api/ai-settings/providers/{id}/test`：验证密钥和 `/models` 连接。
- `/api/ai-settings/providers/{id}/refresh-models`：同步厂商模型标识。
- `/api/ai-settings/models`：模型列表、新增、修改、删除与当前视觉模型选择。

Meme 响应使用有序 `images` 和 `image_count` 表示完整图片组；兼容字段 `image_url`、`thumbnail_url`、尺寸、哈希等始终对应第一张封面。响应不会返回服务器本地的 `file_path` 或 `thumbnail_path`。

如需使用其他数据库地址，可在启动应用前设置 `DATABASE_URL` 环境变量：

```powershell
$env:DATABASE_URL = "sqlite:///data/custom.db"
```

项目提供了 [`.env.example`](.env.example) 作为变量示例，但应用不会自动读取 `.env`；请通过终端或部署环境设置变量。

## 项目结构

```text
meme-vault/
├── app/
│   ├── api/                 # FastAPI 路由
│   ├── ai/                  # 统一 AI 客户端与供应商适配
│   ├── models/              # SQLAlchemy ORM 模型
│   ├── repositories/        # 数据库访问
│   ├── schemas/             # Pydantic 请求与响应结构
│   ├── services/            # 业务流程与事务控制
│   ├── storage/             # 本地图片存储
│   ├── config.py            # 路径和数据库配置
│   ├── database.py          # Engine、Session 与建表
│   └── main.py              # FastAPI 应用入口
├── data/
│   ├── images/              # 原图（内容不提交）
│   └── thumbnails/          # 缩略图（内容不提交）
├── frontend/
│   ├── src/                 # TypeScript、界面样式和前端测试
│   ├── index.html           # Vite 页面入口
│   ├── package.json         # 前端命令与依赖
│   ├── tsconfig.json        # 严格 TypeScript 配置
│   └── vite.config.ts       # 开发代理、构建与 Vitest 配置
├── docs/PROJECT_PLAN.md     # 长期开发蓝图与进度
├── tests/                   # Pytest 测试
├── .env.example
├── .gitignore
├── pytest.ini              # Pytest 默认临时目录配置
├── requirements.txt
└── README.md
```

## 开发约定

- 每次只执行 `docs/PROJECT_PLAN.md` 中的一个阶段。
- API Key 只能通过环境变量或网页设置提交到后端；不得写入代码或提交到 Git。
- 网页设置中的 API Key 必须加密保存，公开响应不得返回明文。
- 数据库、上传图片、缩略图、虚拟环境、`node_modules`、前端构建产物和缓存文件不得提交。
- 每个阶段完成后运行相关验证，并更新项目计划中的复选框。
