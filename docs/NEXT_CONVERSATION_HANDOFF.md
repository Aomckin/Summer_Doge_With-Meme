# Meme Vault v0.3.3：下个对话交接说明

> 历史说明：本文保留 v0.3.3 发布上下文。当前 v0.4.0 状态请以
> [`V0.4_HANDOFF.md`](V0.4_HANDOFF.md) 和
> [`CODEBASE_STATUS.md`](CODEBASE_STATUS.md) 为准。

> 目的：让新的 Codex 对话在不重读完整历史的情况下，快速恢复当前项目状态。
>
> 最后更新：2026-07-29。本文以当前 `main` 为准；旧的 `docs/CODEBASE_STATUS.md` 有部分 v0.3.3 前的过期描述，不应作为模板视觉检索功能的依据。

## 1. 当前交付状态

- 当前分支：`main`，工作区干净。
- v0.3.3 功能的最新提交：`1af3ae5 fix: configure template visual retrieval models`。
- 已推送 GitHub，并已发布正式版本 [v0.3.3](https://github.com/Aomckin/Summer_Doge_With-Meme/releases/tag/v0.3.3)。
- v0.3.3 的核心目标已经落地：每个模板可选绑定 **一张** 原始参考图；AI 分析 Meme 时，应以参考图的视觉结构为主判断模板，而不是仅依赖自然语言描述。

## 2. 已实现的模板视觉检索链路

```text
模板参考图上传
  -> 本地保存原图和缩略图
  -> 调用云端图像向量 API
  -> 在 templates 保存向量 JSON 与向量模型标识

分析 Meme
  -> 用同一激活向量模型为待分析 Meme 生成向量
  -> 只在模型标识相同的模板向量中计算余弦相似度
  -> 取相似度最高的 Top-10（常量为 10）参考图
  -> 将这 10 张模板缩略图连同文本候选传给图片分析模型
  -> AI 仅从提供的模板候选中返回 template_id 或 null
  -> 用户确认后才实际写入 Meme 模板归属
```

关键原则：

- SHA-256 仅用于文件标识/缓存失效，不用于语义相似度。
- 无参考图模板仍是合法的“描述分类模板”，例如“纯社交软件聊天截图”；它们以名称和描述作为候选，不被视觉相似度伪装成特定原图模板。
- 本地不跑 CLIP 或其他向量模型；向量计算走远端 API，适合无 CUDA/AMD 显卡的环境。
- 当前只支持每模板一张参考图。

## 3. 用户实际配置步骤

1. 在前端点击 **API 设置** → **模型厂商** → **添加厂商**。
2. 选择预设“阿里云百炼图像向量”，填入百炼 API Key，保持启用。
3. 切到 **模型列表**，找到 `Multimodal Embedding V1`，点击 **用于模板视觉检索**。
4. 原有 Qwen / OpenAI 视觉模型仍点击 **用于图片分析**；它与向量模型是两套独立的激活状态，不能互相替代。
5. 打开模板管理，创建或编辑模板时选择“参考原图”并保存。上传成功会生成并持久化向量。

常见误解：截图里标为“当前分析模型”的 Qwen3.6 Plus 不是向量模型；它负责最终看 Meme 和候选参考图。`multimodal-embedding-v1` 只负责把图片转换为向量、筛选 Top-10。

## 4. 关键代码地图

| 责任 | 位置 |
| --- | --- |
| 模板参考图字段 | `app/models/template.py` |
| 向量模型能力与激活状态 | `app/models/ai_settings.py` |
| 旧 SQLite 自动补列 | `app/database.py` |
| 参考图本地存储 | `app/storage/template_image_storage.py` |
| 图像向量客户端（百炼） | `app/ai/embedding_client.py` |
| 百炼向量预设 | `app/ai/presets.py` |
| API 设置服务/独立激活逻辑 | `app/services/ai_settings_service.py` |
| 模板图上传、删除和持久化 | `app/services/template_service.py`、`app/api/templates.py` |
| 余弦排序与 Top-10 | `app/services/template_matching.py` |
| 分析时组合视觉/文字模板候选 | `app/services/meme_service.py` |
| 向视觉 LLM 发送参考缩略图 | `app/ai/client.py` |
| 前端 API 设置 | `frontend/src/settings.ts`、`frontend/src/ui.ts`、`frontend/src/types.ts` |
| 前端模板参考图上传 | `frontend/src/app.ts`、`frontend/src/api.ts`、`frontend/src/ui.ts` |

重要配置和存储位置：

- 原始参考图：`data/template_images/`
- 参考缩略图：`data/template_thumbnails/`
- 静态访问前缀：`/media/template-images/`、`/media/template-thumbnails/`
- API Key 加密密钥：`data/.ai_settings.key`（被 Git 忽略）
- 数据库：默认 `data/meme_vault.db`（被 Git 忽略）

## 5. 最近修复（必须保留）

提交 `1af3ae5` 修复了一个前后端契约遗漏：后端早已支持 `supports_image_embedding` 和 `is_embedding_active`，前端却没有显示/配置入口。

目前模型卡片会：

- 以“支持视觉”标识图片分析能力；
- 以“模板视觉检索”标识图像向量能力；
- 分别提供“用于图片分析”和“用于模板视觉检索”；
- 支持 `DashScope 多模态向量`协议；
- 在手动添加模型时可勾选“支持模板视觉检索向量”。

同时，禁用一个模型厂商会清除该厂商所有模型的 `is_active` 和 `is_embedding_active`，防止禁用的向量模型仍被误认为可用。

## 6. 已知缺口与后续优先项

以下是已经设计过、但当前实现仍未完整覆盖的事项；后续工作应先确认用户是否要做：

1. **分析可用性反馈不完整**：向量模型未配置或调用失败时，`/api/memes/{id}/analyze` 会降级为文字候选，但前端没有明确显示“视觉模板匹配暂不可用”。
2. **提示词缓存未真正实现**：设计文档提到稳定缓存键/响应缓存；当前客户端只按固定顺序传图，没有实际发送缓存键或记录缓存 token 用量。
3. **模板参考图删除入口缺失**：后端已有 `DELETE /api/templates/{id}/reference-image` 和前端 API 函数，但模板管理界面没有明确的“移除参考图”按钮。再次选择文件并保存可覆盖参考图。
4. **上传失败的文件清理**：`TemplateService.set_reference_image()` 中，图片写入后若向量 API 在事务保护之前失败，可能遗留新文件；应补原子性测试并在异常路径清理。
5. **坏向量容错**：分析时若数据库已有损坏的 `reference_embedding_json`，目前可能使分析失败；更稳妥的行为是忽略坏向量，继续文字降级。
6. **向量连通性测试入口**：API 设置目前的“测试”仍是提供商 `/models` 测试，不是实际 embedding endpoint 测试；如需更可靠的配置体验，应添加模型级 `test-embedding`。

不要把以上缺口误说成 v0.3.3 已完全具备的能力。

## 7. 验证基线与常用命令

v0.3.3 发布前已运行并通过：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
# 88 passed

npm.cmd --prefix frontend test
# 35 passed

npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
git diff --check
```

开发启动时：

```powershell
# 后端
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8002

# 前端
npm.cmd --prefix frontend run dev
```

注意 Vite 默认的 `BACKEND_TARGET` 可能是 `http://127.0.0.1:8000`；如果后端使用 8002，请在 `frontend/.env` 设定：

```text
BACKEND_TARGET=http://127.0.0.1:8002
```

前端源码改动后要执行 `npm.cmd --prefix frontend run build`，FastAPI 托管的生产页面才会更新。

## 8. 新对话建议起手式

> 请先阅读 `docs/NEXT_CONVERSATION_HANDOFF.md`。项目当前在 `main`，已发布 v0.3.3。模板支持单张参考图和百炼图像向量 Top-10 检索；请先确认 API 设置中已分别配置图片分析模型与模板视觉检索模型。若继续开发，请优先处理本文“已知缺口与后续优先项”，并遵循测试先行。
