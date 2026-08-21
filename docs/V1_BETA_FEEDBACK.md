# Meme Vault v1.0 Beta Feedback

## FIXED

- Tag 本地实时搜索、清空恢复、无结果轻量提示和选择状态保持。
- Template Filter 在较窄窗口下保持展开按钮可见，Chip 独立横向滚动且页面不产生横向溢出。
- Visitor 可通过“模板浏览”入口读取、搜索和筛选 Template；Template Management 与 Mutation 继续仅限 Admin。
- GIF 卡片增加轻量媒体类型 Badge，并提供仅展示 GIF 的“动图模式”，不创建内容 Tag。
- “喝了假酒”预设增强吸引范围、漂移和波动幅度，不改变物理架构。

## KNOWN LIMITATION

- 公网媒体加载速度取决于宿主机上行带宽、Tunnel 和原文件大小。
- 大 GIF 在完整传输前可能只显示首帧或部分帧；完整加载后可正常播放。
- GIF 完整加载前的临时边缘像素现象继续观察；若稳定播放后仍存在，再作为 v1.0.x CSS polish。

## DEFERRED

- CDN、媒体缓存、全量转码、GIF 转视频、Range Streaming 和大规模预加载调整。
- 非阻断性的个人审美调整与渲染微调。
