# Meme Vault v2.1 前端视觉与交互升级（创意动感版本）实施交付文档

本文档记录 Meme Vault v2.1 在前端独立预览副本 `frontend-v2.1` 中的完整实现方案。根据用户对前序保守版本的明确评审反馈（“错峰淡入有bug，实际刷新时只有第一行会错峰淡入。视觉更新整体太过于保守，没有感受到多少新东西。保持主体的同时增加动感和呼吸感，允许中高风险的改动，新版前端让gemini多去发挥创意，但不要动原本已经稳定的旧版代码”），本次交付全面克服了保守微调局限，在严格保持既有布局结构、深色沉浸画布、物理倾斜系统、每仓专属主题色和无侵入后端约束的前提下，落地了显著、灵动且具有高级呼吸感的全新交互与材质体验。

---

## 1. 核心视觉与交互创新（Design Review 落实）

本次实现带来了多项**肉眼可直接识别、层次分明且符合直觉**的视觉与动效革新：

### 1.1 悬浮晶岛顶栏与生动品牌标识（Floating Glass Island Topbar）
- **悬浮胶囊晶岛**：桌面端顶部导航栏（`.topbar`）打破原先通栏贴顶的僵硬形态，进化为悬浮式微倒角玻璃晶岛（`margin: 10px clamp(16px, 2.5vw, 40px) 0; border-radius: var(--radius-xl); backdrop-filter: blur(28px) saturate(160%)`）。
- **立体多层光影**：顶栏外边缘配有主题色弥散漫反射，内部嵌入细腻高光反光边缘（`inset 0 1px 0 0 rgb(255 255 255 / 14%)`），在用户向下滚动卡片瀑布流时，卡片从半透明晶岛后方掠过，展现丰富的层次深度。在移动端视口（`<= 680px`）自动无缝回归贴顶全宽布局。
- **品牌呼吸微标**：品牌 Logo（`.brand-mark`）加入微光脉冲发光（`box-shadow: 0 0 14px var(--accent-subtle)`）并在悬停时呈现柔和弹性缩放微交互；搜索框激活时呈现向外扩散的呼吸辉光光晕（Focus-within Aura）。

### 1.2 空间光标动态随动画布天光（Interactive Spatial Canvas Light）
- **核心体验**：在暗色沉浸的背景画布与瀑布流卡片间隙中，鼠标的精细移动会激发起一层柔和随动、富有景深感的径向光晕。这束空间微光以当前仓库的专属主题色（`--accent-rgb`）为能量基底，让深邃的画布如同具有感知生命的实体空间。
- **双层光效直达表层**：除了底层大范围漫反射外，在 `.library` 资料库容器表层直接融合了随鼠标联动的漫射光斑（Radial Surface Spotlight），彻底解决了用户真实仓库中因背景面板不透明度高（如 72%）导致纯底层天光被遮挡的问题。
- **用户设定绝对优先**：光晕强度严格与用户在外观设置中的滑块强度（`--appearance-glow-strength`）联动相乘。当用户将辉光滑块拉到 0 时，空间光强直接归零，绝不强制残留光晕，彻底根除前序版本中 `max(0.08, ...)` 篡改用户意图的问题。
- **完整生命周期与无障碍协同**：
  - 由独立的 `SpatialLightController` 驱动，仅在发生 `pointermove` 真实事件时调度单帧 `requestAnimationFrame` 更新 CSS 变量，完全避免常驻 JS 轮询动画循环，0 布局回流（Reflow）。
  - 内置 `MutationObserver` 监听根节点与网格的 `data-card-motion="off"` 属性变更，以及媒体查询监听 `(prefers-reduced-motion: reduce)` 变更。在检测到关闭动效或系统减弱动效时立即卸载监听并清除光斑；在外部信号触发或组件销毁（`destroy()`）时彻底清理所有监听器。

### 1.3 极光律动控制台与发光宝石微指示器（Aurora Rim Toolbar & Jewel Pips）
- **动态微流光边框**：资料库筛选工具栏（`.library-filter-toolbar`）与视图控制器采用晶雕微磨砂板体，并在外边框注入缓慢优雅穿行的极光流光（`@keyframes toolbar-light-rim`），流光采用遮罩合成渐变（Masked Gradient），使中控台在静止状态下依然散发若隐若现的科技生命力。
- **发光宝石指示器**：激活选中的标签 Chip（`.filter-chip.is-active`）不仅具备呼吸渐变底色，前端更点亮了一颗精致明亮的专属发光宝石微圆点（Jewel Indicator Pip），让当前处于筛选状态的条件一目了然。
- **磁吸悬浮微动效**：非减少动效模式下，悬停筛选 Chip 会触发轻微磁吸上浮（`translate: 0 -1px;`），提供明确的触控反弹暗示。

### 1.4 物理变换无冲突的独立层级瀑布流入场（Physics-Safe Cascade Entrance）
- **根除卡片物理属性冲突**：彻底抛弃在 `.meme-card` 根节点覆写 `transform` 属性的做法。采用现代标准独立的 CSS `translate` 与 `scale` 属性进行错峰淡入位移，使原本依赖 `transform: perspective(1000px) translate3d(...) rotateX(...) rotateY(...)` 的 3D 悬浮与醉酒物理倾斜系统不受任何属性重叠干扰。
- **彻底解决首屏刷新竞态 Bug（Refresh Race Fix）**：
  - **问题根因**：原先控制器在空网格创建并注册 `MutationObserver`，应用随后渲染卡片并调用 `trigger()`。然而微任务队列中 `MutationObserver` 的突变回调先于首帧 `requestAnimationFrame` 触发，导致突变监听器抢先将卡片标记为 delay=0 的已展示节点，从而破坏了首波错峰计划，导致只有首行或零星卡片有错峰。
  - **解决方案**：在 `handleGridMutations` 中增加判定，若首波阶梯 rAF 正在等待调度（`this.pendingRaf !== 0`），则突变监听器直接让渡给计划中的首波全视口测量；首波测量按实际视觉拓扑空间位置排序（顶部行优先、从左到右），计算全视口多行阶梯波浪延展（总延迟紧凑收敛在 300ms 阈值内）。
- **视口外平滑发现与动态追加**：
  - 视口外部卡片接入 `IntersectionObserver`，当用户向下滚动滚动条时，即将入场的卡片平滑错峰出现并立即解除监听；已入场卡片受 `WeakSet` 永久保护，向上回滚绝对不会重复触发淡入动效。
  - 动态追加（如后续加载）卡片在突变监听中经由 `observeAppendedCards` 自然分配微阶梯延迟，且具备防抖与首波保护超时安全机制。
- **代际安全与交互零阻碍**：
  - 加入 `generation` 代际身份守卫与节点连通性校验（`isConnected`），防止过期回调触碰脱落节点。
  - 用户在卡片入场期间将焦点移入（`focusin`）或将鼠标悬停在卡片上（`pointerenter`），控制器瞬间清除错峰状态，让物理悬浮与快捷操作毫无迟滞。

### 1.5 灵动卡片选中与详情平滑浮现（Spring Selection & Detail Reveal）
- **弹性选中徽章**：选中卡片时，右下角状态标（`.card-selected-indicator`）呈现弹簧回弹展开效果（`@keyframes indicator-pop`），配合柔和主题色辉光环，在 `data-card-motion="off"` 与减弱动效下纯静态显示。
- **详情面板丝滑入场**：右侧详情面板（`.library-detail`）激活展开时平滑滑入（`@keyframes detail-panel-slide-in`），并严格受动效开关管控。
- **全局投影阶梯恢复**：完整恢复并微调了 `--shadow-sm`、`--shadow-md`、`--shadow-lg` 阴影阶梯，避免下游样式中 `var()` 未解析问题。

---

## 2. 隔离副本与真实数据联调架构

- **工程根目录**：`E:/桌面/改变世界的魔法/暗苟，夏，Meme/frontend-v2.1`
- **服务端口与反向代理**：
  - 本预览工程独立运行于 Vite **端口 9002**。
  - `vite.config.ts` 已在 `server` 与 `preview` 中完整配置针对本地实际后端服务 **端口 8002** 的 `/api` 与 `/media` 反向代理，并开启 `strictPort: true`：
    ```ts
    server: {
      port: 9002,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8002",
        "/media": "http://127.0.0.1:8002",
      },
    },
    preview: {
      port: 9002,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8002",
        "/media": "http://127.0.0.1:8002",
      },
    },
    ```
  - 用户可在保持生产前端不受任何影响的前提下，使用真实已有的 Meme Vault 数据库、图片与配置进行真机端到端体验。
- **严守安全边界**：
  - 未触碰真实工作区任何后端文件、SQLite 数据库、`.env`、真实图片目录或 Git 历史。
  - `package.json` 保持版本号 `2.1.0`，名称配置为 `"meme-vault-frontend-v21-preview"`。
  - `node_modules` 仅为只读共享链接，无新增安装或依赖篡改。

---

## 3. 文件修改清单与职责映射

| 文件路径 | 职责与变更内容 |
| :--- | :--- |
| `src/cascade-entrance.ts` | 彻底修复首屏刷新竞态 Bug（Microtask MutationObserver vs rAF）；实现视口多行首波空间拓扑排序与阶梯延迟收敛；集成 `IntersectionObserver` 滚动抵达平滑入场；`revealedCards` 弱引用防止回滚重复播放；动态追加卡片平滑延迟观察；增加 `generation` 代际守卫与 `isConnected` 连通性过滤；增加 `focusin` 与 `pointerenter` 立即解除动画以响应物理倾斜；移除对全局 `dataset.documentHidden` 的侵入式副作用，直接使用 `document.hidden`。 |
| `src/spatial-light.ts` | 实现空间光标随动控制器与表层光效协同。监听精细指针焦点，在 rAF 周期内将坐标与激活状态输出到根节点 CSS 变量；内置 `MutationObserver` 监听 `data-card-motion` 与 `vaultMode` 变更以及 `prefers-reduced-motion` 媒体查询，实现动态关闭与恢复；完善的 `destroy()` 与 `AbortSignal` 清理机制。 |
| `src/card-tilt.ts` | 在 `applyCardMotionPreset` 与 `bindMemeCardTilts` 中同步将动效预设写入 `document.documentElement.dataset.cardMotion = preset`，使外部容器与控制器能全局精准感知动效开关状态。 |
| `src/app.ts` | 接入 `SpatialLightController`（声明、构造与生命周期销毁），绑定全局 `abortController.signal`。 |
| `src/styles/tokens.css` | 恢复并微调 `--shadow-sm`、`--shadow-md`、`--shadow-lg` 阴影阶梯；补充 `--motion-breath`、`--ease-spring`、`--ease-gentle`、`--card-rim-light` 等动效与光效 Tokens。 |
| `src/styles/appearance.css` | 修复辉光被 `max(0.08, ...)` 强行残留的 Bug，严格尊重用户滑块设定；空间光标动态天光层全面支持 `:root:has([data-card-motion="off"])` 与 `:root[data-card-motion="off"]` 停用规则；离焦与减弱动效时彻底隐藏。 |
| `src/styles/shell.css` | 桌面端悬浮胶囊晶岛顶栏（Floating Glass Island Topbar）；移动端平滑重置；品牌图标微光呼吸与悬停弹性微展；搜索框聚焦外溢环与深色辉光光晕（Focus-within Aura）。 |
| `src/styles/library.css` | 资料库表面光标聚光灯（Surface Spotlight）；控制台极光流光边框（`toolbar-light-rim`）；激活 Chip 发光宝石指示器与磁吸浮动；卡片入场动画使用独立 CSS `translate` 与 `scale` 保证物理 `transform` 完好；卡片选中弹性展开动画；详情面板平滑入场；全局 motion off 严格停用。 |
| `src/cascade-entrance.test.ts` | 修复 Mock 类的 `scrollMargin` 属性定义与 `makeIntersectionEntry` 类型断言；编写真实的 DOM 挂载追加卡片测试与全生命周期断言。 |
| `src/spatial-light.test.ts` | 新增针对 `SpatialLightController` 的全生命周期单元测试（rAF 坐标节流、移出失焦重置、可见性变化、减弱动效与动效开关响应、DOM 突变监听、清理与销毁）。 |
| `src/cascade-refresh-review.test.ts` | **完全保留 Codex 的 18 卡片 / 3 行首屏刷新回归测试**，验证首波测量在 MutationObserver 微任务并发下能正确分配多行阶梯延迟。 |
| `vite.config.ts` | 配置 `server` 与 `preview` 均监听 9002 端口，开启 `strictPort: true`，并配置针对 8002 真实后端的 API/Media 代理。 |
| `package.json` | 隔离包名称设为 `"meme-vault-frontend-v21-preview"`，版本 `2.1.0`。 |

---

## 4. 验证指南与验收要点

所有生产代码、样式与测试用例均已在隔离副本中编写完成。根据代理协作规则，终端命令、测试运行与构建统一由验收代理 Codex 负责执行：

```powershell
# 1. 类型检查
npm.cmd --prefix frontend-v2.1 run typecheck

# 2. 单元测试（包含全部核心模块与 Codex 刷新回归测试）
npm.cmd --prefix frontend-v2.1 test

# 3. 生产打包构建
npm.cmd --prefix frontend-v2.1 run build
```

### 建议的人工与浏览器验收项：
1. **真实数据联调预览**：在真实后端 8002 运行的状态下，在 `frontend-v2.1` 执行 `npm run dev`（或 `npm run preview`），打开 `http://localhost:9002`，验证真实 Meme 数据的渲染。
2. **多行错峰入场验证**：在页面卡片网格加载时，观察 18+ 张多行卡片按空间从上至下、从左向右梯次平滑展现（首行及后续各行均具备递增 delay），验证首屏刷新竞态已彻底修复。向下滚动时，视口外卡片抵达即入场；向上回滚不重复播放。
3. **顶栏晶岛与极光中控台**：观察桌面端悬浮胶囊顶栏的高透晶雕与内反射高光；观察筛选工具栏边框缓慢穿行的极光流光，以及选中标签左侧亮起的宝石绿/青发光微圆点。
4. **表面光标随动光斑**：在卡片缝隙移动鼠标，观察 `.library` 画布表层呈现的随动聚光灯。打开“外观”面板将辉光滑块拉至 0，确认所有辉光与随动光斑瞬间彻底关闭。
5. **动效关闭彻底性**：将卡片动效预设切换为“关闭”（`data-card-motion="off"`），观察随动光斑、入场错峰、选中回弹以及边框极光流光立即停用，完全回归纯静态响应。
6. **物理倾斜完好性**：悬停卡片，确认 3D 悬浮与醉酒物理倾斜效果灵敏无滞后，未发生任何 `transform` 属性覆盖。

## Codex 验收结果

最终实测与构建结果见 [V2_1_ACCEPTANCE.md](./V2_1_ACCEPTANCE.md)。

