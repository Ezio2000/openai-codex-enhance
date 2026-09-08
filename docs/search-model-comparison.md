# Luna / Astra 搜索对比

2026-09-07，用 Codex OAuth 测试 `/alpha/search`，只改变请求的 model 字段。两个搜索任务、一个网页打开任务，各做 4 轮，交替顺序，共 24 次串行请求。

共用 session ID，不附带对话；external_web_access=true、response_length=short、max_output_tokens=1500。耗时包含网络和完整响应读取，不是纯推理耗时。

| 指标 | gpt-5.6-luna | gpt-6-astra |
|---|---:|---:|
| 成功 | 12/12 | 12/12 |
| 耗时中位数 | 2.31 秒 | 2.30 秒 |
| 平均耗时 | 2.52 秒 | 2.45 秒 |

对应请求的返回正文统一引用编号后全部相同，URL 集合也相同。比较受本次输出预算和小样本限制，未观察到 Luna 的总体速度优势。

响应没有 usage、费用、实际执行模型或应用级缓存命中指标。`cf-cache-status: DYNAMIC` 不能说明内部搜索缓存情况，因而无法证明 Luna 更便宜或缓存更好。

**当前按用户选择固定 Luna，这是配置偏好，不是性能或费用结论。**

复现：`npx tsx scripts/compare-search-models.ts --run`，会消耗 24 次搜索请求额度，无图片调用、无自动重试。

原始脱敏记录：`artifacts/search-model-comparison/40d3b542-df54-4287-9050-9bb0a6aadd57/results.json`。
