# 能力实测摘要

2026-09-07，使用 Codex OAuth 直接请求后端，无 SDK、无自动重试。以下为历史观察，**不是官方支持承诺或当前参数清单**。

| 探测 | 结果 |
|---|---|
| 搜索、按引用浏览、金融、天气、体育、时间 | 返回对应内容；四种数据查询现已加入工具 |
| 图片生成与编辑 | 成功 |
| 图片 SSE | 收到保活和最终 completed；未收到部分图片 |
| 透明背景、1024×1536 | 输出符合要求，PNG 存在实际透明像素；提示词也要求透明及纵向画布 |
| 1024×1024 | 实际返回 1254×1254 |
| n=2 | 只返回一张 |
| JPEG/WebP | 实际返回 PNG，无法验证压缩参数 |
| low 质量的透明图 | 元数据报告 medium |
| gpt-image-1.5 | 请求成功，但未确认实际执行模型 |
| 图片 usage | 返回 token 明细，不能据此推导订阅费用 |
| Files / variations | 返回 HTML 403，相关入口现已移除；不能断言后端永久不支持 |

HTTP 接受参数不等于语义生效。未充分验证蒙版、审核、远程 image_url、其他模型及全部尺寸。当前功能见 [README](../README.md)。

当前探针：`npx tsx scripts/probe-capabilities.ts --web`；加 `--images` 会使用当前固定默认值生成一张图并消耗额度，不重放旧参数矩阵。

原始脱敏记录及图片保留在本地：
- `artifacts/capabilities/c129abff-932b-49d9-9feb-09fb1bba0cfe/results.json`
- `artifacts/capabilities/611eaf9a-1072-45e1-9a8a-0a8585cd5ec6/results.json`
