# Luna 本地元数据工作流

> v0.6.1 当前执行标准。

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
- 一键校验候选并提交到“元数据整理”审核池。
- 复制导出和提交人工审核的 PowerShell 预设。

提交操作只创建待审核 Suggestion，不会修改 Meme。真实元数据只能在 Meme Vault
网页“元数据整理”中由用户选择字段并采用。
已有批次不会被重新导出覆盖；返回页面选择该批次即可继续查看。

## 文件与数据流

默认每批按 `meme_id ASC` 导出 20 个 Meme；页面允许 10、20、50：

```text
data/tagging_work/batch_0001/
  manifest.json
  candidates.jsonl
  candidate.schema.json
  tags.json
  templates.json
  image_paths.json
  audit_*.jsonl
```

```text
SQLite + 本地图片
  → 页面导出批次
  → Luna 按 position 查看完整图片组
  → Luna 只填写 candidates.jsonl
  → 页面或 CLI 校验并提交
  → MemeEnrichmentService / Repository 创建 pending Suggestion
  → audit_*.jsonl
  → 网页“元数据整理”人工审核
  → 按字段采用后才修改 Meme
```

## Luna 输出标准

每个 Meme 在 `candidates.jsonl` 中恰好占一行，字段必须与当前 Pydantic Schema
一致：

```json
{"meme_id":101,"suggested_title":null,"suggested_description":"角色陷入明显茫然。","add_tags":["无语"],"remove_tags":[],"suggested_template_name":null,"confidence":null,"reason":"完整图片组表达无语反应。"}
```

规则：

- `meme_id` 必须来自当前 manifest。
- `add_tags` 只放当前没有的标签，优先复用 `tags.json`。
- `remove_tags` 只放明显错误的自动标签，禁止删除 `user` 或 `manual` 标签。
- `confidence` 可为 null；可靠时可按字段给出 0 到 1 的数值。
- `reason` 用一两句话说明整组图片的判断依据。
- 多图 Meme 必须按 `position` 看完再判断。
- 不确定时少打或不打，不创建同义词和低信息标签。

标题、描述合理时返回 null；模板只能使用 `templates.json` 中的已有名称。需要人工复核时，在最终报告中列出 `meme_id`，不要扩展 JSONL 格式。

## Luna 提示词

页面中的提示词来自
[`scripts/tag_maintenance/LUNA_PROMPT.txt`](../scripts/tag_maintenance/LUNA_PROMPT.txt)，
已经自动替换为当前批次绝对路径，可直接复制给 Codex Luna。

Luna 只负责查看图片和填写候选，禁止：

- 调用外部 AI API。
- 运行导入器或直接修改数据库。
- 修改数据库、关系、文案或 Provider 配置；标题、描述、标签和模板只能写成候选。
- 处理当前批次之外的 Meme。

## 审核保护

- 候选格式、重复 ID、不存在的 Meme 和受保护标签删除都会被拒绝。
- 导入命令统一把候选写入 `MemeEnrichmentSuggestion`，不提供 dry-run 或 CLI apply。
- 整批候选在一个事务中创建；失败会回滚，不留下部分审核项。
- 新旧两种 Luna JSONL 都只创建待审核 Suggestion，不直接修改 Meme。
- 真正的数据写入在网页审核台按字段采用，并记录数据库审计。
- `data/tagging_work/`、图片、数据库和审计文件不得提交 Git。
