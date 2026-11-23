# Publisher Bridge 协议 v1

Meme Vault 生成包含 UTF-8 `manifest.json` 和 `assets/` 的发布包。管理员可从帖文工作台下载 ZIP，也可把相同结构的目录交给已注册的本地插件。协议使用原图和逐图文案，平台排版与上传由各插件实现。

## 发布包

解压后以包含 `manifest.json` 的目录为根。以下为单个条目的示例，实际文件大小、尺寸和 SHA-256 由 Meme Vault 填写。

```json
{
  "protocol_version": "1",
  "request_id": "10000000-0000-4000-8000-000000000001",
  "post_id": 12,
  "revision": 4,
  "content_type": "image_text",
  "title": "本周合集",
  "intro_text": "开头",
  "outro_text": "",
  "items": [
    {
      "position": 0,
      "meme_id": 32,
      "meme_image_id": 41,
      "caption": "第一行\n第二行",
      "asset": "assets/001.png",
      "mime_type": "image/png",
      "size": 128,
      "width": 10,
      "height": 10,
      "sha256": "1a30d537b4767971c41a4c89400abf7b2e1af15686c45622b33ac174bc9b52c8"
    }
  ]
}
```

- 按 `items` 顺序消费，`position` 从 0 连续递增。文案为空字符串时照常处理图，换行保留。同一素材可以出现多次。
- `asset` 为包根目录下、使用正斜杠的相对路径。解包与读取时校验最终路径在包根目录内，拒绝绝对路径、上级目录和指向包外的链接。读取原文件并校验 MIME、大小与 SHA-256。
- 支持 PNG、JPEG、WebP、GIF。请求 UUID 同时是本次 Attempt ID 及幂等标识。包内容绑定草稿版本，执行期间继续编辑会产生新版本。
- 草稿编辑器最多 500 项，发布包图片合计最多 2 GiB。插件可声明更低的目标限制。ZIP 文件在 24 小时后过期，尝试记录仍保留。

## 注册可信本地插件

在运行环境设置 `MEME_VAULT_PUBLISHERS_FILE` 为本机 JSON 文件的路径，然后重启服务。文件是配置数组，每项包含 `manifest`、`command`、可选 `enabled` 和可选 `timeout_seconds`。内置 `mock` 默认注册。设置 `MEME_VAULT_PUBLISHER_EXECUTION=0` 会停用本地执行，草稿、预览和 ZIP 导出可继续使用。管理界面读取状态，启用与禁用由服务端配置控制。

下面用仓库附带的 Mock 演示独立插件注册。替换示例路径后即可在工作台选择此离线目标。实际小黑盒 CLI 适配配置见文末。

```json
[
  {
    "manifest": {
      "plugin_id": "xhh-local-preview",
      "name": "小黑盒适配器（离线示例）",
      "version": "0.1.0",
      "protocol_version": "1",
      "supported_content_types": ["image_text"],
      "capabilities": ["image_text", "multiple_images", "gif", "prepare", "dry_run"],
      "limits": {},
      "execution_mode": "local_process"
    },
    "command": [
      "C:/Path/To/python.exe",
      "-I",
      "C:/Path/To/MemeVault/publishers/mock_publisher.py",
      "--plugin-id",
      "xhh-local-preview"
    ],
    "enabled": true,
    "timeout_seconds": 30
  }
]
```

- `limits` 可填 `max_images`、`max_image_bytes`、`max_package_bytes`。后两项以原图字节计数。相应字段为空时使用应用默认边界。
- 操作能力为 `prepare`（本地准备）、`dry_run`（试运行）、`remote_draft`（创建远端草稿）、`publish`（正式发布）。`multiple_images`、`gif` 和 `external_url` 决定可接受内容与回执字段。`preview` 是保留能力，v2.2 的通用预览在工作台直接渲染。
- `command` 是固定参数数组，首项为本地可执行文件的绝对路径。Meme Vault 用参数数组调用进程，追加 `--package <本次临时目录> --action <操作>`。工作目录也是包根目录。内容仅经包文件传输；插件独立处理本机凭据。只登记信任的程序，程序使用服务进程的操作系统权限。
- 管理页的可用性检查确认配置已启用且本地可执行文件存在。实际运行结果以任务回执为准。进程有超时限制（默认 30 秒、上限 300 秒），标准输出限制 64 KiB。插件应自行管理子进程，避免子进程在父进程结束后继续执行发布。临时目录在任务后清理。不可用配置项会独立隔离，前端只得到公开的 Manifest、开关、可用性和最近回执。

## 进程回执

成功处理协议时，进程以 0 退出，并在标准输出返回一段 JSON。日志应留在插件自己的开发环境，应用不转发 stderr。

```json
{
  "attempt_id": "10000000-0000-4000-8000-000000000001",
  "plugin_id": "mock",
  "status": "prepared",
  "started_at": "2026-11-19T00:00:00Z",
  "finished_at": "2026-11-19T00:00:01Z"
}
```

- `attempt_id` 必须等于包里的 `request_id`，`plugin_id` 必须匹配注册项。`started_at` 和 `finished_at` 在插件回执中可选，历史采用应用自己的 UTC 时间。
- `prepared` 表示本地准备或试运行完毕。`remote_draft` 与 `published` 只在平台确认后返回，可带 `external_post_id` 与 `external_url`。链接须为 HTTP(S)，且插件需声明 `external_url`。
- 只有明确确定目标未执行时才返回 `failed`，附稳定的 `error_code`；不支持的操作返回 `failed` 和 `unsupported`。可另附 `error_message`，应用对外保存错误代码和固定描述，以免把插件诊断中的本地路径或认证信息带入历史。
- 超时、异常退出、非法回执或执行中断会记为 `unknown`。远端操作也可显式回报 `unknown`、稳定的 `error_code` 和平台已返回的 `external_post_id`。这类回执仍视为结果未知，禁止提供 `external_url`。已确认发布或结果未知时，应用会拦截同一帖文对同一插件的重复远端写入；明确失败可以在相同草稿版本上主动重试。插件应把请求 UUID 用于自身的幂等处理。

## API 与 Mock 验证

以下路由均以 `/api/publisher` 开头，沿用 Admin 会话。

| 路由 | 用途 |
| --- | --- |
| `GET /posts`、`POST /posts` | 最近编辑排序、新建 |
| `GET /posts/{id}`、`PUT /posts/{id}` | 详情、按 `revision` 保存内容 |
| `GET /posts/{id}/other-image-ids` | 获取其他帖文使用的现有图库子图 ID，用于选图标记 |
| `POST /posts/{id}/move-to-top` | 更新时间并返回帖文摘要，使其升到最近编辑排序的首位，保留草稿版本 |
| `POST /posts/{id}/items`、`POST /posts/{id}/copy`、`DELETE /posts/{id}?revision=N` | 追加、复制、删除 |
| `GET /plugins` | 注册能力、可用性、最近执行 |
| `POST /posts/{id}/attempts` | 提交 `request_id`、`revision`、`action`、`plugin_id` 及可选 `retry_of` |
| `GET /posts/{id}/attempts`、`GET /attempts/{id}` | 分页历史与单次执行状态 |
| `GET /attempts/{id}/download` | 获取完成且未过期的 ZIP |

对普通 ZIP，使用 `action="export"` 与空 `plugin_id`。提交返回 202 后查询状态。重复提交同一请求 UUID 和同一参数会返回原记录。草稿版本变更返回 409，可先保留本页修改再处理冲突。插件未声明所需能力时返回 422，响应含 `error_code: "unsupported"`。

可直接用 Python 启动独立 Mock 读取解压后的包。成功时报告目录将得到按顺序解析的完整 JSON；应用内默认运行时的报告随临时发布包清理。

```powershell
python publishers/mock_publisher.py --package ./unpacked --action prepare --report-dir ./reports
```

可在可信配置的 `command` 中加入 `--simulate failure`、`--simulate timeout`、`--simulate crash` 或 `--simulate invalid`，并使用单独的 `plugin_id`。本地 Mock 只使用 Python 标准库。

## 小黑盒 CLI 发布插件

适配器使用 [xiaoheihe-cli](https://github.com/AaronZ345/xiaoheihe-cli) 的 `0.1.0`，本机部署锁定提交 `954fb4753fb1a879572239f2a54b520a91dc814d`。在独立目录检出该提交，再用 `uv sync --locked --no-dev` 安装。插件用这个虚拟环境的 Python 运行，Meme Vault 本身的 Python 环境无需安装 CLI 依赖。

在 Publisher 配置数组加入以下条目，替换三个绝对路径。保持 `plugin_id` 与适配器一致。

```json
{
  "manifest": {
    "plugin_id": "xiaoheihe",
    "name": "小黑盒 CLI",
    "version": "0.1.0",
    "protocol_version": "1",
    "supported_content_types": ["image_text"],
    "capabilities": ["image_text", "multiple_images", "gif", "dry_run", "remote_draft", "publish"],
    "limits": {},
    "execution_mode": "local_process"
  },
  "command": [
    "C:/Path/To/xiaoheihe-cli/.venv/Scripts/python.exe",
    "-I",
    "C:/Path/To/MemeVault/publishers/xiaoheihe_publisher.py",
    "--session-dir",
    "C:/Path/To/MemeVault/data/publisher/xiaoheihe-session"
  ],
  "enabled": true,
  "timeout_seconds": 300
}
```

- 在工作台选「小黑盒 CLI → 试运行」时，适配器用上游文章解析器在本机预检原图和排版。图片保持原顺序，逐图文案写入小黑盒「图片描述」，文案里的换行按单行输入框处理为空格。开头和结尾保留在文章正文。小黑盒文章需要非空标题。
- 「创建远端草稿」由 CLI 上传图片，再通过小黑盒网页编辑器提交，最后读回核对账号、标题、正文和图片顺序。适配器使用 Playwright 在隔离浏览器里打开编辑器，复用 CLI 登录会话。Windows 使用标准安装位置的 Microsoft Edge，其他平台需要已安装 Playwright Chromium。「发布到平台」沿用上游 CLI。历史会显示上传失败的图序，区分平台明确拒绝草稿与提交结果未知。平台已接收但读回未核验时保留平台编号，读回核验通过后才记为成功。
- 小黑盒远端草稿因插件异常退出或提交中断而没有平台编号时，当前帖文版本的历史记录提供「核对后重试」。点击后先验证当前 CLI 账号并读取草稿箱。确认草稿箱为空才上传图片并重新创建，遇到已有草稿、检查失败或其他版本、已有平台编号等冲突记录会停止。原任务记录保留，此入口仅适用于远端草稿。
- Admin 从「更多功能 → Publisher 管理 → 小黑盒 CLI」点击「扫码登录」，用小黑盒 App 扫描页面上的二维码并确认。页面显示成功后即可在帖文工作台创建远端草稿。网页登录和终端使用同一个本地 CLI 会话。
- 终端也可从仓库根目录启动扫码命令。

```powershell
$env:XHH_OPERATOR_HOME = Join-Path (Get-Location) 'data/publisher/xiaoheihe-session'
& '.\data\publisher\xiaoheihe-runtime\Scripts\xiaoheihe-cli.exe' login
```

