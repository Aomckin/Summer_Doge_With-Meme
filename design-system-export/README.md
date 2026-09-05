# Meme Vault Design Tokens

这是 Meme Vault Phase 2 视觉语言的可迁移基础层。它保留深色、安静、内容优先的 surface 层级，以荧光黄绿作为克制的交互强调，并使用紧凑间距、中等圆角、低干扰阴影和快速反馈动画。

本包提取现有规则，不是新的视觉重构。数值来自当前运行中的 Meme Vault；没有为了补齐色阶或规格而创造未使用的 token。

## Usage

将 tokens.css 复制到目标项目并在全局样式入口导入：

    @import "./tokens.css";

    .card {
      color: var(--text-primary);
      background: var(--surface-card);
      border: var(--border-width) solid var(--border-soft);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
    }

    .field:focus-visible {
      outline: var(--focus-ring-width) solid var(--focus-ring-color);
      outline-offset: var(--focus-ring-offset);
    }

tokens.json 是同一组值的机器可读表示，使用花括号路径表达引用。当前没有 Token Compiler；CSS 仍是浏览器直接消费的产物。

## Token Categories

- Primitive and semantic color
- Text and surface hierarchy
- Typography
- Spacing and radius
- Border and shadow
- Motion and easing
- Focus ring
- Repeated control heights

## Cross-project usage

Life HUD 最少复制 tokens.css；若需要工具链、主题生成或 Agent 可读上下文，同时复制 tokens.json。建议一并保留本 README 和 TOKEN_MAP.md，以便理解来源和迁移边界。

这个包不包含 Meme Vault 的业务组件、页面布局、Card Motion、Immersive Gallery、Appearance 调参或 Meme Maker 样式。目标是复制设计语言，而不是复制产品长相。

## Reduced motion

Motion token 只定义节奏。目标项目仍应在自己的全局样式中保留 reduced-motion 策略：

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

Meme Vault 的运行时源文件是 frontend/src/styles/tokens.css。导出文件是刻意保持独立的迁移快照；改变运行时 token 时，应同步更新本目录并运行前端测试。
