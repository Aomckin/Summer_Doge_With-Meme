# Meme Vault

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。当前版本为 v0.3.3，除图片上传、元数据管理、关键词检索、标签筛选和随机 Meme 外，还提供模板管理与归类、需要用户确认的 AI 图片描述/标签/已有模板建议、网页内的模型厂商和模型管理，以及响应式瀑布流画廊；开发路线和进度见 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)。

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
python -m uvicorn app.main:app --reload --port 8002
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

## TypeScript 前端

- 顶部工具栏提供标题/描述搜索、API 设置、模板管理、随机抽取和上传入口。
- 左侧资料库按网格展示 Meme，并支持多标签筛选和分批加载。
- 右侧详情面板提供原图、元数据、编辑与删除操作。
- 搜索输入使用 300ms 防抖；多标签沿用后端的“同时包含全部标签”语义。
- 上传和编辑表单可以选择已有模板；编辑时选择“无模板”会通过 JSON `null` 清除归类。
- 列表、上传、随机、保存和删除均提供独立的加载或错误反馈。
- 详情面板可发起 AI 图片分析，预览描述、标签建议、已有模板建议、置信度和使用的模型。
- AI 建议只有在用户选择并点击“确认采用”后才会写入；用户可拒绝模板建议、改选其他模板或清除归类。

## 模板管理与归类

点击顶部“模板管理”可查看、创建、编辑和删除模板。模板仅包含名称与可选描述，不保存模板图片。上传或编辑 Meme 时可以选择一个已有模板；详情页显示当前模板或“未归类”。

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

1. `POST /api/memes/{meme_id}/analyze` 读取原图、已有标签和最多 200 个已有模板，生成描述、标签建议以及一个已有 `template_id` 或 `null`，但不修改 Meme。
2. 服务端再次校验 AI 返回的模板 ID 必须属于本次候选集合，并把它保存为分析快照。
3. `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm` 在一个事务中追加用户选中的标签，并可采用描述和用户最终选择的模板。

后端会优先提供已有标签给模型，并再次规范化输出：每次返回 2 至 8 个不重复标签。标签默认使用简体中文；常用外语专用表达、固定外语梗名，或使用外语才能更准确表达 Meme 含义时，会保留原外语标签。超时返回 504，未配置密钥返回 503，上游或响应格式错误返回 502。

## 数据库配置

默认数据库文件为 `data/meme_vault.db`，首次建立连接时自动生成。该文件已被 Git 忽略。

应用启动时会自动创建当前版本所需的数据表，包括 `memes`、`templates`、`tags`、`meme_tags`、`meme_ai_analyses`、`ai_providers` 和 `ai_models`。

从 v0.3.2 的旧 SQLite 数据库启动时，基础设施层会幂等检测并添加 `memes.template_id` 与 `meme_ai_analyses.suggested_template_id`。迁移不删除或重建已有表，不会丢失 Meme、标签、AI 分析或模型设置；非 SQLite 数据库不会执行这些 SQLite 专用 SQL。

数据库操作封装在 Repository 中。Repository 执行查询和 `flush`，事务提交或回滚由 `MemeService` 统一控制。

## 图片存储

- 原图保存到 `data/images/`，缩略图保存到 `data/thumbnails/`。
- 浏览器可通过 `/media/images/<文件名>` 访问原图，通过 `/media/thumbnails/<文件名>` 访问缩略图。
- 支持 JPEG、PNG、WEBP 和 GIF，默认文件大小上限为 10 MiB。
- 存储文件使用随机 UUID 命名，缩略图统一保存为 PNG，最大尺寸为 400×400。
- 新数据库记录只保存文件名，不绑定项目绝对路径；读取旧记录时也兼容原先保存的 Windows 或其他绝对路径。
- 图片内容使用 SHA-256 计算哈希；原图和缩略图文件均不会提交到 Git。

## 业务服务

所有 Meme 创建、查询、列表、修改和删除操作统一通过 `MemeService`。Service 负责协调 Repository 与 ImageStorage，并控制数据库事务：数据库写入失败时回滚事务并删除已保存文件；读取记录时会报告图片缺失，但 DELETE 仍能清理这类残留数据库记录。

## Meme API

所有接口均以 `/api` 开头，可在 <http://127.0.0.1:8000/docs> 使用 Swagger 操作：

- `POST /api/memes`：使用 multipart 表单上传图片及标题、描述、来源、标签和可选 `template_id`。
- `GET /api/memes`：获取列表，支持搜索标题和描述的 `q`、分页参数 `offset`/`limit`，以及可重复的 `tags` 参数。
- `GET /api/memes/random`：随机获取 Meme，可使用重复的 `tags` 参数限定范围。
- `GET /api/memes/{meme_id}`：获取详情。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源、标签数组或可空 `template_id`。
- `DELETE /api/memes/{meme_id}`：删除记录、原图和缩略图。
- `GET /api/tags`：按名称排序获取标签列表。
- `GET/POST /api/templates`：获取模板列表或创建模板。
- `GET/PATCH/DELETE /api/templates/{template_id}`：获取、修改或删除模板。
- `POST /api/memes/{meme_id}/analyze`：生成并记录 AI 描述、标签和已有模板建议，不直接修改 Meme。
- `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm`：确认选中的 AI 标签，并可采用描述和最终模板选择。
- `/api/ai-settings/providers`：模型厂商的列表、新增、修改与删除。
- `/api/ai-settings/providers/{id}/test`：验证密钥和 `/models` 连接。
- `/api/ai-settings/providers/{id}/refresh-models`：同步厂商模型标识。
- `/api/ai-settings/models`：模型列表、新增、修改、删除与当前视觉模型选择。

Meme 响应使用 `image_url` 和可为 `null` 的 `thumbnail_url` 提供浏览器可访问地址，不会返回服务器本地的 `file_path` 或 `thumbnail_path`。

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
