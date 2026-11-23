# v2.1 新版前端验收记录

2026-10-18。Gemini 经 antigravity-cli-bridge 编写新版，Codex 负责隔离、审查、验收测试和运行预览。

## 结果与边界

预览：http://127.0.0.1:9002/ 。工程和构建分别位于 `frontend-v2.1/`、`frontend-v2.1/dist/`。

数据流：9002浏览器 → 新版API客户端 → Vite `/api`、`/media`代理 → 既有8002后端 → 既有真实仓库与图片。没有使用模拟业务API或另一套数据库。

旧 `frontend/` 保留本轮开始状态：源码、构建和入口配置共127个文件哈希全部一致。8002未重启，继续提供原构建 `main-cEtbd5SI.js`；9002提供新版 `main-DstcuyRr.js`。未修改后端、数据库、真实图片、Provider设置；已有未提交改动保留，没有分支、提交或推送。

复用现有node_modules，没有安装或升级依赖。新版目录的.gitignore排除依赖与生成产物。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/cascade-entrance.ts` | 全可视区域按几何顺序错峰；后续行滚动发现；新节点观察；防重复播放与过期回调；动态、可见性和减少动画偏好恢复。 |
| `src/spatial-light.ts` | 指针空间光，按需单帧更新；关闭动态、隐藏、沉浸和减少动画时停用，销毁清理。 |
| `src/app.ts`、`src/card-tilt.ts` | 控制器接入和动态模式同步；物理矩阵计算保留。 |
| `src/styles/{shell,library,appearance,tokens}.css` | 悬浮玻璃顶栏、流动光边筛选台、表面随动光、背景呼吸和选中反馈。 |
| `src/cascade-entrance.test.ts`、`src/spatial-light.test.ts`、`src/app.test.ts` | 控制器、偏好恢复及原有交互回归。 |
| `src/cascade-refresh-review.test.ts` | Codex验收回归：空网格构造→渲染→观察器微任务→首帧，验证18张卡片三行递增延迟。 |
| `vite.config.ts` | 9002严格端口、独立输出、真实8002代理；dev与preview均配置。 |

## 三个关键实现点

1. 原实现仅扫描一次当前视口并截断12张。新版持续观察后续行，WeakSet防止同一节点回滚重播，代次拒绝过期回调；另修复MutationObserver抢在首帧前把延迟归零的刷新竞态。
2. 卡片入场使用独立CSS translate和scale，保留物理引擎的transform；聚焦和悬停可立即解除入场。关闭后开启、标签页重新可见、减少动画关闭后会重新观察。
3. 新旧前端源码与构建隔离，共用现有后端；API客户端构建块仍为 `api-Co575M9I.js`，无需修改持久化逻辑。

## 实际验证

- `npm.cmd --prefix frontend-v2.1 run typecheck`：通过。
- `npm.cmd --prefix frontend-v2.1 test`：45个文件、431项测试全部通过。
- `npm.cmd --prefix frontend-v2.1 run build`：通过。
- 源码差异无空白错误报告（允许CRLF），原版127个冻结文件哈希一致。
- 9002首页和/api/health为HTTP200；未登录/api/vaults为HTTP401；8002仍提供原构建。
- 本地访客身份浏览真实仓库：8815个Meme，当前页24张图片正常；选择和详情正常，控制台无错误。未执行删除、保存、批量写入、AI分析或外部Provider请求。
- 真实页面关闭动态后，背景和筛选光边的animation-name均为none，指针激活值0；恢复普通后对应动画恢复。恢复观察路径另有回归覆盖。
- 1352px窗口与375px窄屏无横向溢出；窄屏扣除滚动条后内容宽360px。已恢复默认窗口和原“普通”动态模式。

## 重启预览

已有8002服务运行、9002未被其他应用占用时：

```powershell
npm.cmd --prefix frontend-v2.1 run build
npm.cmd --prefix frontend-v2.1 run preview -- --host 127.0.0.1 --port 9002 --strictPort
```

## 验证范围

浏览器实测为当前内置Chromium。其他浏览器、低端设备、60/120FPS尚未专项测量。本轮没有后端修改，未运行后端Pytest。设计方向见 `V2_1_CREATIVE.md`；本文件记录实际验收结果。
