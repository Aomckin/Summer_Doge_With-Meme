# Codex 离线元数据整理

适用版本：Meme Vault v0.6.1。

这组脚本只读取本地 SQLite 和图片路径，不导入或调用 Meme Vault 的 AI client，
也不需要 Qwen、OpenAI 或其他第三方 API Key。它不会自动分析图片；导出的
`candidates.jsonl` 需要由任一本地 Agent 助手使用本地图片查看能力逐条填写。

## 最简入口

```powershell
.\run-tagging.ps1
```

该脚本启动仅监听 `127.0.0.1` 的本地页面并自动打开浏览器。页面提供导出、
按 position 排列的图片预览、PowerShell 命令预设、通用 Agent 提示词复制，以及把
候选直接提交到统一元数据审核池的入口。
原有的 `.\tagging.ps1` 仍可继续使用。

## 1. 导出批次

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export
```

默认旧式 CLI 仍按 `meme_id ASC` 导出 20 个 Meme。推荐直接指定闭区间 ID 范围，
范围内所有现有 Meme 会输出到所选批次目录，例如 `data/tagging_work/batch_0001/`：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export --start-id 100 --end-id 299 --batch 2
```

每个批次包含：

- `manifest.json`：标题、描述、有序图片组、当前标签、模板与来源。
- `candidates.jsonl`：每个 Meme 一行的候选模板。
- `candidate.schema.json`：候选行的 JSON Schema。
- `tags.json`：当前完整标签词典。
- `templates.json`：当前已有模板词典。
- `image_paths.json`：按 `meme_id` 和 `position` 提供的本地绝对路径映射。

通用本地 Agent 的可复制提示词维护在 [`AGENT_PROMPT.txt`](AGENT_PROMPT.txt)，详细边界见
[`docs/LUNA_TAGGING_WORKFLOW.md`](../../docs/LUNA_TAGGING_WORKFLOW.md)。

## 2. 填写并提交人工审核

每一行必须包含以下字段：

```json
{"meme_id":1,"suggested_title":null,"suggested_description":"两张图共同表达惊讶反应。","add_tags":["震惊"],"remove_tags":[],"suggested_template_name":null,"confidence":null,"reason":"完整图片组判断"}
```

标签名会去除首尾空白并转为小写。同一行不允许重复标签，也不允许同一标签
同时出现在新增与删除列表。

完成候选后运行一次导入命令：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance import .\data\tagging_work\batch_0001\candidates.jsonl
```

导入会先严格校验整批数据，再用一个数据库事务把所有有效候选创建为
`MemeEnrichmentSuggestion` 待审核项。它不修改 Meme，也不再提供 dry-run、
`--apply` 或备份阶段；请在网页“元数据整理”中逐字段采用。每次提交会写入独立的
`audit_*.jsonl`。v0.5.2 旧标签格式仍可读取，但同样只进入审核池。

默认禁止提交删除来源为 `user` 或 `manual` 的标签；该保护也会在网页实际采用时
再次执行。

## 3. 使用副本

也可对副本指定数据库和工作目录：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export `
  --database .\data\meme_vault-copy.db `
  --work-dir .\data\tagging_work-test
```

`data/tagging_work/` 已被 Git 忽略。不要把 manifest、图片路径、候选结果或审计
文件移出该目录后提交。
