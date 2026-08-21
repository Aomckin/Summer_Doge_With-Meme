# Meme Vault v1.0.0 Phase 4A/B

## Visitor / Admin Access

Phase 3 增加统一 Access Gate。未认证用户只能看到钥匙输入页；Visitor 可以浏览、搜索、语义检索、沉浸浏览、查看原图/GIF 与下载单图；Admin 保留上传、编辑、删除、标签/模板/AI 设置、批量下载和导出等完整管理能力。前端隐藏只负责体验，后端会对未认证请求返回 `401`、对 Visitor 越权写操作返回 `403`。

参考 [`.env.example`](.env.example)，在根目录 `.env`、shell 或部署环境中设置变量，并分别生成三个互不相关的长随机值。使用根目录 `.env` 时，通过 `uvicorn --env-file .env ...` 显式加载：

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

```env
VISITOR_ACCESS_KEY=
ADMIN_ACCESS_KEY=
SESSION_SECRET=
```

三项必须同时配置，Visitor/Admin Key 不得相同。生产环境还应设置 `MEME_VAULT_ENV=production`：服务会在缺少密钥时 fail-fast，并为 Session Cookie 启用 `Secure`；公网入口必须使用 HTTPS。Access Key 只用于换取 HttpOnly、SameSite=Strict Session Cookie，不会存入 URL、localStorage 或 sessionStorage。不要提交 `.env` 或任何真实 Secret。

未配置三项变量时，开发环境会明确警告并使用兼容模式，以便本机维护和既有测试；这不是公网部署配置。该权限模型面向私人/小范围受邀访问，不是大型 SaaS IAM、反爬或 DDoS 系统。完整端点审计见 [`docs/PHASE3_PERMISSION_AUDIT.md`](docs/PHASE3_PERMISSION_AUDIT.md)。

Meme Vault 支持单图或按顺序组成的复合 Meme：首图作为瀑布流封面，详情页按顺序展示所有图片。完整 Meme 之间可手动建立双向、直接且不传递的弱关联；AI 分析会在一次请求中按顺序读取完整图片组。

Meme Vault 是一个个人 Meme 收藏、管理、检索和创作网站。v1.0.0 Phase 3 已完成：在 Phase 2 的 Infinite Feed 与整体视觉重构基础上，增加 Visitor / Admin Access Gate、不透明服务端 Session、全量 API 与静态媒体权限边界，以及 Visitor 只读 UI。Appearance、原图/GIF Focus Viewer、Infinite Feed、Occupancy Grid 与正式冻结的 Meme Card Motion 系统继续保持原有边界；本轮没有引入用户数据库、OAuth、JWT、Redis、复杂 RBAC 或限流系统。

继续开发前请依次阅读 [`docs/NEXT_CONVERSATION_HANDOFF.md`](docs/NEXT_CONVERSATION_HANDOFF.md)、[`docs/CODEBASE_STATUS.md`](docs/CODEBASE_STATUS.md) 和 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)。前者是当前交接入口，后两者分别描述已落地代码和长期路线。

## v1.0 Phase 2 视觉重构

- App Shell 将 Search、Add / Upload 和 Immersive 设为主要入口；Random、Download、Appearance 降为次级操作，API、模板、标签与高级管理工具集中到二级菜单。
- 全站统一 Typography、Spacing、Radius、Surface、Border、Shadow、Button、Input、Motion 与 Easing Tokens，并继续由 Appearance Variables 提供动态背景材质。
- Library 使用轻量筛选工具栏、可横向溢出的 Template / Tag Chips、使用数量和统一视图控制；Meme Card 保持 Content-first，并复用既有 Physics。
- Inspector 改为 Preview、内容、Metadata、Actions 和 Danger Zone 的详情层级；Dialog、Popover、Backdrop 与危险操作使用统一视觉语言。
- Immersive Dock、Focus Viewer、Infinite Loading / End State 完成视觉统一，Free Gallery、GIF、原图与 Infinite Feed 行为保持不变。
- Loading、Empty、Error、Toast、Disabled、Keyboard Focus、Reduced Motion、动态背景对比度及主要响应式断点获得统一处理。

## v1.0 Phase 3 Visitor / Admin Access Gate

- 未认证状态只渲染 Access Gate；前端先调用 `GET /api/auth/me`，认证成功后才启动 Vault 数据加载。
- `POST /api/auth/login` 使用 Visitor/Admin Key 换取不透明 Session Cookie；Key 不进入 URL、localStorage、sessionStorage 或后续请求头。
- Session 只保存 `visitor` / `admin` Role，Cookie 使用 HttpOnly 与 SameSite=Strict；生产模式启用 Secure。
- Visitor 可浏览、搜索、Semantic、Similar、Random、Immersive、Infinite Feed、原图/GIF、Focus Viewer及单图下载。
- Upload、Edit、Delete、Tag/Template/AI 管理、批量 ZIP/Export、Mobile Ingest 与 Swagger 为 Admin Only。
- `/media/images`、`/media/thumbnails` 和模板媒体均经过认证中间件，不能通过已知裸 URL 绕过权限。
- 完整端点矩阵、CORS、Static Media、Swagger 与 External API 审计见 [`docs/PHASE3_PERMISSION_AUDIT.md`](docs/PHASE3_PERMISSION_AUDIT.md)。

## External Meme API

可信局域网内的通用消费者可通过以下接口取用 Meme：

- `GET /api/memes/random`：随机返回一张当前可用 Meme 的元数据。
- `GET /api/memes/semantic?q=无语&limit=1`：复用现有语义索引，从本地 Top 5 中随机返回一张。
- `GET /api/memes/{id}/image`：按实际 MIME 返回原始封面，GIF 保持原文件。

响应中的 `image_url` 是相对 URL，不包含服务器磁盘路径。完整参数、响应与错误契约见
[`docs/external-api.md`](docs/external-api.md)。

## Mobile Ingest

先构建前端并让 FastAPI 监听局域网网卡：

```powershell
npm.cmd --prefix frontend run build
python -m uvicorn app.main:app --env-file .env --host 0.0.0.0 --port 8002
```

手机与电脑接入同一可信局域网后，在手机浏览器访问 `http://电脑的局域网IPv4:8002/mobile`。页面支持从系统相册多选 JPG/JPEG、PNG、WebP 和 GIF，按顺序逐张调用现有 `POST /api/memes` 入库；上传期间显示处理进度，完成后分别汇总成功数、失败数和失败文件名。“继续投喂”会清空本轮状态并开始下一轮。

Mobile Ingest 使用同源相对 API，不需要配置或硬编码电脑 IP。它复用桌面端相同的图片校验、10 MB 大小限制、去重、文件名处理、原图/缩略图存储、数据库事务和 Derived Data Invalidation，不提供浏览、编辑、删除、登录、PWA 或公网访问能力。

## Meme 制作器

顶部“Meme 制作器”入口可读取现有模板参考图，或选择仅在当前会话使用的本地 PNG、JPEG、WebP 底图。加载后会创建一个默认文本框；可继续添加、选择、删除或复制文本框，并为每个文本框独立设置文字、字号、X/Y、文本区域宽度、黑/白文字、黑/白描边、左/中/右对齐与三个系统字体预设。画布支持拖动、左右 handle 调宽及方向键微调（0.5%，Shift 为 2%）；最多 20 个文本框，并可上移或下移一层。

图片层可通过本地多文件、拖放、剪贴板、当前底图或轻量 Vault 素材选择器加入；Viewer 当前图也能直接送入 Forge。支持 PNG/JPEG/WEBP，最多 30 层；GIF 明确拒绝。每层把矩形 `frameX/Y/Width/Height` 与图片内容 `contentX/Y/Scale` 分开保存：Frame 只是 Mask，Resize 或裁切模式下移动 Frame 不会重排图片内容，裁切区拖动只平移 Content；几何区“图片层缩放”固定支持 10%–500%，以 Frame 中心为锚点同步缩放 Frame、内容尺寸与当前裁切偏移，保持现有裁切构图，并允许 Frame 超出画布。只有显式 Fit、Fill、重置裁切以及明确的一键布局/替换来源才重新计算裁切构图。另支持复制、删除、图片层内部排序、透明度、中心吸附和方向键微调；文字固定绘制在全部图片层上方。

“快捷布局”可对当前所有图片层应用左右/上下二分、三横排、三竖排、上二下一、上一下二、2×2、最多六张横向或纵向平铺；一次布局作为一步历史，并对受影响图片显式执行 Fill + Center。当前图片层可替换为本地或 Vault 图片，保留 Frame、层级与透明度并让新图 Fill + Center。清空全部图片层、清空全部文本框和重置 Forge 均为独立可撤销操作。

“显示底图”可在不清除模板、本地底图或取景参数的情况下隐藏背景，便于把同一底图裁成多个区域重新拼装。图片来源与图片层分离，同一来源可供多个层采用不同裁切；来源注册表保留到当前 Maker 会话结束，因此删除图片层后仍可 Undo 恢复。

每个文本框可使用任意 Hex 文字色和描边色、normal/bold/heavy 字重、0.8–2.0 行高倍率及 -4–20px 字距。文本背景框支持颜色、独立透明度、Padding 和圆角；文字阴影支持颜色、模糊和 X/Y 偏移。背景框先根据多行文字实际内容 bounds 外扩 Padding 再绘制，阴影使用 Canvas 原生文字阴影。经典白字黑边仍是默认样式。

“复制样式 / 粘贴样式”只复用视觉与排版字段，不复制文字、ID、位置或文本框宽度；样式剪贴板仅存在当前 Maker 会话。扩展后的“重置样式”同样保留文字、位置和宽度，复制、粘贴、重置都接入 Undo/Redo。

输出画布支持原图、1:1、4:3、3:4、16:9；固定比例尺寸取原图范围内最大内接矩形，不主动放大。底图可使用 10%–400% 缩放与 X/Y 百分比偏移，也可直接拖动画布空白区域平移；“适应画布”完整显示图片并允许白色留白，“填满画布”覆盖画布并允许边缘裁切，“重置底图”在当前比例下恢复 Fill + Center。裁剪通过输出画布与背景取景实现，当前不存在自由 Crop Rectangle。

输出还提供 1080×1080、1080×1350、1920×1080、1200×675、800×800 常用尺寸，并允许在 64–4096px 内自定义宽高。锁定比例时修改一边会按当前比例推算另一边，解锁后宽高独立；尺寸变化会执行 Fill + Center。画布背景色用于 Fit 或手动移开底图后的未覆盖区域。

预览、导出与保存共享同一个 Canvas Renderer，固定顺序为画布背景色、可见底图、图片层数组、文字层数组；选中框、Resize handle、裁切状态和辅助线位于独立 DOM overlay，不会进入输出。保存时把最终 PNG 转成普通 `File` 并调用现有 Meme Upload API：Template 底图继承当前 `template_id`，Local 底图传 `template_id=null`，图片层来源不改变模板归属。

编辑历史保存最多 50 个轻量状态步骤，包含图片层、文本框、互斥选择、标题、输出/底图状态与底图可见性，只保存图片 `sourceId`，不保存 File、Blob、Bitmap、Canvas 或 DOM。撤销/重做可使用顶部按钮、`Ctrl+Z`、`Ctrl+Y` 或 `Ctrl+Shift+Z`；`Ctrl+D`、`Delete`、`Escape` 和方向键根据当前图片/文字选择执行。Frame Move、Frame Resize、Content Pan、图片层几何缩放与其它 Slider 连续变化分别合并为一步；历史与来源注册表在关闭制作器后清空并释放。

当前明确不支持旋转、倾斜、自由蒙版、抠图、滤镜、Blend Mode、Shape/Sticker、图片与文字任意交叉排序、多选/Group、GIF/视频编辑、AI 自动拼图或可重新打开的工程草稿；保存到 Vault 的仍是一张普通最终 PNG。

拖动文本框接近画布 X/Y 中心 1.25% 范围时会吸附到 50%，并在独立 overlay 中显示竖直或水平辅助线，松手立即隐藏且不进入 PNG。字号、X、Y、宽度和描边同时提供 Slider 与 Numeric Input；X/Y/宽度支持 0.1 精度，非法值在 change/blur 时恢复或 clamp。

## Meme 牌组

- 顶部“牌组”入口可创建、编辑、删除和浏览牌组，并显示每个牌组的 Meme 数量。
- Meme 详情中的“加入牌组”支持多选同步；取消勾选只移除关联，不会删除 Meme。
- 牌组内复用现有 Meme 卡片、详情、原图查看和下载能力，并提供明确的“从牌组移除”。
- 牌组是用户的快捷组织方式，不会转成 Tag，也不会令 Embedding 或 Enrichment 结果过期。
- 合并复合 Meme 时，Source 的牌组归属会迁移给 Target，并自动去重、保留已有 Target 位置。

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
python -m uvicorn app.main:app --env-file .env --reload --host 0.0.0.0 --port 8002
```

```powershell
npm.cmd --prefix frontend run dev
```

开发页面默认位于 <http://127.0.0.1:5173>。Vite 会把 `/api` 和 `/media` 代理到 <http://127.0.0.1:8002>。

如需使用其他后端地址，在 `frontend/.env` 中设置：

```dotenv
BACKEND_TARGET=http://127.0.0.1:8002
```

可以复制 [`frontend/.env.example`](frontend/.env.example) 作为起点。这个变量只配置 Vite 开发代理，不会进入浏览器构建产物。

### 生产构建

先构建前端，再启动或重启 FastAPI：

```powershell
npm.cmd --prefix frontend run build
python -m uvicorn app.main:app --env-file .env --host 0.0.0.0 --port 8002
```

`build` 会先执行 `tsc --noEmit` 类型检查，再执行 Vite 构建。只有 `frontend/dist/index.html` 存在时，FastAPI 才会在根路径托管网页；没有构建产物时，后端 API 仍可独立启动。

生产模式可访问：

- 网页管理台：<http://127.0.0.1:8002/>
- 手机投喂入口：<http://127.0.0.1:8002/mobile>（手机访问时把 `127.0.0.1` 替换为电脑的局域网 IPv4）
- 健康检查：<http://127.0.0.1:8002/api/health>
- Swagger API 文档：<http://127.0.0.1:8002/docs>

健康检查预期返回：

```json
{"status":"ok"}
```

## Public Deployment

Phase 4A/B 先完成 Quick Tunnel 冒烟与公网兼容性审计；Quick Tunnel 只用于人工验收，随机 `trycloudflare.com` 地址不得写入配置、数据库或前端。正式固定域名和 Named Tunnel 要在 Quick Tunnel 人工验收通过后再配置。

### 1. 配置生产环境

复制 [`.env.example`](.env.example) 为本地 `.env`，填写三个互不相同的长随机 Secret，并设置：

```dotenv
VISITOR_ACCESS_KEY=<visitor secret>
ADMIN_ACCESS_KEY=<admin secret>
SESSION_SECRET=<session signing secret>
MEME_VAULT_ENV=production
```

不要把 `.env`、Access Key、Session Secret、AI Provider Key 或 Cloudflare Tunnel Token 提交到 Git。Production 缺少任意一项 Access 配置时会直接拒绝启动；Production Session Cookie 保持 `Secure`、`HttpOnly` 和 `SameSite=Strict`。

### 2. 本地启动与检查

```powershell
npm.cmd --prefix frontend run build
python -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8002 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

先访问 <http://127.0.0.1:8002/api/health>。公网部署时不需要路由器端口转发，也不需要给 FastAPI 配置本地 TLS；Cloudflare 负责公网 HTTPS，cloudflared 到 Uvicorn 使用本机 HTTP。`--forwarded-allow-ips 127.0.0.1` 只信任同机 cloudflared 的代理头。

### 3. Quick Tunnel 测试

另开终端手动运行：

```powershell
cloudflared tunnel --url http://127.0.0.1:8002
```

使用生成的临时 HTTPS 地址完成 Access Gate、Visitor、Admin、原图/GIF、单图下载、Immersive、Infinite Feed 与 Focus Viewer 冒烟测试；还应让手机关闭 Wi-Fi 后通过 4G/5G 复验。Quick Tunnel 不用于正式发布，也不由 Meme Vault 自动创建或保存。

### 4. 正式 Tunnel（人工验收后）

在 Cloudflare Dashboard 创建 remotely-managed Named Tunnel 和 Published Application，把固定 hostname（例如 `meme.example.com`）映射到：

```text
http://127.0.0.1:8002
```

Cloudflare 登录、域名、DNS、Tunnel 创建、Connector Token 与可选 Windows Service 均由部署者在 Cloudflare 侧管理。仓库不读取或保存 Tunnel Token。公网只分享 `https://meme.example.com` 形式的地址。

### 5. Visitor / Admin 与 External API

Tunnel 不替代 Meme Vault Access Gate。Visitor 保持只读；Upload、Edit、Delete、Settings、批量 ZIP/Export 与 Swagger 仍是 Admin Only。Web UI、API 和媒体全部使用同源相对 URL，因此会自动跟随本地、Quick Tunnel 或正式域名 Origin。

当前 External Meme API 仍使用 Phase 3 的 Web Session 认证边界；同机消费者可以继续连接 `http://127.0.0.1:8002`，不要无意义绕行公网。面向独立机器客户端的独立凭据属于 Phase 4E，在完成前不要把浏览器 Access Key 写入脚本或 URL。

### 6. Troubleshooting

- 公网出现 `502`：确认 Uvicorn 正监听 `127.0.0.1:8002`，再确认 cloudflared 的 service URL 完全一致。
- 本地 HTTP 无法保留 Production 登录：`Secure` Cookie 只通过 HTTPS 发送；本地开发使用 `MEME_VAULT_ENV=development`，Production 验收使用 Tunnel HTTPS。
- 公网响应出现 `localhost`：停止验收并检查是否新增了绝对 URL；业务响应应返回 `/api/...` 或 `/media/...`。
- Visitor 得到 `403`：确认调用的不是 Admin-only mutation、批量导出或 Swagger；未登录应返回 `401`。
- Swagger 不可见：这是预期权限边界，只有 Admin Session 可以访问。

完整首轮审计结果见 [`docs/PHASE4_PUBLIC_DEPLOYMENT_AUDIT.md`](docs/PHASE4_PUBLIC_DEPLOYMENT_AUDIT.md)。

## 运行测试

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
python -m pytest -v
```

如果 PowerShell 允许执行 npm 脚本，也可以把 `npm.cmd` 简写为 `npm`。

Pytest 的临时文件统一写入项目根目录的 `.pytest_tmp/`，该目录已被 Git 忽略。

## Codex Luna 离线元数据整理

不调用 Meme Vault 在线 AI Provider 的本地整理入口：

```powershell
.\tagging.ps1
```

浏览器页面可按 10、20、50 条导出批次（默认 20）、按顺序预览完整图片组、复制 Luna 提示词，并把完成的候选直接提交到统一元数据审核池。候选可包含标题、描述、标签增删和已有模板名称。
Luna 导入不再区分 dry-run 与 apply，也不会直接修改 Meme；所有候选都会创建待审核 Suggestion，必须在网页“元数据整理”中人工选择字段并采用。完整说明见
[`docs/LUNA_TAGGING_WORKFLOW.md`](docs/LUNA_TAGGING_WORKFLOW.md)。

## TypeScript 前端

- App Shell 直接提供 Search、图片上传和 Immersive 核心入口；Random、批量下载与 Appearance 保留低权重直达入口，API 设置、模板、标签、元数据整理、场景召唤、宝库巡检等低频管理能力集中在二级菜单，原功能仍可访问。
- 左侧资料库使用服务端正式分页，显示筛选后的总数和总页数，并支持首页、末页、上一页、下一页、数字页码与输入页码跳转。
- 每页可显示 24、48 或 96 个 Meme，默认 24；卡片可切换超大、大、中、小四档响应式瀑布流密度。超大卡片直接显示原图，其余档使用缩略图。两项偏好保存在浏览器本地，卡片大小变化不会重新请求列表数据。
- 资料库可在默认顺序与稳定随机顺序间切换；同一乱序种子可连续翻页，点击“重新洗牌”会生成新排列。顶部“动图模式”仅展示 GIF，“随机一个”会沿用当前 GIF、标签和模板筛选。
- 网格卡片只显示首图封面；多图 Meme 会显示图片数量角标。
- 右侧详情面板按顺序纵向展示完整图片组，并提供追加、删除和拖拽排序；最后一张图片不能删除，排序后的第一张自动成为封面。
- 原图查看器可从任意图片打开，并通过按钮或左右方向键在当前图片组内切换。
- “相关 Meme”只显示手动建立的直接弱关联；添加对话框支持按标题/描述搜索、多选批量添加和单条移除。
- 搜索输入使用 300ms 防抖；多标签沿用后端的“同时包含全部标签”语义。
- 模板管理器保留完整模板 API，在浏览器中固定每页展示 12 条，支持前后翻页和输入页码跳转。
- 图片上传对话框支持拖入或选择多张图片、缩略图预览、上传前移除/清空，并把公共标签、模板和来源应用到每个独立 Meme；每张图片的标题默认取去掉扩展名的文件名，也可在上传前单独修改。
- Meme 编辑、普通批量上传和 ZIP 导入共用标签芯片编辑器；点击 `+` 后可用 Enter/Esc、失焦确认、删除按钮和最多 8 条已有标签建议，不再要求手动输入英文逗号。
- 批量队列严格串行；可在当前请求结束后暂停并继续，只重试失败项，重复图片按 HTTP 409 标记为跳过。
- 上传对话框可切换到 ZIP 模式：浏览器只上传一个压缩包且不渲染成员预览；任务创建后轮询持久化进度，关闭弹窗不影响后台执行，重新打开可恢复当前任务。
- ZIP 模式支持公共标签、模板、来源和 1～1000 的批次大小（默认 100）；失败明细分页显示，并可取消任务或只重试失败成员。
- 详情页可直接下载单张原图或含完整有序图片组与 `manifest.json` 的 ZIP；查看器“下载当前图”会随上一张/下一张同步更新。
- 顶部“批量下载”可导出全部或当前搜索/AND 标签筛选的服务器完整结果，并按扁平、模板或标签目录组织；不会只导出前端当前页的 Meme。
- 编辑表单可以选择已有模板；选择“无模板”会通过 JSON `null` 清除归类。
- 列表、批量上传、随机、保存和删除均提供独立的加载或错误反馈。
- 详情面板的 AI 分析和批量任务共用 `MemeEnrichmentService`，只生成统一 Suggestion；不会直接覆盖真实元数据。
- “元数据整理”工作台可按字段采用标题、描述、标签增删和已有模板建议，支持拒绝、重分析、来源/变更类型/过期过滤、快捷键及安全批量新增标签。
- 文案实验室在 Meme 详情页内默认折叠，支持手写、编辑、复制、删除多条独立文案，并在切换 Meme、折叠或离开页面前提醒未保存草稿。
- AI 可结合完整有序图片组、标题、描述、标签、模板及场景/语气/长度生成 3、5 或 8 条临时候选，也可润色、缩短、扩写或换一种语气；候选只有主动保存后才入库。

## 文案实验室

选择 Meme 后展开“文案实验室”即可使用统一编辑器。场景和语气既可选常用预设，也可自由输入；长度可选短、中、长。已保存文案按更新时间倒序显示，默认收起较早记录。

AI 灵感生成和草稿改写复用当前激活的视觉模型、厂商、密钥、超时和重试设置，不新增独立文案模型。AI 候选仅存在于当前页面状态：替换草稿不会自动保存，直接“保存为新文案”时来源记录为 `ai`；编辑已有文案则始终保留原来源。

## 模板管理与归类

点击顶部“模板管理”可查看、创建、编辑和删除模板。模板包含名称、可选描述和一张可选参考图；选择文件后左侧立即显示本地预览，已有模板在管理列表和编辑表单中显示参考图缩略图。配置独立的图像向量模型后，参考图会用于筛选视觉候选。上传或编辑 Meme 时可以选择一个已有模板；详情页显示当前模板或“未归类”。

使用 `qwen3-vl-embedding` 时，模板参考图会转换为 Base64 Data URI 并以独立图片向量请求百炼，不启用融合向量；同时保留旧 `tongyi-embedding-vision` 响应兼容。新建含参考图模板使用原子接口，图片向量化失败时会回滚数据库和文件，不产生空壳模板。

删除模板不会删除 Meme：相关 `Meme.template_id` 会在同一事务中清空，历史 AI 分析保留，但对应的 `suggested_template_id` 也会清空，避免悬空引用。

## 标签管理

顶部“标签管理”显示标签总数、使用中数量、空标签数量和每个标签的 Meme 使用数，并支持搜索、名称/使用数排序及全部/使用中/空标签筛选。标签可以重命名或合并；合并会把源标签关联转移到目标标签，冲突时按 `user/manual > codex > ai` 保留来源，同来源保留更高置信度，完成后删除源标签。

标签名称保留用户指定的显示大小写，并通过独立的 casefold 规范身份完成查找和去重。普通删除支持空标签和使用中的标签；后者会在明确确认后于同一事务中移除全部 MemeTag 关联、删除标签，并将受影响 Meme 的语义派生数据标记为过期。清理全部空标签仍需要两次确认，并且只在用户主动操作时执行。

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

默认回退模型面向低成本图片整理任务，可通过 `OPENAI_MODEL` 替换。应用不会隐式读取 `.env`，请使用 `uvicorn --env-file .env` 或由终端/部署环境注入；真实密钥不得提交到 Git。

内置预设参考厂商官方文档，并可通过在线刷新获取账号当前可用的模型：

- [OpenAI 模型列表](https://developers.openai.com/api/docs/models/all)
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models)
- [Qwen 视觉理解模型](https://help.aliyun.com/zh/model-studio/vision-model/)

分析分为两个阶段：

1. `POST /api/memes/{meme_id}/analyze` 按 position 顺序读取 Meme 的全部原图，在一次请求中把完整图片组、已有标签和模板候选交给模型，只生成一份组级描述、标签建议以及一个已有 `template_id` 或 `null`，但不修改 Meme。
2. 服务端再次校验 AI 返回的模板 ID 必须属于本次候选集合，并把它保存为分析快照。
3. `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm` 在一个事务中追加用户选中的标签，并可采用描述和用户最终选择的模板。

后端会优先提供已有标签给模型，并再次规范化输出：每次返回 2 至 8 个不重复标签。标签默认使用简体中文；常用外语专用表达、固定外语梗名，或使用外语才能更准确表达 Meme 含义时，会保留原外语标签。超时返回 504，未配置密钥返回 503，上游或响应格式错误返回 502。

## 语义索引、自然语言搜索与相似 Meme

先在“API 设置”中启用 DashScope `qwen3-vl-embedding`，勾选“支持图像与语义向量”，并将它设为当前向量模型。顶部“语义索引”打开独立管理器，可建立缺失与过期索引、重建全部索引、重试失败项、取消运行任务、查看失败明细和 Token 统计。任务关闭弹窗后继续运行，应用重启只会把残留运行任务标记为 `interrupted`，不会自动继续产生调用费用。

每个 Meme 的文档向量融合标题、描述、规范化标签、模板名称以及按 `position` 排序的图片。一次请求最多使用前 5 张图片；图片总数大于 5 时，索引记录同时保存实际参与数量与完整数量。图片优先读取缩略图，缺失时回退原图；处理 EXIF 方向，GIF 只取首帧，最大边缩至 1024，透明内容用 PNG，其余用 JPEG。不会在磁盘生成新的永久图片。

融合向量会先校验为 1024 维有限数值，再归一化并保存为连续小端 Float32 BLOB。向量与索引任务均保存在本地 SQLite，不保存大规模 JSON 向量；搜索时才由 NumPy 惰性加载当前模型的兼容 `ready` 向量到进程内只读矩阵，并用矩阵乘法计算余弦相似度。模板参考图原有 JSON 向量保持不变。

主搜索框可切换“关键词/语义”。关键词模式维持 300ms 防抖、稳定乱序和原有分页；语义模式只有按 Enter 或点击“语义搜索”才调用 Provider 生成查询向量，输入过程不产生费用。语义搜索可与当前标签做多标签 AND 筛选，支持 24/48/96 分页，卡片显示余弦 score（不是概率或准确率）。同一查询翻页会复用 10 分钟、最多 50 项的进程内 LRU 结果缓存；索引 generation 改变后旧结果自然失效。

以下操作会把已有向量标记为过期：修改标题、描述、标签或模板归属；追加、删除或排序图片；标签重命名或合并；模板重命名或删除。修改 `source`、Caption、直接关联、模板参考图、下载/导出以及未确认的 AI 分析不会使向量过期。普通保存事务只标记 `stale`，不会同步等待外部 API；请在索引管理器中重建或重试。新上传和 ZIP 导入的 Meme 没有向量记录，显示为待建立。

详情页“语义相似 Meme”与人工“直接关联 Meme”明确分开。相似推荐只比较已经保存的同模型、同维度融合向量，不调用 Provider；当前 Meme 未索引时由用户显式点击“为此 Meme 建立索引”，不会自动产生费用。

## 聊天场景推荐 Meme

点击顶部“场景召唤”，粘贴最近几句聊天，并可独立填写“你想怎么回应”。快捷意图只会填写回应意图，不会转换成标签过滤。服务端把回应意图优先放入 Scene Query，再调用现有 `SemanticSearchService` 和本地 `SemanticIndex`；第一批返回 12 条，点击“再来一批”按原语义排名读取后续分页，不随机打乱。

推荐卡片显示封面、标题、核心标签和相关度，并可打开 Meme 详情、原图查看器或直接下载。聊天文本只为本次查询发送给当前配置的 Embedding Provider：不写数据库、日志正文、localStorage 或 sessionStorage；关闭 Dialog 后会中止旧请求并清空输入与结果。本功能不调用 LLM、不重建 Meme 向量，也不会修改 Meme 元数据。

## 宝库巡检与复合 Meme 合并

顶部“宝库巡检”按最多 1000 个 Meme ID 的范围读取已有 ready/compatible 向量，并以这些 Meme 为源到整个当前 `SemanticIndex` 中寻找 Top K 相似项。候选按规范化 Pair 去重、排除持久化 Ignore，并按 score 降序展示。界面中的数值始终称为“语义相似度”；它不是重复概率，也不会触发 AI Provider、LLM、查询向量生成或自动 Embedding rebuild。

对每个 Pair，用户可以建立现有弱关联、忽略此对，或明确选择左/右侧作为主 Meme 执行二次确认 Merge。Merge 在单个数据库事务内把 Source 图片直接改归属并追加到 Target、合并标签来源优先级、迁移 Caption、规范化重连弱关联，然后删除 Source；不会复制、移动或删除图片文件。Target 的标题、描述、来源、模板、创建时间和首图保持不变，其旧 Embedding 标记为 `stale`，Source 的机器派生记录和 Ignore Pair 由 FK Cascade 清理。Merge 当前没有自动撤销，需在操作前确认。

## 数据库配置

默认数据库文件为 `data/meme_vault.db`，首次建立连接时自动生成。该文件已被 Git 忽略。

应用启动时会自动创建当前版本所需的数据表，包括原有业务表以及 `meme_embeddings`、`embedding_jobs` 和 `embedding_job_items`。升级只通过 `Base.metadata.create_all()` 增加缺失结构，不删除或重建已有表，不迁移模板 JSON 向量，也不会自动调用 Provider 生成真实业务向量。

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

所有接口均以 `/api` 开头，可在 <http://127.0.0.1:8002/docs> 使用 Swagger 操作：

- `POST /api/memes`：使用 multipart 表单上传图片及标题、描述、来源、标签和可选 `template_id`。
- `POST /api/import-jobs`：流式接收一个 ZIP 及公共元数据，持久化任务后立即返回 HTTP 202。
- `GET /api/import-jobs/{job_id}`、`GET /api/import-jobs/{job_id}/items`：读取任务进度和分页成员结果。
- `POST /api/import-jobs/{job_id}/cancel`、`POST /api/import-jobs/{job_id}/retry-failed`：取消或重试失败成员。
- `DELETE /api/import-jobs/{job_id}`：删除终态任务及其保留的临时 ZIP。
- `GET /api/memes/{meme_id}/download`：单图返回原图；复合 Meme 返回有序图片组 ZIP 和 manifest。
- `GET /api/memes/{meme_id}/images/{image_id}/download`：下载属于指定 Meme 的一张原图。
- `POST /api/export-jobs`：创建全部或完整筛选结果的持久化 ZIP 导出任务。
- `GET /api/export-jobs/{job_id}`、`GET /api/export-jobs/{job_id}/items`：读取导出进度和失败明细。
- `GET /api/export-jobs/{job_id}/download`：以磁盘文件流下载 ready ZIP。
- `POST /api/export-jobs/{job_id}/cancel`、`DELETE /api/export-jobs/{job_id}`：取消或删除导出任务。
- `GET /api/memes`：获取列表，支持搜索标题和描述的 `q`、分页参数 `offset`/`limit`、可重复的 `tags` 以及 `gif_only=true`。
- `GET /api/memes/page`：主资料库分页接口；支持 `page`、24/48/96 的 `page_size`、`q`、重复 `tags`、`gif_only=true`、`default`/`shuffle` 排序和稳定 `shuffle_seed`，并返回总数与总页数。原列表接口保持兼容。
- `GET /api/memes/random`：随机获取 Meme，可使用重复的 `tags`、模板及 `gif_only=true` 限定范围。
- `GET /api/memes/{meme_id}`：获取详情。
- `PATCH /api/memes/{meme_id}`：修改标题、描述、来源、标签数组或可空 `template_id`。
- `DELETE /api/memes/{meme_id}`：删除记录、原图和缩略图。
- `POST /api/memes/{meme_id}/images`：向现有 Meme 追加一张图片。
- `PATCH /api/memes/{meme_id}/images/order`：提交当前 Meme 的完整图片 ID 顺序。
- `DELETE /api/memes/{meme_id}/images/{image_id}`：删除一张图片；最后一张会被拒绝。
- `GET /api/memes/{meme_id}/relations`：获取直接关联的 Meme。
- `POST /api/memes/{meme_id}/relations`：用 `meme_ids` 数组批量添加双向直接关联。
- `DELETE /api/memes/{meme_id}/relations/{related_meme_id}`：移除一条直接关联。
- `GET /api/tags`：返回使用中的标签及 `usage_count`；`include_empty=true` 返回全部标签，并支持 `q` 与名称/使用数排序。
- `PATCH /api/tags/{tag_id}`、`POST /api/tags/{source_tag_id}/merge`：重命名或以单事务合并标签。
- `DELETE /api/tags/{tag_id}`、`POST /api/tags/cleanup-empty`：删除一个空标签或确认后批量清理全部空标签。
- `GET/POST /api/templates`：获取模板列表或创建模板。
- `POST /api/templates/with-reference-image`：原子创建模板、保存参考图并生成独立图片向量。
- `GET/PATCH/DELETE /api/templates/{template_id}`：获取、修改或删除模板。
- `POST /api/memes/{meme_id}/analyze`：生成并记录 AI 描述、标签和已有模板建议，不直接修改 Meme。
- `POST /api/memes/{meme_id}/analyses/{analysis_id}/confirm`：确认选中的 AI 标签，并可采用描述和最终模板选择。
- `GET/POST /api/memes/{meme_id}/captions`：读取当前 Meme 的文案或保存一条手写/AI 文案。
- `PATCH/DELETE /api/memes/{meme_id}/captions/{caption_id}`：编辑或删除属于当前 Meme 的文案。
- `POST /api/memes/{meme_id}/captions/generate`：基于完整图片组和可选元数据生成临时候选，不写数据库。
- `POST /api/memes/{meme_id}/captions/rewrite`：润色、缩短、扩写或换语气，不写数据库。

元数据整理 API：

- `POST /api/memes/{meme_id}/enrichment`：单项分析完整图片组并创建 Suggestion，不修改 Meme。
- `POST /api/enrichment-jobs` 及其查询、明细、取消、失败重试和删除接口：运行持久化 Provider 批量任务。
- `GET /api/enrichment-suggestions`：读取 Luna、Provider 和手动导入的统一审核池。
- `POST /api/enrichment-suggestions/{id}/apply|reject|reanalyze`：按字段安全采用、拒绝或重新分析。

语义相关 API：

- `GET /api/semantic-index/status`：返回总数、ready/missing/stale/failed/incompatible 统计、当前模型和运行任务摘要。
- `POST /api/embedding-jobs`、`GET /api/embedding-jobs/{id}`、`GET /api/embedding-jobs/{id}/items`：创建持久化索引任务并读取进度/明细。
- `POST /api/embedding-jobs/{id}/cancel`、`POST /api/embedding-jobs/{id}/retry-failed`、`DELETE /api/embedding-jobs/{id}`：取消、重试失败项或只删除任务记录。
- `POST /api/memes/{id}/embedding/rebuild`：只为单个 Meme 同步重建向量。
- `POST /api/semantic-search`：自然语言查询、标签 AND 筛选和 24/48/96 正式分页。
- `POST /api/meme-recommendations/chat`：接收必填聊天上下文、可选回应意图和 12 条分页参数，构造 Scene Query 后复用语义搜索；聊天正文不持久化。
- `POST /api/similarity-inspection`：按 Meme ID 范围即时生成全索引近似 Pair，不调用 Provider。
- `POST /api/meme-similarity-ignores`、`DELETE /api/meme-similarity-ignores/{a}/{b}`：持久化或撤销规范化 Ignore Pair。
- `POST /api/memes/{target_id}/merge`：将显式 Source 合并到 Target，并返回合并后的 Target。
- `GET /api/memes/{id}/similar?limit=12`：完全使用本地已保存向量返回相似 Meme。

## ZIP 导入的事务与清理

`POST /api/import-jobs` 以 1 MiB 块把上传流复制到 `data/import_archives/`，不会调用无参数的 `archive.read()`。后台先检查 ZIP 成员数、总解压体积和异常压缩比，再用 `zipfile` 逐项打开候选图片，不把整个压缩包解压到内存或目录。目录、系统垃圾、隐藏文件、非图片和嵌套压缩包被忽略；绝对路径和 `..` 成员记录为失败，不参与文件路径拼接。

每张图先复用 `ImageStorage.validate` 做大小、真实格式和 SHA-256 校验；查重发生在原图落盘和缩略图生成前。非重复项调用 `MemeService.create_meme_no_commit`，每项位于 SAVEPOINT 内，每 `chunk_size` 项提交外层事务。单项失败不会回滚同批其他项；外层批次提交失败时，整批数据库变更回滚，并按本批文件清单删除原图和缩略图。

无失败的完成任务和取消任务会删除临时 ZIP；含失败成员的完成任务暂时保留 ZIP，供 `retry-failed` 精确重读这些成员，任务删除或重试全部成功后再清理。

## 原图下载与批量 ZIP 导出

普通下载始终读取 `data/images/` 原图，不使用缩略图或 UUID 作为下载名。文件名会去除路径、控制字符、危险字符和 Windows 保留名；中文与空格通过标准 `Content-Disposition` 正常传递。复合 Meme 使用 `ZIP_STORED + Zip64` 写临时磁盘 ZIP，图片按 position 排序并附带标题、描述、来源、标签、模板、文件大小和 SHA-256 manifest。

批量导出先用短数据库查询固定全部匹配 Meme 的元数据快照，再释放查询事务并使用单线程后台执行器逐文件调用 `ZipFile.write()`。ZIP 先写入 `data/export_archives/*.part`，成功后原子改名；取消、失败和启动恢复会清理 `.part`。ready 或 `completed_with_errors` ZIP 默认保留 24 小时，过期或用户删除任务时清理。

创建任务前按实际目录组织方式估算输出：flat/template 每张原图一次，tag 按标签数复制，无标签写入“无标签”。tag 模式可能显著增大 ZIP；系统要求预计体积之外至少保留 512 MiB 可用空间，空间不足返回清晰错误，绝不会删除原图或缩略图。
- `/api/ai-settings/providers`：模型厂商的列表、新增、修改与删除。
- `/api/ai-settings/providers/{id}/test`：验证密钥和 `/models` 连接。
- `/api/ai-settings/providers/{id}/refresh-models`：同步厂商模型标识。
- `/api/ai-settings/models`：模型列表、新增、修改、删除与当前视觉模型选择。

Meme 响应使用有序 `images` 和 `image_count` 表示完整图片组；兼容字段 `image_url`、`thumbnail_url`、尺寸、哈希等始终对应第一张封面。响应不会返回服务器本地的 `file_path` 或 `thumbnail_path`。

如需使用其他数据库地址，可在启动应用前设置 `DATABASE_URL` 环境变量：

```powershell
$env:DATABASE_URL = "sqlite:///data/custom.db"
```

项目提供了 [`.env.example`](.env.example) 作为变量示例；根目录 `.env` 通过 `uvicorn --env-file .env` 加载，也可以由终端或部署环境设置变量。

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
