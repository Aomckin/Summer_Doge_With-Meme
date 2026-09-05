# Token Map

表中“来源”指 Meme Vault 当前样式中的代表性规则，不表示目标项目必须复制该组件。

| Token / group | 当前值 | 主要来源 | 用途 | 跨项目 |
| --- | --- | --- | --- | --- |
| color-neutral | 9 个现有节点 | Page、Library、Panel、正文层级 | primitive 深色与文字层级 | 是 |
| color-accent | #e6ff4a、#b9d126、#111500 | Primary Button、active chip、focus | 强调色、active、强调色上的文字 | 是 |
| status primitives | danger #ff6174、success #9ee6bd、warning #ffc76d | Error/Toast、成功反馈、警告状态 | 状态反馈 | 是 |
| text | 由 neutral primitive 引用 | body、heading、muted metadata、disabled | 文本语义层级 | 是 |
| surface | page/card/panel/elevated/hover/active | App background、Library/Settings Panel、Popover | 容器与交互层级 | 是 |
| border | 1px、9% white、#414a5d | Button、Input、Card、Dialog | 默认与强调边框 | 是 |
| typography | 5 个字号、4 个权重名、3 个行高 | Display/Heading、body、metadata、正文块 | 字体和内容密度 | 是 |
| spacing | 0.25rem 至 3rem 的 7 个节点 | Shell、Toolbar、Card/Panel 内边距 | 间距节奏 | 是 |
| radius | 0.375rem 至 1.25rem、pill | Input、Button、Card、Panel、Chip | 形状层级 | 是 |
| shadow | 3 个现有 elevation 阴影 | Card、Panel、Modal/Focus | 浮层层级 | 是 |
| motion/easing | 120/180/280ms、2 条曲线 | Button/Input hover、Dialog、状态切换 | 安静快速的反馈节奏 | 是 |
| focus-ring | #b9d126、2px、2px offset | 全局控件 focus-visible | 键盘焦点语言 | 是 |
| control-height | 32/42/44px | chip、button/select、search input | 常用控件高度 | 是 |

## 兼容别名

frontend/src/styles/tokens.css 继续提供 surface-0、surface-raised、line、muted、accent、radius 等旧名称。它们映射到新的通用语义 token，以保持当前页面像素与交互不变。Life HUD 不需要复制这些别名。

## 不建议迁移的 Meme Vault 特例

| 规则 | 来源 / 用途 | 原因 |
| --- | --- | --- |
| card lift/tilt/follow/drunk variables | Meme Card Motion 与 drunk physics | 产品特效和运行时物理状态，不是基础视觉语言 |
| immersive variables | Infinite Feed、Free Gallery、Focus Viewer | 强依赖图库布局和响应式算法 |
| appearance variables、accent-rgb | 用户 Appearance 预设与背景调参 | 是 Meme Vault 的可配置主题实现，不是稳定 core token |
| Maker cyan selection (#55d8ff) | 图片图层选择/裁切辅助 | 编辑器工具态，不是通用品牌语义 |
| 大量 5/7/9/10/11/14/18px 局部值 | 老组件、密集工具栏、业务表单 | 角色依赖上下文，强行合并会引起间距或圆角漂移 |
| z-index 0–1000 | Card physics、Dialog、Toast、Viewer | 当前层级与具体 DOM/Top Layer 绑定，尚未形成安全的通用栈 |

## 现状与近似值

- 圆角同时存在 10px、11px、12px、14px、18px 和 rem token。12px 与 0.75rem 同值，其他值承担不同角色，本次没有强行替换。
- 常用间距集中在 8/10/12/14/16/18/20/24px，但历史工具界面仍有 3/5/6/7/9/11/15/22px。只导出已建立的 4/8/12/16/24/32/48px 节奏。
- 动画遗留以 140/150/160/180/280/300ms 为主；core 使用现有 120/180/280ms，Card Motion 的连续跟随和返回时间不应被普通 UI token 覆盖。
- 阴影除 3 个 core elevation 外，Card lift、focus、toast、overlay 仍有专用复合阴影；这些对当前交互状态有意义，未合并。
- mobile-ingest.css 使用独立暖色视觉和局部尺寸。warning primitive 与其值相同，但移动投喂页整体主题不属于可迁移 core。
