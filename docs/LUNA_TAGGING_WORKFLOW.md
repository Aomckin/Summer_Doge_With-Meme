# Luna 本地标签工作流

> v0.5.2 当前执行标准。

这套流程使用 Codex Luna 的本地图片查看能力生成候选，不调用 Meme Vault 配置的
Qwen、OpenAI 或其他在线 AI Provider，也不让 Luna 直接修改 SQLite。

## 最短使用方式

在仓库根目录运行：

```powershell
.\tagging.ps1
```

浏览器会打开 <http://127.0.0.1:8765>。页面可以：

- 选择批次并导出。
- 按 `position` 顺序显示每个 Meme 的完整图片组。
- 一键复制当前批次的 Luna 提示词。
- 一键运行候选校验和 dry-run。
- 复制导出、dry-run 和 apply 的 PowerShell 预设。

页面不提供 apply 按钮。真实写入仍要求用户在终端明确运行带 `--apply` 的命令。
已有批次不会被重新导出覆盖；返回页面选择该批次即可继续查看。

## 文件与数据流

默认每批按 `meme_id ASC` 导出 10 个 Meme：

```text
data/tagging_work/batch_0001/
  manifest.json
  candidates.jsonl
  candidate.schema.json
  tags.json
  image_paths.json
  audit_*.jsonl
```

```text
SQLite + 本地图片
  → 页面导出批次
  → Luna 按 position 查看完整图片组
  → Luna 只填写 candidates.jsonl
  → 页面校验 / dry-run
  → 用户复核
  → 显式 --apply
  → 自动备份 SQLite
  → Service / Repository 导入
  → audit_*.jsonl
```

## Luna 输出标准

每个 Meme 在 `candidates.jsonl` 中恰好占一行，字段必须与当前 Pydantic Schema
一致：

```json
{"meme_id": 101, "add_tags": ["无语", "吐槽"], "remove_tags": [], "confidence": 0.91, "reason": "完整图片组表达无语式吐槽。"}
```

规则：

- `meme_id` 必须来自当前 manifest。
- `add_tags` 只放当前没有的标签，优先复用 `tags.json`。
- `remove_tags` 只放明显错误的自动标签，禁止删除 `user` 或 `manual` 标签。
- `confidence` 必须在 0 到 1 之间。
- `reason` 用一两句话说明整组图片的判断依据。
- 多图 Meme 必须按 `position` 看完再判断。
- 不确定时少打或不打，不创建同义词和低信息标签。

当前 Schema 不包含旧文档中的 `proposed_new_tags`、`needs_review`、
`review_notes` 等字段；额外字段会被校验器拒绝。需要人工复核时，在最终报告中列出
`meme_id`，不要扩展 JSONL 格式。

## Luna 提示词

页面中的提示词来自
[`scripts/tag_maintenance/LUNA_PROMPT.txt`](../scripts/tag_maintenance/LUNA_PROMPT.txt)，
已经自动替换为当前批次绝对路径，可直接复制给 Codex Luna。

Luna 只负责查看图片和填写候选，禁止：

- 调用外部 AI API。
- 运行导入器或 `--apply`。
- 修改数据库、标题、描述、模板、关系、文案或 Provider 配置。
- 处理当前批次之外的 Meme。

## 写入保护

- 导入默认 dry-run。
- 候选格式、重复 ID、不存在的 Meme 和受保护标签删除都会被拒绝。
- 只有显式 `--apply` 才写数据库。
- apply 前自动创建 SQLite 一致性备份。
- 新增关联来源记录为 `codex`。
- 实际变化写入独立审计 JSONL。
- `data/tagging_work/`、图片、数据库和备份不得提交 Git。
