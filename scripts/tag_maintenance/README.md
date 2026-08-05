# Codex 离线标签整理

适用版本：Meme Vault v0.5.2。

这组脚本只读取本地 SQLite 和图片路径，不导入或调用 Meme Vault 的 AI client，
也不需要 Qwen、OpenAI 或其他第三方 API Key。它不会自动分析图片；导出的
`candidates.jsonl` 需要由 Codex Luna 使用本地图片查看能力逐条填写。

## 最简入口

```powershell
.\tagging.ps1
```

该脚本启动仅监听 `127.0.0.1` 的本地页面并自动打开浏览器。页面提供导出、
按 position 排列的图片预览、PowerShell 命令预设、Luna 提示词复制和 dry-run。
为防止误操作，页面不提供 apply 按钮。

## 1. 导出批次

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export
```

默认按 `meme_id ASC` 排序，每批 10 个 Meme，并输出到
`data/tagging_work/batch_0001/`。指定批次和大小：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export --batch 2 --batch-size 10
```

每个批次包含：

- `manifest.json`：标题、描述、有序图片组、当前标签与来源。
- `candidates.jsonl`：每个 Meme 一行的候选模板。
- `candidate.schema.json`：候选行的 JSON Schema。
- `tags.json`：当前完整标签词典。
- `image_paths.json`：按 `meme_id` 和 `position` 提供的本地绝对路径映射。

Luna 的可复制提示词维护在 [`LUNA_PROMPT.txt`](LUNA_PROMPT.txt)，详细边界见
[`docs/LUNA_TAGGING_WORKFLOW.md`](../../docs/LUNA_TAGGING_WORKFLOW.md)。

## 2. 填写并校验候选

每一行必须包含以下字段：

```json
{"meme_id": 1, "add_tags": ["reaction"], "remove_tags": ["old-auto-tag"], "confidence": 0.92, "reason": "两张图共同表达惊讶反应"}
```

标签名会去除首尾空白并转为小写。同一行不允许重复标签，也不允许同一标签
同时出现在新增与删除列表。

不带 `--apply` 的导入永远是 dry-run，只做校验、预演和审计：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance import .\data\tagging_work\batch_0001\candidates.jsonl
```

默认禁止删除来源为 `user` 或 `manual` 的标签。只有明确复核后才能使用
`--allow-protected-removal` 覆盖保护；dry-run 和 apply 都执行同一规则。

## 3. 显式应用

确认 dry-run 的 `audit_*.jsonl` 后，才可显式执行：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance import .\data\tagging_work\batch_0001\candidates.jsonl --apply
```

apply 会在任何数据库写入前，把 SQLite 一致性备份写到
`data/tagging_work/backups/`。新增标签关联的来源为 `codex`，候选置信度会保存到
关联记录。每个实际变化写入该批次独立的 `audit_*.jsonl`。

也可对副本指定数据库和工作目录：

```powershell
.\.venv\Scripts\python.exe -m scripts.tag_maintenance export `
  --database .\data\meme_vault-copy.db `
  --work-dir .\data\tagging_work-test
```

`data/tagging_work/` 和数据库备份已被 Git 忽略。不要把 manifest、图片路径、
候选结果、审计文件或备份移出该目录后提交。
