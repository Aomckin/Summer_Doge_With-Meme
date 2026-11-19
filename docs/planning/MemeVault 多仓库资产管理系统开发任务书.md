# MemeVault 多仓库图片资产管理系统开发任务书

## 1. 项目背景

当前 MemeVault 已具备较成熟的本地图片资产管理能力，包括图片导入、浏览、去重、描述、语义搜索、向量检索、随机图片及外部接口等功能。

目前系统整体仍以“一个 Meme 图片仓库”为核心假设。

随着实际使用范围扩大，希望在不复制多套项目、不破坏 MemeVault 现有功能的前提下，将底层图片资产管理能力扩展为：

> 一个应用管理多个相互独立的图片仓库。

未来可用于管理：

- Meme / 梗图；
- 二次元图片；
- 生活照片；
- 游戏截图；
- maimai 等游戏成绩图；
- 壁纸；
- 项目截图；
- 其他个人图片资产。

本阶段重点不是把 MemeVault 完全改造成通用 NAS 或相册软件，而是：

> 抽离当前系统中的“单 Meme 仓库假设”，建立可靠的多仓库基础架构。

---

# 2. 核心目标

实现：

```text
一个 MemeVault 实例
        ↓
多个独立 Vault
        ↓
各自管理自己的图片、元数据、索引及配置
```

示例：

```text
MemeVault

├─ Meme
│  └─ 梗图
│
├─ Anime
│  └─ 二次元图片
│
├─ Life
│  └─ 生活照片
│
└─ Maimai
   └─ 游戏成绩图
```

不同 Vault 必须做到：

- 图片资源互相隔离；
- 搜索结果互相隔离；
- 向量索引互相隔离；
- 标签与描述互相隔离；
- 去重默认只在当前 Vault 中进行；
- 删除、移动、批量操作不得影响其他 Vault；
- API 可以明确指定访问哪个 Vault。

---

# 3. 设计原则

## 3.1 保留 MemeVault 作为产品主体

本次开发不新建另一套“Photo Vault”项目。

继续复用当前 MemeVault：

```text
Summer_Doge_With-Meme
```

现有 Meme 能力作为默认仓库继续存在。

即：

```text
旧：

MemeVault
→ Meme 图片管理

新：

MemeVault
→ Vault 管理
    → Meme
    → Anime
    → Life
    → Maimai
```

原有 Meme 使用体验不应发生明显退化。

---

# 4. Vault 核心模型

新增一级实体：

```text
Vault
```

建议基本字段：

```text
id
name
slug
type
description
storage_path
created_at
updated_at
config
```

示例：

```json
{
  "id": 1,
  "name": "暗苟，夏，Meme",
  "slug": "meme",
  "type": "meme",
  "description": "Meme 主仓库",
  "storage_path": "data/meme"
}
```

其他示例：

```text
anime
life
maimai
wallpaper
screenshots
```

其中：

### name

用于前端显示：

```text
暗苟，夏，Meme
二次元收藏
生活相册
舞萌战绩
```

### slug

用于：

```text
URL
API
文件目录
内部标识
```

例如：

```text
meme
anime
life
maimai
```

Slug 创建后原则上避免频繁修改。

---

# 5. 数据结构改造

现有所有图片资产必须能够关联：

```text
vault_id
```

核心原则：

> 所有图片查询都必须明确属于某一个 Vault。

例如原 Asset：

```text
id
path
hash
description
created_at
```

改为：

```text
id
vault_id
path
hash
description
created_at
updated_at
```

逻辑上：

```text
Vault
  1
  |
  N
Asset
```

所有相关表均检查是否需要添加：

```text
vault_id
```

包括但不限于：

- assets
- tags
- image_metadata
- embeddings
- collections
- favorites
- processing_tasks
- import_records

如果某张表可以通过 asset_id 唯一确定 Vault，则可以不重复存储 vault_id。

不要为了“显式”而造成大量冗余字段。

---

# 6. 文件存储结构

禁止继续假设系统只有一个：

```text
uploads/
```

建议统一为：

```text
data/
├─ meme/
│  ├─ assets/
│  ├─ thumbnails/
│  ├─ cache/
│  ├─ vectors/
│  └─ exports/
│
├─ anime/
│  ├─ assets/
│  ├─ thumbnails/
│  ├─ cache/
│  └─ vectors/
│
├─ life/
│  └─ ...
│
└─ maimai/
   └─ ...
```

业务代码禁止写死：

```text
uploads/
vectors.npy
thumbnails/
```

必须通过：

```text
VaultStorage
```

或同等抽象获取实际路径。

建议：

```text
Vault
↓
VaultStorage
↓
assetRoot
thumbnailRoot
cacheRoot
vectorRoot
```

---

# 7. Storage 抽象

新增统一仓库存储服务：

```text
VaultStorageService
```

负责：

- 获取 Vault 根目录；
- 创建 Vault 文件目录；
- 生成 Asset 路径；
- 获取缩略图路径；
- 获取缓存路径；
- 获取向量索引路径；
- 删除 Vault；
- 检查非法路径；
- 防止跨 Vault 文件访问。

业务代码不得自行：

```text
join("uploads", filename)
```

应改为类似：

```text
storage.getAssetPath(vaultId, filename)
```

---

# 8. 默认 Meme Vault 迁移

升级后自动创建默认 Vault：

```text
slug = meme
```

名称建议：

```text
暗苟，夏，Meme
```

原数据库中的全部 Meme：

```text
vault_id = memeVault.id
```

原图片文件尽可能保持兼容。

可采用：

### 方案 A

迁移文件：

```text
uploads/
```

↓

```text
data/meme/assets/
```

### 方案 B

第一阶段允许：

```text
meme.storage_path = 原 uploads 目录
```

后续再进行物理迁移。

优先选择：

> 数据安全风险最低的方案。

不得因为目录重构造成已有约 8000 张 Meme 资产丢失或数据库引用失效。

迁移前后必须验证：

- 总图片数；
- 文件存在数量；
- hash；
- metadata；
- embedding 数量。

---

# 9. Vault 管理接口

新增 Vault API。

例如：

```http
GET /api/vaults
```

返回所有仓库。

```http
POST /api/vaults
```

创建仓库。

```http
GET /api/vaults/:vaultId
```

获取仓库信息。

```http
PATCH /api/vaults/:vaultId
```

修改：

```text
name
description
部分 config
```

```http
DELETE /api/vaults/:vaultId
```

删除 Vault。

删除操作必须默认禁止直接级联删除全部图片。

推荐流程：

```text
请求删除
↓
检测 Vault 是否为空
↓
非空：
返回需要显式 force
```

防止一次误操作蒸发一个人生阶段。

---

# 10. 现有 Asset API 改造

原接口例如：

```http
GET /api/images
```

逐步改造成：

```http
GET /api/vaults/:vaultId/assets
```

推荐新的 REST 风格：

```text
/api/vaults/:vaultId/assets
/api/vaults/:vaultId/search
/api/vaults/:vaultId/random
/api/vaults/:vaultId/import
/api/vaults/:vaultId/tags
```

旧接口暂时保留：

```http
GET /api/images
```

默认代理到：

```text
meme
```

即：

```text
/api/images
≈
/api/vaults/meme/assets
```

避免 Maibot 等现有外部调用立刻失效。

---

# 11. 查询隔离

所有 Repository / Service 层查询必须显式携带：

```text
vaultId
```

禁止：

```text
getAllAssets()
```

优先：

```text
getAssets(vaultId)
```

禁止：

```text
search(query)
```

优先：

```text
search(vaultId, query)
```

禁止：

```text
randomAsset()
```

优先：

```text
randomAsset(vaultId)
```

这条属于本次开发的强制规范。

---

# 12. 搜索系统改造

## 普通搜索

所有：

```text
文件名搜索
描述搜索
标签搜索
metadata 搜索
```

均只搜索当前 Vault。

---

# 13. 向量搜索隔离

MemeVault 当前已有语义搜索能力。

多 Vault 后必须保证：

```text
Anime 搜索
```

绝不返回：

```text
Meme
```

建议两种实现。

## 推荐方案：每 Vault 独立 Vector Store

例如：

```text
data/meme/vectors/
data/anime/vectors/
data/life/vectors/
```

逻辑：

```text
SemanticSearchService.search(vaultId, query)
```

↓

```text
loadVectorIndex(vaultId)
```

优点：

- 隔离简单；
- 易于删除；
- 易于重建；
- 不容易串库；
- 不同 Vault 后续可以使用不同 embedding 模型。

本阶段优先采用该方式。

---

# 14. Embedding 配置仓库化

不同图片类型未来可能采用不同模型。

Vault config 预留：

```json
{
  "embedding": {
    "enabled": true,
    "model": "qwen3-vl-embedding",
    "strategy": "single-image"
  }
}
```

例如生活照片可以关闭语义向量：

```json
{
  "embedding": {
    "enabled": false
  }
}
```

因此：

> 不要假定每一个 Vault 都必须进行 Embedding。

---

# 15. 图片导入

导入操作必须先选择目标 Vault。

例如：

```text
拖入图片
↓
当前 Vault = Anime
↓
导入 Anime
```

禁止默认写入 Meme。

支持：

```text
单文件
多文件
目录
拖拽
```

原有上传逻辑尽量复用。

---

# 16. 去重策略

默认：

```text
同 Vault hash 去重
```

即：

```text
Anime
```

和：

```text
Meme
```

允许存在相同图片。

因为同一张图片可能同时具有：

```text
表情包用途
壁纸用途
收藏用途
```

因此不要全局强制去重。

未来可以增加：

```text
全局重复检测
```

作为辅助提示。

但本阶段不实现全局强制限制。

---

# 17. 前端 Vault 切换

新增一级 Vault Selector。

推荐位于：

```text
左侧 Sidebar 顶部
```

或：

```text
顶部 Navigation
```

类似：

```text
┌──────────────────────┐
│ 暗苟，夏，Meme   ▼   │
├──────────────────────┤
│ Gallery              │
│ Search               │
│ Tags                 │
│ ...                  │
└──────────────────────┘
```

点击：

```text
▼
```

显示：

```text
暗苟，夏，Meme
二次元收藏
生活照片
舞萌战绩
────────────
+ 新建仓库
```

切换 Vault 后：

- 图片流刷新；
- 搜索刷新；
- 标签刷新；
- 统计刷新；
- 当前选中图片清空；
- 所有状态必须重新绑定当前 Vault。

---

# 18. URL 状态

Vault 应反映在 URL 中。

例如：

```text
/v/meme
/v/anime
/v/life
/v/maimai
```

也可以：

```text
/v/meme/search
/v/anime/search
```

不要只通过前端全局变量保存当前 Vault。

原因：

- 刷新页面可恢复；
- 可以收藏 URL；
- 可以直接分享指定 Vault；
- 浏览器前进后退行为正常。

---

# 19. Vault 展示信息

Vault 可以配置：

```text
name
icon
description
cover
```

第一阶段 icon 可以使用：

```text
emoji
```

例如：

```text
🐶 Meme
🌸 Anime
📷 Life
🎵 Maimai
```

无需复杂的图标上传系统。

---

# 20. Vault 类型

预留：

```text
type
```

例如：

```text
meme
image
photo
game
generic
```

第一阶段不要因为 type 做大量硬编码业务。

可以暂时仅用于：

```text
默认配置
UI 图标
Capability 初始化
```

避免出现：

```javascript
if (vault.type === "anime") ...
if (vault.type === "life") ...
if (vault.type === "maimai") ...
```

这种不断增长的判断链。

---

# 21. Capability 预留

建立简单的 Vault Capability 配置。

例如：

```json
{
  "capabilities": {
    "semanticSearch": true,
    "randomAsset": true,
    "tags": true,
    "embedding": true
  }
}
```

Meme：

```text
semanticSearch = true
randomAsset = true
tags = true
```

Life：

```text
semanticSearch = false
randomAsset = false
tags = true
```

本阶段只需要让系统具备读取 Capability 的能力。

不要立即开发大量新 Capability。

---

# 22. 外部 API 兼容

MemeVault 当前可能已经被：

```text
Maibot
其他本地工具
```

调用。

因此旧 API：

```text
/random
/search
```

继续默认绑定：

```text
meme
```

同时增加新接口：

```text
/vaults/:slug/random
/vaults/:slug/search
```

例如：

```text
/vaults/meme/random
/vaults/anime/random
```

Maibot 当前完全无需修改即可继续使用 Meme 仓库。

---

# 23. Vault Context

前端建议建立：

```text
VaultContext
```

或者当前框架等价的全局仓库状态。

负责：

```text
currentVault
vaultList
switchVault()
reloadVault()
```

所有图片请求统一读取：

```text
currentVault.id
```

避免不同页面自己保存 Vault 状态。

---

# 24. 后端服务层要求

推荐结构：

```text
VaultController
VaultService
VaultRepository

AssetController
AssetService
AssetRepository

VaultStorageService
SemanticSearchService
```

AssetService 的核心方法均要求：

```text
vaultId
```

例如：

```text
listAssets(vaultId)
getAsset(vaultId, assetId)
deleteAsset(vaultId, assetId)
searchAssets(vaultId, query)
importAsset(vaultId, file)
```

---

# 25. 安全边界

即使当前主要为个人本地使用，也必须防止：

```text
Vault A
```

通过伪造 assetId 删除：

```text
Vault B
```

资产。

例如删除：

```text
DELETE /vaults/1/assets/123
```

必须验证：

```text
asset.id = 123
AND
asset.vault_id = 1
```

禁止：

```text
delete asset where id = 123
```

---

# 26. 数据迁移

必须提供 migration。

迁移逻辑：

```text
1. 创建 vault 表
2. 创建默认 meme Vault
3. Asset 添加 vault_id
4. 所有旧 Asset 绑定 meme Vault
5. 更新索引
6. 验证数据数量
```

数据库 migration 必须：

```text
可重复检查
失败可恢复
```

不要通过：

```text
删除旧库
重新扫描文件
```

完成升级。

---

# 27. 前端兼容原则

原 MemeVault 的：

```text
Gallery
Hover
Lift
Tilt
Magnetic
搜索
上传
详情
```

行为应基本保持。

本阶段不是 UI 重构阶段。

优先顺序：

```text
隔离正确
>
数据安全
>
旧功能兼容
>
UI 美化
```

---

# 28. 测试要求

必须补充多 Vault 测试。

## Vault 创建

测试：

```text
create Meme
create Anime
create Life
```

均成功。

---

## 数据隔离

Meme 添加：

```text
A.jpg
```

Anime 添加：

```text
B.jpg
```

查询 Meme：

```text
只返回 A
```

查询 Anime：

```text
只返回 B
```

---

## 删除隔离

尝试：

```text
DELETE meme/B
```

必须失败。

Anime 中 B 不得受到影响。

---

## 搜索隔离

分别创建：

```text
Meme:
猫.jpg

Anime:
猫娘.jpg
```

搜索：

```text
猫
```

结果只能来自当前 Vault。

---

## 向量隔离

两个 Vault 各建立向量。

确认：

```text
semanticSearch(meme)
```

不会读取：

```text
anime
```

Vector Store。

---

## Hash 隔离

同一文件：

```text
same.jpg
```

允许分别存在：

```text
Meme
Anime
```

同 Vault 内仍正常去重。

---

# 29. 数据迁移验证

升级前：

```text
Meme Assets = N
```

升级后必须：

```text
Meme Vault Assets = N
```

并检查：

```text
原文件存在
缩略图存在
数据库记录存在
Embedding 映射有效
搜索正常
```

不得只根据数据库 migration 成功判断完成。

---

# 30. 本阶段暂不开发

以下功能明确不属于本版本：

- 云同步；
- Google Photos 类功能；
- AI 人脸识别；
- 地理位置地图；
- OCR 成绩识别；
- Anime 角色自动识别；
- Danbooru 标签自动识别；
- 多用户权限；
- 仓库共享；
- NAS；
- S3；
- 自动同步手机相册；
- 跨 Vault 联合搜索；
- 跨 Vault 全局推荐；
- 全局知识图谱。

先保证：

> 多仓库基础结构稳定。

---

# 31. 建议开发阶段

## Phase 1：模型重构

完成：

```text
Vault Entity
vault_id
migration
VaultService
```

此阶段前端可以没有变化。

---

## Phase 2：Storage 隔离

完成：

```text
VaultStorageService
不同 Vault 独立文件路径
缓存隔离
Thumbnail 隔离
```

---

## Phase 3：业务查询隔离

重构：

```text
Asset
Search
Tags
Random
Import
Delete
```

全部携带：

```text
vaultId
```

---

## Phase 4：Vector 隔离

完成：

```text
每 Vault 独立 vector index
Embedding 配置
SemanticSearch vault 参数
```

---

## Phase 5：前端 Vault Selector

增加：

```text
Vault Picker
创建 Vault
切换 Vault
```

并将 URL 改为：

```text
/v/:vaultSlug
```

---

## Phase 6：兼容层

保留旧：

```text
Meme API
```

默认路由到：

```text
meme Vault
```

确保 Maibot 等现有功能不受影响。

---

# 32. 完成标准 Definition of Done

完成后必须满足：

### 1.

应用启动后自动存在：

```text
Meme Vault
```

且原有数据完整。

### 2.

用户可以创建：

```text
Anime Vault
Life Vault
Maimai Vault
```

### 3.

不同 Vault 图片完全隔离。

### 4.

不同 Vault 搜索结果完全隔离。

### 5.

不同 Vault 向量索引完全隔离。

### 6.

不同 Vault 删除操作不能影响其他 Vault。

### 7.

同一图片允许跨 Vault 存在。

### 8.

原 MemeVault 前端核心功能不退化。

### 9.

原 Meme API 继续可用。

### 10.

代码中不应再大量存在：

```text
默认只有 Meme
固定 uploads 目录
固定 vectors 文件
```

等单仓库假设。

---

# 33. 最终架构目标

```text
                    MemeVault
                        │
                 Vault Manager
                        │
       ┌────────────────┼────────────────┐
       │                │                │
     Meme             Anime            Life
       │                │                │
   Assets           Assets           Assets
       │                │                │
 Metadata          Metadata          Metadata
       │                │                │
 Vectors           Vectors           Optional
       │
 External API
       │
     Maibot
```

底层：

```text
Vault
  │
  ├── Asset
  ├── Storage
  ├── Metadata
  ├── Search
  ├── VectorStore
  └── Capabilities
```

最终目标不是：

> 建四套图片管理系统。

而是：

> 建立一个可复用的图片资产核心，让 Meme、Anime、Life、Maimai 都成为它上面的不同世界。