# Meme Vault

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。当前版本为 v0.3，除图片上传、元数据管理、关键词检索、标签筛选和随机 Meme 外，还提供需要用户确认的 AI 图片描述与标签建议；开发路线和进度见 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)。

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
python -m uvicorn app.main:app --reload
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

- 顶部工具栏提供标题/描述搜索、随机抽取和上传入口。
- 左侧资料库按网格展示 Meme，并支持多标签筛选和分批加载。
- 右侧详情面板提供原图、元数据、编辑与删除操作。
- 搜索输入使用 300ms 防抖；多标签沿用后端的“同时包含全部标签”语义。
- 上传表单不会提交空的描述或来源字段；编辑时可通过 JSON `null` 清空这两个字段。
- 列表、上传、随机、保存和删除均提供独立的加载或错误反馈。
- 详情面板可发起 AI 图片分析，预览描述、标签建议、置信度和使用的模型。
- AI 建议只有在用户选择并点击“确认采用”后才会写入；确认失败会保留当前结果以便重试。

## AI 图片分析

v0.3 使用 OpenAI Responses API 分析已经保存的原图。启动后端前至少需要设置 API Key：

```powershell
$env:OPENAI_API_KEY = "your-api-key"
```

可选配置：

```powershell
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:AI_TIMEOUT_SECONDS = "30"
```

默认模型面向低成本图片整理任务，可通过 `OPENAI_MODEL` 替换。应用不会自动读取 `.env`，可复制 [`.env.example`](.env.example) 后由终端或部署环境注入；真实密钥不得提交到 Git。

分析分为两个阶段：

1. `POST /api/memes/{meme_id}/analyze` 读取原图并生成描述与标签建议，同时记录模型名和置信度，但不修改正式标签。
2. `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm` 只追加用户选中的标签，并可按用户选择采用描述。

后端会优先提供已有标签给模型，并再次规范化输出：总建议不超过 8 个，新标签不超过 3 个。超时返回 504，未配置密钥返回 503，上游或响应格式错误返回 502。

## 数据库配置

默认数据库文件为 `data/meme_vault.db`，首次建立连接时自动生成。该文件已被 Git 忽略。

应用启动时会自动创建当前版本所需的数据表，包括 `memes`、`tags`、`meme_tags` 和 `meme_ai_analyses`。

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

- `POST /api/memes`：使用 multipart 表单上传图片及标题、描述、来源和逗号分隔的标签。
- `GET /api/memes`：获取列表，支持搜索标题和描述的 `q`、分页参数 `offset`/`limit`，以及可重复的 `tags` 参数。
- `GET /api/memes/random`：随机获取 Meme，可使用重复的 `tags` 参数限定范围。
- `GET /api/memes/{meme_id}`：获取详情。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源或标签数组。
- `DELETE /api/memes/{meme_id}`：删除记录、原图和缩略图。
- `GET /api/tags`：按名称排序获取标签列表。
- `POST /api/memes/{meme_id}/analyze`：生成并记录 AI 描述、标签建议、模型名和置信度，不直接修改 Meme。
- `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm`：确认选中的 AI 标签，并可采用 AI 描述。

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
- API Key 和本地配置写入 `.env`，不得提交到 Git。
- 数据库、上传图片、缩略图、虚拟环境、`node_modules`、前端构建产物和缓存文件不得提交。
- 每个阶段完成后运行相关验证，并更新项目计划中的复选框。
