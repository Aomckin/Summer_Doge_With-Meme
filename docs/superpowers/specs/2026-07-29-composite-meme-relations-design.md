# Meme Vault v0.4 复合 Meme 与弱关联设计

## 目标

让一个 Meme 由一张或多张有固定顺序的图片组成，并在完整 Meme 之间提供手动、双向、非传递的弱关联；保留 v0.3.3 的上传、检索、模板和 AI 确认流程。

## 范围与约束

- 保持 FastAPI、SQLAlchemy、SQLite 与原生 TypeScript；不引入 Alembic 或前端框架。
- 上传入口继续一次只接收一张图片。新增图片只能追加至已有 Meme。
- 图片不能跨 Meme 复用；`file_hash` 在整个仓库唯一。
- 不保存 `is_composite`、强关联类型或独立封面状态。图片数量大于一即为复合 Meme，position 最小的图片为封面。
- 弱关联只保存直接边，不保存方向、原因、分组或 AI 推断。
- AI 对一个完整 Meme 只产生一条分析记录，且未经确认不改变 Meme 数据。

## 数据模型与迁移

新增 `MemeImage`：`id`、`meme_id`、图片文件元数据、`file_hash`、`position`、`created_at`。其中 `file_hash` 全局唯一，`(meme_id, position)` 唯一；`Meme.images` 以 position 升序加载并 delete-orphan 级联。

新增 `MemeRelation`：`id`、`meme_a_id`、`meme_b_id`、`created_at`，唯一约束为 `(meme_a_id, meme_b_id)`。服务层先排序两端 ID，拒绝相等 ID。

SQLite 启动迁移先创建两张新表，再为尚无 `MemeImage` 的每条旧 Meme 创建 position=0 的首图记录，复制旧图片字段。旧 `memes` 图片列暂时保留，只作为迁移兼容和首图投影：所有 v0.4 写操作都只修改 `MemeImage`，再由服务同步首图投影，因此没有两个可独立编辑的业务来源。迁移重复执行不会新增重复记录或移动文件。

## 后端调用链

`MemeService.create_meme` 先由现有存储层生成文件与缩略图，在同一事务创建 Meme 和一张 position=0 的 MemeImage，并写入兼容封面投影。

追加图片先保存并检查 SHA-256；数据库提交失败时回滚并删除新写的文件。删除图片拒绝最后一张；删除首图或排序后通过统一同步方法更新兼容封面。排序 API 要求完整且无重复的 image ID 集合，并在一次事务内重编号。删除完整 Meme 先提交数据库级联删除（含标签、AI 分析、图片和关系），再逐一清理图片文件；遵循当前项目对磁盘删除失败的明确错误处理。

关系批量添加先校验所有目标存在、去重并排除自身，再单事务插入缺失的规范化边。查询时筛选任一端为当前 Meme，并只返回另一端的直接 Meme 摘要。

新增 API：

- `POST /api/memes/{meme_id}/images`
- `DELETE /api/memes/{meme_id}/images/{image_id}`
- `PATCH /api/memes/{meme_id}/images/order`
- `GET /api/memes/{meme_id}/relations`
- `POST /api/memes/{meme_id}/relations`
- `DELETE /api/memes/{meme_id}/relations/{related_meme_id}`

所有 Meme 响应增加有序 `images` 与 `image_count`，现有 `image_url`、`thumbnail_url` 始终来自第一张。

## AI 多图请求

AIClient 改为接收 `images: Sequence[AIInputImage]`。单图仍传一个元素。服务层按 position 读取全部原图；Responses 请求按顺序写入带序号的 `input_text` 与 `input_image`，Chat Completions 同样写入 text 与 image_url 片段。系统提示明确这些图片是一组有序的完整 Meme，要求只输出一份组级描述、标签和模板匹配。

## 前端交互

卡片保留首图；只有 `image_count > 1` 时显示数量角标。详情页单图保持原布局，多图按 position 纵向呈现。图片管理区域支持单文件追加、HTML 拖拽排序、删除和封面标识；每次成功操作刷新详情与库中同一 Meme 卡片。

原图查看器状态改为图片 URL 数组和当前索引。点击详情内任意图片从该索引打开，左右按钮和方向键只在边界内切换；关闭时清空数组与索引。

详情页“相关 Meme”区域只渲染直接关系。添加弹窗在本地 Meme 列表中按标题/描述筛选，排除自身与已关联项，可多选并一次提交；每个关系有移除操作。

## 测试与文档

后端测试覆盖迁移幂等、全局哈希、图片 CRUD/排序/封面/清理、关系规范化与删除级联、两种 AI 请求的多图顺序。前端 Vitest 覆盖角标、首图卡片、详情顺序、图片管理、查看器导航和弱关联多选。

完成后更新 README、CODEBASE_STATUS、PROJECT_PLAN 与前端版本到 v0.4.0，并运行任务书指定的全部 npm 与 pytest 命令。PROJECT_PLAN 将原 v0.4 文案实验室顺延为 v0.5，后续语义搜索和制作器相应后移。
