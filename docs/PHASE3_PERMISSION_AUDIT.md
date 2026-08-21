# Phase 3 权限审计

> 状态：v1.0.0 Phase 3 收口完成；最后更新：2026-08-21。

本表记录 Visitor / Admin Access Gate 启用后的集中路由策略。`authenticated` 表示 Visitor 与 Admin 均可访问；`admin` 表示未认证为 401、Visitor 为 403。

| Endpoint / Pattern | Method | 原权限 | Phase 3 权限 |
| --- | --- | --- | --- |
| `/api/auth/login` | POST | 不存在 | public |
| `/api/auth/me` | GET | 不存在 | public |
| `/api/auth/logout` | POST | 不存在 | public |
| `/api/health` | GET | public | public，且只返回 `status` |
| `/api/memes`, `/api/memes/page`, `/api/memes/{id}` | GET | public | authenticated |
| `/api/memes/random`, `/api/memes/semantic`, `/api/memes/{id}/similar` | GET | public | authenticated |
| `/api/semantic-search`, `/api/meme-recommendations/chat` | POST | public | authenticated（只读检索） |
| `/api/memes/{id}/image`, `/media/images/*`, `/media/thumbnails/*` | GET | public | authenticated |
| `/media/template-images/*`, `/media/template-thumbnails/*` | GET | public | authenticated |
| `/api/memes/{id}/download` | GET | public | 单图 authenticated；多图 ZIP admin |
| `/api/memes/{id}/images/{image_id}/download` | GET | public | authenticated（单图） |
| `/api/tags`, `/api/templates`, Meme captions / relations | GET | public | authenticated |
| `/api/memes*`, `/api/tags*`, `/api/templates*`, captions / relations | POST/PATCH/PUT/DELETE | public | admin |
| `/api/import-jobs*`, `/api/export-jobs*` | ALL | public | admin |
| `/api/embedding-jobs*`, `/api/enrichment-*`, `/api/semantic-index/status` | ALL | public | admin |
| `/api/ai-settings*` | ALL | public | admin |
| `/api/similarity-inspection*`, `/api/meme-similarity-ignores*` | ALL | public | admin |
| `/api/collections*` | ALL | public | admin |
| `/docs`, `/redoc`, `/openapi.json` | GET | public | admin |
| `/mobile` | GET | public | admin（上传入口） |

## 安全审计结论

- CORS：应用当前未安装宽泛 CORS middleware，不存在 `*` 与 credentials 的危险组合。浏览器会话使用 `SameSite=Strict`，并拒绝 `Sec-Fetch-Site: cross-site` 的 mutation。
- Static Media：四个媒体挂载点都经过 Authorization middleware，不再允许裸 URL 绕过认证。
- External API：Random、Semantic 与 Meme Media 当前纳入同一 authenticated Web Session 边界；没有现存独立机器 Access Key。Maibot 公网接入前应单独设计机器凭据，不应复用或保存 Visitor 原始 Key。
- Swagger：启用权限系统后仅 Admin 可访问；开发兼容模式保持原行为。
- 错误：认证失败统一返回 `Invalid access key`，不会透露命中的是哪类 Key，日志不记录 Key。

## 配置与生命周期

- 正式启用需要同时提供 `VISITOR_ACCESS_KEY`、`ADMIN_ACCESS_KEY`、`SESSION_SECRET`；三项不完整或两把 Key 相同会拒绝启动。
- `MEME_VAULT_ENV=production` 时缺少配置会 fail-fast，并启用 Secure Cookie；公网入口必须提供 HTTPS。
- 根目录 `.env` 被 Git 忽略，通过 `uvicorn --env-file .env ...` 显式加载；`.env.example` 只提供空 Secret 字段。
- Session Store 位于当前 FastAPI 进程内存，F5 可恢复，Logout 与到期会失效；服务重启或切换进程后需要重新登录。

## Non-Goals / 后续边界

- 本轮没有用户数据库、注册、OAuth、JWT、Redis、多租户或权限表。
- 本轮没有实现机器客户端独立 Access Key；External API 暂时沿用 Web Session，不能直接视为 Maibot 公网接入完成。
- 带宽限制、HTTPS、Tunnel 与 DDoS 防护属于反向代理/托管层，不塞入 Meme Vault 业务代码。

## 完成门禁

- TypeScript typecheck：通过。
- Vitest：37 files / 338 tests passed。
- Pytest：264 tests passed。
- Vite production build：通过。
- `git diff --check`：通过。
