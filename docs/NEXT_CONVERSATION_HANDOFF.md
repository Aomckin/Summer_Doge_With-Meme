# Meme Vault v1.0.0 Phase 4A/B 交接说明

> 当前交接基线：v1.0 Phase 3 完成提交之上的 Phase 4A/B 工作区
>
> 最后更新：2026-08-21
>
> 目的：让新的开发对话不依赖旧聊天记录，也能从已完成的 Phase 3 与正在验收的 Phase 4A/B 安全接手。

## 1. 开始工作前的阅读顺序

1. 本文：恢复版本基线、冻结边界、关键状态和接手步骤。
2. [`CODEBASE_STATUS.md`](CODEBASE_STATUS.md)：确认当前代码已经具备什么，以及主要调用链。
3. [`PROJECT_PLAN.md`](PROJECT_PLAN.md)：了解长期路线；其中未勾选内容只是候选，不是自动授权的 Phase 3 Scope。
4. 与具体任务直接相关的模块和测试。

不要再使用旧的 v0.3.3 / v0.4 handoff 作为当前事实来源。它们只保留历史设计上下文。

## 2. 当前版本基线

| 项目 | 当前值 |
| --- | --- |
| 产品版本 | `v1.0.0 Phase 3` |
| 基线提交 | v1.0 Phase 3 完成提交（当前 `HEAD`） |
| 当前分支 | `codex/v1.0-phase3` |
| 后端 | Python + FastAPI + SQLAlchemy + SQLite + Pillow |
| 前端 | Vite + 原生 TypeScript + Vitest/jsdom |
| 前端包版本 | `1.0.0` |
| 主要部署形态 | 本地单进程、Admin 桌面管理、Visitor 小范围受邀访问 |
| 文件存储 | 本地 `data/images`、`data/thumbnails` 等目录 |

Phase 3 完成提交没有创建 Git Tag，也没有推送远端。正式发布前应由用户决定这些 Git 操作。

### 2.1 Phase 4A/B 当前状态

- 默认后端端口已统一为 `8002`，包括 README、Vite 开发代理、External API 文档和 Phase 4 任务书附件。
- Web API、媒体、下载、Viewer、Immersive 与 Infinite Feed 已确认使用同源相对 URL，没有客户端可见的 localhost 后端硬编码。
- Production Cookie、三项 Secret fail-fast、CORS、Swagger、静态媒体和日志已完成首轮审计与自动化复验。
- Quick Tunnel 保持人工工具；启动命令和验收矩阵见 [`PHASE4_PUBLIC_DEPLOYMENT_AUDIT.md`](PHASE4_PUBLIC_DEPLOYMENT_AUDIT.md)。
- 当前停点是等待用户执行 Quick Tunnel 真外网验收。验收通过前不要进入 Phase 4C，也不要代替用户操作 Cloudflare 账号、域名、DNS、Named Tunnel 或 Service。
- External API 当前仍复用 Web Session；独立机器认证明确留给 Phase 4E。

## 3. Phase 1 最终交付面

### 3.1 管理与检索

- 正式服务端分页固定为 24 / 48 / 96，默认 24。
- 关键词框支持 `4496`、`#4496`、`Meme 4496`、`meme #4496` 精确打开 Meme 详情。
- Tag 显示名与 `normalized_name` 规范身份分离；使用中 Tag 可事务性删除并触发派生数据失效。
- Template Selector 和主库 Template Filter 支持实时大小写不敏感子串搜索。
- Vault Inspector 支持 Whole Vault / ID Range Source Set、全局索引候选、Pair 去重、左右直接删除、Ignore、弱关联和 Merge。
- GIF 剪贴板只在浏览器真实支持原始 GIF 写入时成功，否则明确降级到下载。

### 3.2 Appearance

- `frontend/src/appearance/` 独立维护预设、设置校验、持久化、背景资源和设置 UI。
- 预设包括清爽、玻璃、亚克力、沉浸等既定风格；用户调节即时写入 CSS Variables。
- 普通设置存入 localStorage；自定义背景 Blob 存入 IndexedDB，Object URL 由 Controller 管理和释放。
- Appearance 只控制视觉变量，不改变 Meme 数据、筛选、分页或 Card Size。

### 3.3 Immersive Vault

- `ImmersiveController` 只切换 `document.documentElement.dataset.vaultMode`，不复制主资料库业务状态。
- Dock 支持搜索、上一页、下一页、当前已加载集合随机漫游、Appearance、Free Gallery 调参和退出。
- Immersive Random 不调用后端随机 API、不修改 selected Meme；它从当前已加载 Meme 中选取目标，平滑滚动并用非 transform 高亮。
- Immersive Media Loader 通过 `IntersectionObserver` 只升级 viewport 附近的原图/GIF，失败保留缩略图。
- Focus Viewer 移动真实 `.gallery-layout-item` 到独立高层，保留 GIF 播放连续性；Esc、点击自身或背景只关闭 Focus，不退出 Immersive。
- 多图 Focus 使用卡片内的 inert `<template data-focus-media-manifest>`，打开后按顺序生成纵向原图序列，关闭时删除临时节点并恢复原封面节点。

### 3.4 Free Gallery / Occupancy Grid

- Immersive 使用确定性的 Occupancy Grid，而不是随机 `margin` / `translate` 撒卡片。
- Density 改变候选位置偏好、安全间距和 Reserved Empty Region 概率，不通过偷偷修改卡片大小改变密度。
- 调参项集中为：密度、留白大小、横向自由度、顶部轮廓、边缘留白、背景参与感。
- 调参结果持久化；新增卡片走增量 append，已挂载卡片不应无故换位。
- Focus Viewer 临时移出卡片前调用 `beginTemporaryDetach()`，恢复后调用 `endTemporaryDetach()`；该协议保证原 placement 不被误判为删除。

### 3.5 Card Motion Feature Freeze

最终动态层：

```text
Motion Preset
× Card Size Multiplier
× Aspect Ratio Multiplier
+ Lift / Tilt / Magnetic Follow
+ drunk 档环境物理
```

- 五档：关闭、微弱、普通、强烈、喝了假酒；默认普通并由 localStorage 持久化。
- Card Size 的 translation multiplier：small `0.75`、medium `1`、large `1.5`、extra-large `2`。
- Card Size 的 rotation multiplier：small `0.85`、medium `1`、large `1.2`、extra-large `1.35`。
- 长宽比根据原始 width / height 连续衰减；极端长图保留 Lift，仅显著减弱 Tilt / Follow。
- Magnetic Follow 使用目标值 + rAF lerp，回到静止后停止帧循环。
- `DrunkPhysicsController` 只在 drunk 档启用，使用单一 rAF、viewport-near 集合和每卡独立 phase / speed / amplitude。
- 多图 Meme 使用封面原始尺寸参与完整动态系统。
- 触屏、coarse pointer 和 `prefers-reduced-motion: reduce` 继续禁用动态效果。

Card Motion 自 Phase 1 起 Feature Freeze。Phase 2 只允许缺陷修复、性能优化和可访问性修复，不再增加新特效、新物理层或新的 transform 竞争者。

### 3.6 Phase 2 整体视觉重构

- App Shell 已完成 Primary / Secondary / Management 分级：Search、Upload、Immersive 是核心入口，Random、Download、Appearance 保留低权重直达，低频管理功能进入二级菜单。
- Design System 已集中 Typography、Spacing、Radius、Surface、Border、Shadow、Button、Input、Motion 与 Easing Tokens，并继续兼容 Appearance 动态材质。
- Library Header、Template / Tag Toolbar、Tag Count、视图控制和 Card 视觉状态已统一；Card Physics 没有重写或叠加新的 transform 系统。
- Inspector 已按 Preview、内容、Metadata、Actions、Danger Zone 分组；Dialog、Popover、Backdrop 与危险操作使用统一层级。
- Immersive Dock、Focus Viewer、Infinite Loading / End State 完成视觉 Polish，Free Gallery、Infinite Feed、GIF 与原图行为保持原边界。
- Loading、Empty、Error、Toast、Disabled、Keyboard Focus、Reduced Motion、动态背景对比度和主要响应式断点集中处理。

### 3.7 Phase 3 Visitor / Admin Access Gate

- `app/auth.py` 集中维护环境配置、常量时间 Key 比较、不透明 Session Store、登录/身份/退出 API 与路由权限策略。
- 未认证业务 API 和四类私有媒体返回 401；Visitor 对 mutation、批量导出、管理 API、Mobile Ingest 和 Swagger 返回 403。
- Visitor 保留正常浏览、关键词/语义搜索、Similar、Random、Immersive、Infinite Feed、原图/GIF、Focus 与单图下载；复合 Meme ZIP 在后端按实际图片数再次拒绝。
- `frontend/src/auth.ts` 在 Vault 构造前完成身份 bootstrap；Access Gate 不预加载 Meme，登录/退出无需刷新，401 或媒体 Session 失效会回到 Gate。
- 前端使用集中 capabilities 保护 Upload 与 Batch Download command，并按 Role 收口 Header、Management、Inspector、Caption、Relation、Forge 等 mutation 入口；后端仍是最终安全边界。
- Session 当前保存在单进程内存中，服务重启后失效；这符合现有单进程架构，不代表多进程共享 Session。
- External Meme API 当前使用同一 Web Session 边界；Maibot 等机器客户端的独立凭据仍是后续单独设计项。

## 4. 前端关键代码地图

| 责任 | 文件 |
| --- | --- |
| App State、页面业务编排 | `frontend/src/app.ts` |
| Auth Bootstrap、Access Gate、Capabilities | `frontend/src/auth.ts` |
| App Shell 操作分级与二级菜单 | `frontend/src/app-shell.ts` |
| Shell 与 Meme Card Markup | `frontend/src/ui.ts` |
| Card Preset / Lift / Tilt / Follow | `frontend/src/card-tilt.ts` |
| Card Size Motion Multiplier | `frontend/src/card-motion-config.ts` |
| drunk 环境物理 | `frontend/src/drunk-physics.ts` |
| Appearance 状态与 CSS 变量 | `frontend/src/appearance/appearance-controller.ts` |
| Appearance 持久化 | `frontend/src/appearance/appearance-storage.ts` |
| Appearance 预设 | `frontend/src/appearance/appearance-presets.ts` |
| Immersive 模式与 Dock | `frontend/src/immersive/immersive-controller.ts` |
| Immersive Infinite Feed 请求状态机 | `frontend/src/immersive/immersive-feed.ts` |
| Immersive Random | `frontend/src/immersive/immersive-random.ts` |
| 原图/GIF 懒加载 | `frontend/src/immersive/immersive-media.ts` |
| Focus Viewer / 多图 Focus | `frontend/src/immersive/focus-viewer.ts` |
| Free Gallery 算法与 placement | `frontend/src/immersive/occupancy-grid.ts` |
| Free Gallery 调参 UI | `frontend/src/immersive/layout-tuner.ts` |
| Appearance 样式 | `frontend/src/styles/appearance.css` |
| Design Tokens | `frontend/src/styles/tokens.css` |
| App Shell 样式 | `frontend/src/styles/shell.css` |
| Library / Card 样式 | `frontend/src/styles/library.css` |
| Inspector / Dialog 样式 | `frontend/src/styles/inspector-dialog.css` |
| System States / Responsive / Accessibility | `frontend/src/styles/states.css` |
| Immersive / Focus / Free Gallery 样式 | `frontend/src/styles/immersive.css` |
| 卡片基础样式与 Motion Variables | `frontend/src/styles/main.css` |

每个上述核心模块都已有同目录或同名 `.test.ts`。修改前先读测试，新增行为要保持模块边界，不要把逻辑重新散回 `app.ts`。

## 5. 不得破坏的架构约束

### 5.1 Transform 分层

- Occupancy Grid 只设置 wrapper 的绝对位置和 `--gallery-*`，不得写 Meme Card transform。
- Lift / Tilt / Magnetic Follow 通过卡片 Motion Variables 合成。
- drunk 环境层使用自己的变量，不直接覆盖 Hover transform。
- Random Highlight 使用 outline / shadow / pseudo-element，不争夺 transform。
- Focused Card 暂停卡片物理并由 Focus Layer 控制位置与尺寸。

### 5.2 Focus 临时脱离协议

Focus 打开时移动真实卡片节点，这一点用于保持 GIF 和空间连续性。任何重构都必须保留以下顺序：

```text
记录原 rect / parent / sibling
→ OccupancyGrid.beginTemporaryDetach(item)
→ 移入 Focus Layer
→ 查看
→ 放回原 parent / sibling
→ OccupancyGrid.endTemporaryDetach(item)
```

不能删除这套协议并依赖 MutationObserver 猜测，否则关闭 Focus 会重新生成整张 Free Gallery。

### 5.3 多图与媒体生命周期

- 主库卡片仍只展示首图封面，不得把整组图片常驻到每张卡片 DOM。
- 完整图片组来自 `MemeResponse.images`，顺序以 `position` 为准。
- Focus manifest 必须保持 inert，不能在进入 Immersive 时一次性下载所有原图。
- 封面 `<img>` 在 Focus 中复用；其余图片只在 Focus 期间创建并由 `ensureOriginal()` 升级。
- 关闭 Focus 后必须回收临时图片节点；原图失败继续保留 thumbnail。

### 5.4 状态与布局

- 普通管理模式布局不得被 Immersive 专属参数污染。
- Card Size 是用户明确状态；Density 不能通过间接修改 Card Size 实现。
- Immersive Random 不修改搜索、标签、排序、页码或 selected Meme。
- Free Gallery append 新 Meme 时不得移动已有 placement；只有明确的尺寸、调参或 viewport 宽度变化才允许 rebuild。

## 6. 浏览器持久化键

| Key / Store | 内容 |
| --- | --- |
| `meme-vault.page-size` | 24 / 48 / 96 |
| `meme-vault.card-size` | small / medium / large / extra-large |
| `meme-vault.card-motion-preset` | off / subtle / normal / strong / drunk |
| `meme-vault:appearance:v1` | Appearance JSON 设置 |
| IndexedDB `meme-vault-appearance` / `assets` | 自定义背景资源 |
| `meme-vault.immersive-gallery-tuning` | Free Gallery 六项调参 |

Phase 2 如果修改持久化结构，必须提供兼容读取、sanitize 和默认值回退；不要直接复用旧 key 存入不兼容结构。

## 7. 后端与数据边界

- `MemeResponse.images` 是完整有序图片组；兼容字段 `image_url`、`thumbnail_url`、width / height 等继续投影自首图。
- 图片二进制保存在本地文件系统，不进入 SQLite。
- Meme / Tag / Template / 图片变化通过现有 Derived Data Invalidation 令语义派生数据失效；不要在普通写事务里直接调用外部 Provider。
- External Meme API 已纳入 Web Session 认证，但尚无独立机器 Access Key、速率限制或分享 Token。
- 当前没有用户账户数据库、租户、对象存储、云数据库或多进程 Session 同步。

更完整的数据模型、API 和事务调用链以 [`CODEBASE_STATUS.md`](CODEBASE_STATUS.md) 为准。

## 8. Phase 3 完成状态

Phase 2 的 Immersive Infinite Feed 与六阶段整体视觉重构继续保持冻结；Phase 3 权限系统已完成：

- 普通 Vault 继续正式分页，Immersive 使用独立 Feed Collection。
- Sentinel 以 `1000px` root margin 预加载下一批；loading guard、AbortController、generation、Error/Retry、Empty/End State 已落地。
- 新 Card 只 append；旧 DOM、Occupancy placement 与 Reserved Empty Booth 不重建。
- 新 Card 自动接入 Card Motion、Drunk Physics viewport registry、Original/GIF Media、Focus 和 Random。
- Dock 已移除上一页/下一页；退出后恢复普通页数据。
- App Shell、Design System、Library / Card、Inspector / Dialog、Immersive Polish 和 System States / Responsive 已依次完成。

Phase 2 Infinite Feed 的 2000+ Meme 性能验收继续有效。Phase 3 自动化覆盖 Visitor/Admin Login、Unauthenticated、Visitor Read/Write、媒体与 Swagger、Session/Logout、Role Switching 和复合 Meme ZIP 权限。

以下仍只是后续候选方向，不属于本轮 Scope：

- 用户账户系统、分享链接与机器客户端独立凭据。
- 对象存储、数据库迁移、备份与部署。
- 社交平台或聊天上下文接入。
- Inspector 后台任务化、聚类或治理工具。
- Forge 新一阶段，但不得默认扩张为专业图像编辑器。

开始某个方向前必须先写清：目标、现有调用链、数据迁移、性能预算、可访问性、测试矩阵、Non-Goals 和回滚方式。不要因为长期计划中存在某个未勾选项就同时展开多个方向。

## 9. 明确不应顺手扩大的 Scope

- 不新增 Card Motion 特效。
- 不把原生 TypeScript 前端顺手迁移到 React / Vue。
- 不把 SQLite、本地文件系统或单进程 Job 系统静默替换为云服务。
- 不把 Immersive Focus 改回普通 Modal。
- 不让所有 Immersive 原图/GIF 一次性加载。
- 不把多图 Meme 拆成多个独立 Meme，或把 ZIP Import 自动解释为复合 Meme。
- 不把语义相似度解释为重复概率。
- 不在没有迁移与备份方案时修改持久化 Schema。

## 10. 验证基线

Phase 3 完成门禁：

```text
TypeScript typecheck：通过
Vitest：37 files / 338 tests passed
Vite production build：通过
Pytest：264 tests passed
git diff --check：通过
```

标准完整验证命令：

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m pytest -q
git diff --check
```

生产页面由 FastAPI 托管 `frontend/dist`。前端源码变化后必须重新构建，单纯刷新浏览器不会更新旧产物。

## 11. Phase 3 完成后的新对话建议起手式

```text
请先阅读 README.md、docs/NEXT_CONVERSATION_HANDOFF.md、
docs/CODEBASE_STATUS.md 和 docs/PROJECT_PLAN.md。

当前基线是 Meme Vault v1.0.0 Phase 3 完成提交（当前 HEAD）。
Card Motion 已 Feature Freeze；Immersive Focus 必须保留 Occupancy Grid
临时脱离协议和多图/GIF 媒体生命周期。

Visitor/Admin Access Gate、Session、API/媒体权限审计与 Visitor 只读 UI 已完成；
External API 独立机器凭据、多进程 Session、用户账户与分享 Token 仍未实现。
Immersive Infinite Feed 与六阶段整体视觉重构继续保持冻结；2000+ 真实数据连续滚动性能验收已通过。
下一轮先由用户确定新的唯一主目标，不顺手展开其他候选方向。
```
