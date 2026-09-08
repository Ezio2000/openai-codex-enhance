# 协议设计

Web/Image 直接 HTTP，无 OpenAI SDK；Computer Use 使用本机官方运行时的 MCP stdio。功能和工具参数见 [README](../README.md)。

## 独立工具请求

基址固定为 `https://chatgpt.com/backend-api/codex/`，使用 pi 解析的 Bearer OAuth 和 `chatgpt-account-id`，拒绝重定向。

| 路径（POST） | 请求要点 |
|---|---|
| `alpha/search` | id 为 pi session ID；model 固定 gpt-5.6-luna；commands 放操作，settings 放搜索设置 |
| `images/generations` | 无参考图；固定参数来自 IMAGE_FIXED，默认值来自 IMAGE_DEFAULTS |
| `images/edits` | 参考图通过 images: [{image_url}] 发送；本地文件转为 data URL |

图片 quality（low/medium/high，默认 high）和 moderation（auto/low，默认 auto）开放给工具，显式值原样传递；其他固定图片参数不能覆盖。

搜索内部补 `allowed_callers: [direct]`、体育 `tool: sports` 和地点 `type: approximate`。timeout_seconds、include_context、num_last_images_to_include 只在工具层处理，不作为 wire 字段发送。

## 原生 Computer Use

`codex_computer` 通过长驻 MCP stdio 连接 ChatGPT 安装包的 `node_repl`，执行官方 CUA JavaScript，由 Sky 原生服务操作 macOS。应用授权转换为 pi UI，截图和 AX 文本直接回传；不另起模型、不转发 pi OAuth 令牌、不自动重试动作。详见 [接入与验证](computer-use.md)。

## 主模型请求增强

`before_provider_request` 在 pi 序列化后修改指定字段，不替换 provider、不读取认证、不发额外请求。默认全部关闭：

| 能力 | 开启后的修改 |
|---|---|
| verbosity | `text.verbosity = low / medium / high`，保留 text.format 等字段 |
| image-detail | 用户消息和 function_call_output 内的 input_image 设置 `detail: original`，不改图片字节、工具参数或 schema |
| fast | `service_tier: priority`，不改变模型、推理强度或 prompt_cache_key |

只处理当前模型匹配、provider=openai-codex、api=openai-codex-responses 且 input 为数组的请求；未知格式和不支持的模型保持原样。模型支持快照在 `shared/model-support.ts`，不代表账号权限。

`/openai-codex-enhance` 打开 SettingsList 面板，Space 连续切换并立即保存，Esc 关闭；子命令无值时定位对应项，有值时直接保存。面板在模型/会话切换时关闭，旧回调不再允许修改设置。保存失败会回滚面板显示并保留实际状态。

全局偏好保存到 getAgentDir()/openai-codex-enhance.json，不依赖 SessionManager 或首条助手消息落盘。写入使用独占锁、读取合并、0600 临时文件、fsync 和原子 rename；不覆盖格式损坏的配置。旧 CustomEntry 只在首次迁移时读取，配置文件存在后始终优先。若进程在保存中崩溃留下 .lock，应确认没有写入进程后手动清理，不会自动抢锁。

Codex 下通过公开 setFooter API 将设置放在 cwd 右侧，整行统一 theme.fg("dim")；下方保留主要用量/模型信息及其他扩展状态，不重复显示自己的 setStatus 行。model_select 使用事件的新模型，非 Codex 时清除状态并 setFooter(undefined)；render 也再次检查 provider，旧请求 Hook 不允许覆盖 UI 的当前模型。

命令、补全、面板及 Computer 管理不按 provider 隐藏或拒绝。非 Codex 下设置保存为预设并提示 n/a；请求变换和自定义 Footer 仍仅适用于 Codex。shutdown 后停止补全和旧面板回调，不改 pi 内部注册表。

Hook 使用写时复制，关闭时不覆盖原请求；没有后台请求、自动重试或静默参数降级。verbosity 已做 [Astra 对比实测](verbosity-probe.md)；original 和 priority 的实际效果仍不能仅凭参数被接受确认。original 不关闭图片预缩放。

[官方 Fast 规则](https://learn.chatgpt.com/docs/agent-configuration/speed)：ChatGPT credits 的倍率是 GPT-5.4 2×、GPT-5.5/5.6/Astra 2.5×，与 API token 费率不同。显示倍率不是账单验证，也不会再次乘算 pi 已报告的 cost。

## 响应与限制

- 搜索保留 output 的引用 ID、URL、wordlim；results 放入 details，encrypted_output 不回传、不落盘。
- 图片默认 SSE，只有 completed 才算流式成功；断流或重复 completed 报错。收到有效 JSON 图片时保存并提示未使用 SSE。
- 按图片字节检查格式/尺寸，差异写入正文及 details.warnings；不转换原图、不删字段或换接口重试。
- 图片 size：边长为 16 的倍数、最长边 <=3840、长宽比 <=3:1、像素 655360–8294400。校验通过不保证后端遵守。
- 图片输出单张 <=32 MiB；JSON <=128 MiB、SSE <=192 MiB；最多 4 张预览，每张 <=512 KiB。资源上限不是后端能力承诺。

## 代码导航

| 位置 | 职责 |
|---|---|
| `src/index.ts` | 注册各能力、provider 门控和状态命令 |
| `src/capabilities/web/` | 独立 WebClient、类型/校验/schema、工具、搜索历史和输出 |
| `src/capabilities/image/` | 独立 ImageClient、类型/默认值/校验/schema、工具、原图/历史和差异提示 |
| `src/capabilities/computer/` | 官方运行时定位、长驻 MCP、串行会话、授权、工具与截图产物 |
| `src/capabilities/{verbosity,image-detail,fast}/` | 各项主模型请求覆盖的选项、支持检查与纯转换函数 |
| `src/shared/` | OAuth、HTTP/SSE、基础校验、上下文/产物目录、请求开关与模型支持快照 |
| `test/*/` | 按能力及共用基础设施分组的测试 |

每项能力由自己的 index.ts 暴露给入口。共享层不导入具体能力，Web 与 Image 不互相引用；请求开关通过注入的能力定义统一调度。独立工具的参数、产物路径和认证行为保持不变。

## 依据

Codex 对照版本 `ac192cd79`（2026-09-07）：`codex-rs/codex-api/src/{search,images}.rs` 及 `endpoint/` 定义请求；`codex-rs/ext/{web-search,image-generation}/src/` 展示调用方式。

Fast 字段依据 `codex-rs/protocol/src/config_types.rs` 的 ServiceTier::Fast → priority；模型能力依据本地 models-manager/models.json。

公开 [Images reference](https://developers.openai.com/api/reference/resources/images)、[图片指南](https://developers.openai.com/api/docs/guides/image-generation) 和 [Web search 指南](https://developers.openai.com/api/docs/guides/tools-web-search) 仅供参考，不代表 Codex 端点完整支持这些 API。实际观察见 [能力实测](capability-probes.md)。
