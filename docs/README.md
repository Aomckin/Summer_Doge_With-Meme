# Meme Vault 文档导航

按用途归类。判断当前实现以 [代码现状](CODEBASE_STATUS.md) 和实际代码为准；任务书、设计提案与历史交接不能单独作为已实现依据。

## 核心入口

这些文件保留原路径，供代理规则与维护脚本稳定引用。

| 文档 | 用途 |
| --- | --- |
| [CODEBASE_STATUS.md](CODEBASE_STATUS.md) | 已落地功能、主要模块及调用链。 |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | 长期路线与阶段进度。 |
| [LUNA_TAGGING_WORKFLOW.md](LUNA_TAGGING_WORKFLOW.md) | 本地 Agent 元数据候选、校验与安全导入流程。 |

## 使用与集成指南 · guides/

- [外部 Meme API](guides/external-api.md)：认证、端点、参数、媒体访问与错误语义。
- [Publisher 插件协议](publisher-plugin-api.md)涵盖发布包、配置、回执和小黑盒最小对接示例。
- 安装、启动和配置见 [项目 README](../README.md)。

## 设计提案 · design/

| 文档 | 说明 |
| --- | --- |
| [视觉设计与交互体验优化提案](design/VISUAL_DESIGN_OPPORTUNITIES.md) | 视觉方向参考，不代表所有提案均已实施。 |
| [v0.5 文案实验室设计](design/2026-07-31-caption-lab-design.md) | 文案实验室的历史产品设计。 |

## 版本任务书 · planning/

| 文档 | 说明 |
| --- | --- |
| [多仓库资产管理系统任务书](<planning/MemeVault 多仓库资产管理系统开发任务书.md>) | 多仓库系统的原始需求与开发范围。 |
| [v2.0.4 前端架构治理与体验优化](planning/v2.0.4_前端架构治理与体验优化任务书.md) | v2.0.4 前端专项任务书。 |
| [v2.1 前端视觉与交互优化](planning/v2.1_前端视觉与交互优化任务书.md) | 初始规划稿，保留当时范围和约束。 |
| [v2.2 Publisher Bridge](<planning/Meme Vault v2.2 开发任务书.md>) | 帖文工作台、发布包、适配协议与验收。 |

本地如有独立前端目录 `frontend-v2.1/`，其设计与验收资料分别为 `V2_1_CREATIVE.md`、`V2_1_ACCEPTANCE.md`。该实验工程不随本次文档归类提交，资料是否可用以本地目录为准。

## 权限与部署审计 · audits/

- [Phase 3 权限审计](audits/PHASE3_PERMISSION_AUDIT.md)：2026-08-21 的权限策略快照。
- [Phase 4A/B 公网部署审计](audits/PHASE4_PUBLIC_DEPLOYMENT_AUDIT.md)：2026-08-21 的部署边界与验收记录。

审计结论对应文档标注的版本和日期；当前行为仍需结合代码现状核对。

## 历史交接与反馈 · archive/

- [v0.4 完成交接](archive/V0.4_HANDOFF.md)
- [v1.0.1 Hotfix 交接](archive/NEXT_CONVERSATION_HANDOFF.md)
- [v1.0 Beta 反馈](archive/V1_BETA_FEEDBACK.md)

归档文件中的“当前版本”“下一步”等表述指记录当时的状态，不是新的执行指令或现行路线。

## 展示资源 · images/

README 使用的截图与演示视频，保留现有路径以兼容页面展示。

## 新增文档放置约定

指南放 guides/，设计讨论放 design/，版本任务书放 planning/，审计记录放 audits/，历史交接和反馈放 archive/。新增文档后在本页补充入口；更新现有事实优先修改核心文档，避免另建一份重复的“当前状态”。
