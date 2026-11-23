# Meme Vault v2.1 前端视觉与交互优化交付记录

## 1. 实际落地功能 (v2.1.0)
- **Stage 1 质感精修**：卡片增加微内高光与悬停分层，管理菜单弹出框边框加固，右下角 Toast 调整为精致胶囊外形，弹窗保留既有 `dialog-enter` 打开过渡；保留原有毛玻璃参数与既有局部卡片选中机制。
- **Stage 2 滚动边缘渐隐**：筛选栏增加横向滚动双侧渐隐（`FilterScrollFadeController`），支持滚动即时响应、尺寸监听、脱离节点剪枝与 `:focus-within` 焦点保护。
- **Stage 3 级联瀑布入场**：普通视图瀑布流首屏/换页级联渐现（`CascadeEntranceController`），支持严格视觉几何排序、首批 12 张上限、静态降级与全覆盖动画清理。

## 2. 核心文件与职责
- `frontend/src/filter-scroll-fade.ts`：筛选栏边缘渐隐控制器，管理 ResizeObserver、滚动监听、脱离节点剪枝与属性契约。
- `frontend/src/cascade-entrance.ts`：级联入场动画控制器，负责 DOMRect 几何排序、延时写入与动画生命周期监听。
- `frontend/src/ui.ts` & `frontend/src/app.ts`：壳层组件挂载、列表重绘前主动取消动画、销毁释放与选中状态保持。
- `frontend/src/styles/{tokens,library,toast,shell,inspector-dialog}.css`：CSS 变量、卡片高光、右下胶囊 Toast 与遮罩样式。

## 3. 调用链与数据流
- **卡片选中**：`click` -> `app.selectMeme()` -> `renderMemeSelection()`，局部切换 `.is-selected` 与指示器，保持卡片 DOM 节点引用。
- **筛选遮罩**：滚动事件直接触发 `updateElement()` 即时测量；挂载/重渲染通过 `refresh()` 剪除失效节点并排队 rAF 测量，写入 `[data-overflow-*="true"]` 触发 CSS `mask-image`。
- **入场动画**：`reloadMemes()` -> `cascadeEntrance.trigger()` -> rAF 几何排序 -> 写入 `--card-stagger-delay` -> 触发 CSS 动画；列表数据重绘前调用 `cancel()` 清除状态。

## 4. 验证命令与实际结果
- `npm.cmd --prefix frontend run typecheck`：通过（0 错误）。
- `npm.cmd --prefix frontend test`：通过（43 文件 416 项全部通过）。
- `npm.cmd --prefix frontend run build`：通过（Vite 生产打包成功）。
- **环境安全**：前端 package 与 lock 根版本升至 2.1.0；未引入新依赖，后端/API/DB/真实数据未变动，原有未提交修改完整保留，未执行 commit/push。

## 5. 已知限制与延后范围
- **已知限制**：悬停遮罩闪现与图片占位抖动未复现，未宣称修复；跨浏览器/多设备正式性能验收未做。页面观察基线与候选均为 CLS 0.024、LongTasks 0，不构成正式性能保证。
- **延后范围**：背景环境微光律动、AI 流光、按压缩放及弹窗关闭过渡延后至后续版本。

## 6. 三个关键实现点
1. **DOM 引用保持与增量状态更新**：继承局部选中设计，不重构网格 DOM 树，卡片物理悬停与拖拽状态不中断。
2. **生命周期安全的遮罩更新机制**：滚动即时测量保证手感，重渲染通过 ResizeObserver 解绑已脱离 DOM 的旧节点，配合原生 `:focus-within` 保证键盘可访问性。
3. **严格几何排序与全流程取消守卫**：按真实视口 `top/left` 严格计算级联延时，在业务重渲染前统一 `cancel()` 并通过 AbortSignal/超时双重兜底。
