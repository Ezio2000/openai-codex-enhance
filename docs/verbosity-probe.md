# Verbosity 实测

2026-09-07，真实 Codex OAuth `POST /backend-api/codex/responses`，复用本扩展的 verbosity 转换函数。不是只检查 HTTP 200 或参数回显。

## 方法

- 模型固定 `gpt-6-astra`，reasoning.effort=low；不带历史、图片或工具，不开启 Fast。
- 同一提示分别传 text.verbosity=low / medium / high，其他请求内容保持一致。
- 两个英文提示：数据库索引原理/何时不建索引；支付 API 的重试策略。
- 第一组顺序 low→medium→high，第二组 high→medium→low。每组合各一次，共 6 次有效响应，无自动重试。
- 响应均报告 model=gpt-6-astra、service_tier=default，并回显对应 verbosity。正文从 output_text SSE delta 收集；本次 completed 事件未附带正文。

## 结果

| 提示 | 等级 | 英文词数（空白分词） | 正文输出 tokens¹ | 耗时 |
|---|---|---:|---:|---:|
| 数据库索引 | low | 429 | 598 | 26.7 s |
| 数据库索引 | medium | 986 | 1350 | 46.5 s |
| 数据库索引 | high | 1481 | 2021 | 71.7 s |
| 支付 API 重试 | low | 460 | 637 | 24.7 s |
| 支付 API 重试 | medium | 726 | 1011 | 39.0 s |
| 支付 API 重试 | high | 1059 | 1469 | 55.9 s |

¹ usage.output_tokens 减去 reasoning_tokens。第二组 low/high 分别有 28/27 个推理 tokens，其余为 0。

**结论：本次 Astra 实测中等级有效，两个提示均随等级升高生成更多细节。** 数据库 high 展开了更多不适用场景及实践步骤；支付策略 high 增加了前台重试与后台恢复的区分。它是详细程度偏好，不是固定字数、严格上限或每次单调递增保证；样本仅两题，不能泛化为所有模型。更多正文也意味着更多输出用量，本轮响应更长时耗时也更长。

## 复现与产物

```bash
npx tsx scripts/probe-verbosity.ts --run
```

这会消耗主模型额度；仅使用尚未过期的本地 OAuth，不刷新凭据、不自动重试、不保存认证或推理正文。

有效报告：`artifacts/verbosity/4a204685-defc-4c53-a9c1-60b7a40a8b82/results.json`，含提示、请求、正文、usage 和时间，不提交或打包。

采集修正前另有一轮 `b3106183-e587-4a16-b685-85d7cf4ce8fe`：前两次请求完成，但只读取 completed 而未收集 delta，正文未捕获，故不纳入上述对比；第三次在本地终止，远端可能继续计算。这些请求同样可能消耗额度，不能当作未发生。
