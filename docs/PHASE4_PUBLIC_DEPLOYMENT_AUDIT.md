# Phase 4A/B Public Deployment Audit

> 审计日期：2026-08-21
> 范围：Quick Tunnel 准备与公网兼容性代码审计；不包含 Cloudflare 账号、DNS、Named Tunnel 或 Windows Service 操作。

## 结论

| 检查项 | 状态 | 证据 / 处理 |
| --- | --- | --- |
| Public URL safety | PASS | 前端业务请求均使用 `/api/...`、`/media/...` 等同源相对路径；Vite 的 `BACKEND_TARGET` 只用于开发代理。 |
| Media safety | PASS | Meme、完整图片组、Template 与 External API 返回相对媒体路径；四类 `/media` 继续经过认证中间件。 |
| Download | PASS | 单图、指定图片和 ZIP 使用服务端 `FileResponse` 与安全 `Content-Disposition`；Visitor 的复合 ZIP 在后端拒绝。 |
| Cookie | PASS | Production 环境启用 `Secure`，所有环境继续启用 `HttpOnly` 与 `SameSite=Strict`。 |
| Proxy headers | PASS | 部署命令显式启用 Uvicorn proxy headers，且只允许同机 `127.0.0.1` cloudflared；应用不根据 Origin HTTP 手工生成绝对公网 URL。 |
| Redirect | PASS | Login、Logout、媒体和下载没有绝对重定向；未发现写死本机地址的 `Location`。 |
| CORS | PASS | 未启用全局 CORS；Web UI 与 API 保持 Same Origin。 |
| Swagger | PASS | `/docs`、`/redoc`、`/openapi.json` 继续 Admin Only。 |
| Secrets | PASS | Production 缺少 Access 配置会 fail-fast；仓库不接收 Tunnel Token，`.env` 被忽略。 |
| Production errors | PASS | FastAPI Production 默认不启用 debug stack trace；业务错误不返回数据库路径、SQL、环境变量或 Secret。 |
| Production logs | FIXED | 成功登录只记录 `Visitor login success` / `Admin login success`，失败只记录 `Login failed`，不记录 Key 或 Session Token。 |
| External API | FIXED | 响应 URL 已确认是相对路径且不泄露磁盘路径；当前机器调用仍使用 Web Session，独立机器凭据明确留给 Phase 4E。 |
| WebSocket / SSE | N/A | 当前产品没有 WebSocket 或 SSE，Phase 4A/B 不新增。 |
| Host allowlist | N/A | 正式 hostname 尚未确定；按任务书要求在域名确定后再配置，避免现在锁死 Quick Tunnel 与本地开发。 |

## URL 与前端调用审计

仓库业务代码中的 URL 生成点如下：

- `app/api/mappers.py`：Meme、Thumbnail 和完整图片组使用 `/media/...`。
- `app/api/templates.py`：Template Reference 使用 `/media/template-...`。
- External API：`image_url` 使用 `/api/memes/{id}/image`。
- `frontend/src/api.ts`、`frontend/src/auth.ts` 及各媒体模块：请求传入相对 path，不设置后端 Origin。
- Viewer、Focus Viewer、Infinite Feed、Semantic、Similar、Inspector 和 Download 直接消费上述相对 URL。

允许保留的本机地址仅位于开发/部署说明和 Vite 开发代理配置中，默认后端端口已统一为 `8002`。AI Provider 的 `base_url` 是用户配置的外部服务地址，不属于 Meme Vault 公网 Origin。

## 权限与媒体复验

- 未认证业务 API、媒体：`401`。
- Visitor 可读 API、原图/GIF、单图下载：允许。
- Visitor mutation、批量 Export/ZIP、Settings、Swagger：`403`。
- Admin：保留完整管理能力。
- Tunnel 只改变网络入口，不改变 `AuthorizationMiddleware`。

## 人工 Quick Tunnel 验收命令

终端一：

```powershell
python -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8002 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

终端二：

```powershell
cloudflared tunnel --url http://127.0.0.1:8002
```

必须使用临时 HTTPS 地址分别完成未认证、Visitor 和 Admin 冒烟，并用关闭 Wi-Fi 的手机网络复验。Quick Tunnel URL 不写入项目。人工验收通过前不进入 Phase 4C。

## 已知后续项

- Phase 4C：用户在 Cloudflare 侧创建 Named Tunnel、固定域名、Published Application 和 DNS。
- Phase 4E：为 Maibot 等机器客户端设计独立 External API 认证；当前不能把浏览器 Cookie 当作最终机器认证方案。
- 正式 hostname 确定后再评估 Trusted Host / Origin allowlist。
