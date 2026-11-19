# Meme Vault v1.0.1 External Meme API / 外部 Meme API

该 API 面向可信局域网中的通用消费者，不绑定 MaiBot、QQ 或任何消息平台。以下
URL 都是相对路径；消费者应把它们与 Meme Vault 的 Base URL（例如
`http://192.168.1.20:8002`）拼接。接口不返回服务器磁盘路径。

## Authentication / 认证

External API（外部 API）始终使用独立机器凭据，不复用 Web Session。服务端配置：

```dotenv
EXTERNAL_API_KEY=<独立随机长密钥>
```

客户端的 Random、Semantic 与后续 `image_url` 请求都必须携带：

```http
Authorization: Bearer <EXTERNAL_API_KEY>
```

无 Key、错误 Key、Visitor/Admin Cookie 或把 Visitor/Admin Key 当作 Bearer 都返回 `401`。
`EXTERNAL_API_KEY` 必须与 Visitor/Admin Key 不同；真实值只保存在被 Git 忽略的 `.env`
或部署环境中，不放入 URL、查询参数、仓库或日志。该 Key 只开放以下三个只读入口，
不会授权 Upload、Edit、Delete、Batch/ZIP、Settings 或其他 Web API。

## Random Meme

- Method：`GET`
- Endpoint：`/api/memes/random`
- Query Parameters：可选的重复 `tags`（全部标签 AND 匹配）；可选的正整数
  `template_id`
- 行为：从符合现有主库规则且图片文件可用的 Meme 中随机返回一条元数据；选择时
  不读取图片二进制

请求：

```bash
curl -H "Authorization: Bearer $EXTERNAL_API_KEY" http://localhost:8002/api/memes/random
```

响应示例（实际响应还会保留现有 Meme DTO 的标题、尺寸、标签等字段）：

```json
{
  "id": 123,
  "filename": "example.webp",
  "original_filename": "example.webp",
  "mime_type": "image/webp",
  "image_url": "/api/memes/123/image",
  "tags": []
}
```

空库、筛选范围为空或范围内没有可用图片时返回 `404`：

```json
{
  "detail": "No Meme matches the requested range"
}
```

## Semantic Meme Top 5 Random

- Method：`GET`
- Endpoint：`/api/memes/semantic`
- Query Parameters：
  - `q`：必填；去除首尾空白后长度为 2–500 个字符
  - `limit`：可选，默认且仅允许 `1`
- 行为：复用现有 `SemanticSearchService -> SemanticIndex ->
  MemeEmbeddingRepository` 检索链和 NumPy 排序，取得本地 Top 5，从其中图片可用的候选里
  随机返回一张；不会按请求重建索引，也不会在 Top 5 全部不可用时回退到普通 Random API

请求：

```bash
curl -H "Authorization: Bearer $EXTERNAL_API_KEY" "http://localhost:8002/api/memes/semantic?q=无语地看着对方&limit=1"
```

响应示例：

```json
{
  "meme": {
    "id": 123,
    "filename": "example.webp",
    "original_filename": "example.webp",
    "mime_type": "image/webp",
    "image_url": "/api/memes/123/image",
    "tags": []
  },
  "score": 0.873
}
```

无匹配结果返回 `404`，不会以 `200` 返回 `null`：

```json
{
  "detail": "No semantic Meme matches the query"
}
```

空白或过短的 `q` 返回 `400`；缺失参数、过长参数或 `limit` 不是 1 返回 FastAPI
统一的 `422` 校验响应。未配置向量模型、主库存在 Meme 但没有 ready embedding，或
语义索引不可用时返回 `503`。Embedding Provider 超时返回 `504`，上游或响应格式错误
返回 `502`。示例：

```json
{
  "detail": "No ready semantic embeddings are available"
}
```

## Meme Image

- Method：`GET`
- Endpoint：`/api/memes/{id}/image`
- Response：封面原图二进制，不做格式转换
- MIME：按已验证元数据返回 `image/jpeg`、`image/png`、`image/webp` 或
  `image/gif`

请求：

```bash
curl -H "Authorization: Bearer $EXTERNAL_API_KEY" http://localhost:8002/api/memes/123/image --output meme.webp
```

GIF 会原样返回完整 GIF，不会返回首帧或转换为 PNG/JPEG。ID 不存在返回 `404`；
数据库记录存在但当前主库完整性检查发现文件缺失返回 `410`；非法 ID 返回 `422`；
不支持或损坏的 MIME 元数据返回 `409`。错误正文只包含公共错误信息，不包含本地磁盘
路径。

## LAN 调用

服务端继续按部署命令监听网络接口，不硬编码 localhost 或具体局域网 IP。例如：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8002
```

同一局域网中的消费者可以调用：

```bash
curl -H "Authorization: Bearer $EXTERNAL_API_KEY" http://192.168.1.20:8002/api/memes/random
```

从 JSON 取得相对 `image_url` 后，将它拼接到同一个 Base URL，并在媒体请求中继续携带
同一个 Bearer Header。Bearer Key 不替代 HTTPS；公网部署仍应通过受控 Tunnel / HTTPS，
并避免把服务直接暴露为无 TLS 的公网端口。
