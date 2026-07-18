# Meme Vault

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。v0.1 提供图片上传、元数据管理、标签筛选和随机 Meme API；开发路线和进度见 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)。

## 环境要求

- Python 3.11 或更高版本
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

```powershell
python -m uvicorn app.main:app --reload
```

启动后可以访问：

- 健康检查：<http://127.0.0.1:8000/api/health>
- Swagger API 文档：<http://127.0.0.1:8000/docs>

健康检查预期返回：

```json
{"status":"ok"}
```

## 运行测试

```powershell
python -m pytest -v
```

## 数据库配置

默认数据库文件为 `data/meme_vault.db`，首次建立连接时自动生成。该文件已被 Git 忽略。

应用启动时会自动创建当前版本所需的数据表，包括 `memes`、`tags` 和 `meme_tags`。

数据库操作封装在 Repository 中。Repository 执行查询和 `flush`，事务提交或回滚由 `MemeService` 统一控制。

## 图片存储

- 原图保存到 `data/images/`，缩略图保存到 `data/thumbnails/`。
- 支持 JPEG、PNG、WEBP 和 GIF，默认文件大小上限为 10 MiB。
- 存储文件使用随机 UUID 命名，缩略图统一保存为 PNG，最大尺寸为 400×400。
- 图片内容使用 SHA-256 计算哈希；原图和缩略图路径均不会提交到 Git。

## 业务服务

所有 Meme 创建、查询、列表、修改和删除操作统一通过 `MemeService`。Service 负责协调 Repository 与 ImageStorage，并控制数据库事务：数据库写入失败时回滚事务并删除已保存文件；记录存在但图片缺失时返回明确的业务异常。

## Meme API

所有接口均以 `/api` 开头，可在 <http://127.0.0.1:8000/docs> 使用 Swagger 操作：

- `POST /api/memes`：使用 multipart 表单上传图片及标题、描述、来源和逗号分隔的标签。
- `GET /api/memes`：获取列表，支持 `offset`、`limit` 和重复的 `tags` 参数。
- `GET /api/memes/random`：随机获取 Meme，可使用重复的 `tags` 参数限定范围。
- `GET /api/memes/{meme_id}`：获取详情。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源或标签数组。
- `DELETE /api/memes/{meme_id}`：删除记录、原图和缩略图。
- `GET /api/tags`：按名称排序获取标签列表。

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
├── docs/PROJECT_PLAN.md     # 长期开发蓝图与进度
├── tests/                   # Pytest 测试
├── .env.example
├── .gitignore
├── requirements.txt
└── README.md
```

## 开发约定

- 每次只执行 `docs/PROJECT_PLAN.md` 中的一个阶段。
- API Key 和本地配置写入 `.env`，不得提交到 Git。
- 数据库、上传图片、缩略图、虚拟环境和缓存文件不得提交。
- 每个阶段完成后运行相关验证，并更新项目计划中的复选框。
