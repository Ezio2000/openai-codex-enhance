import test from "node:test";
import assert from "node:assert/strict";
import { fastControl, fastCreditMultiplier } from "../../src/capabilities/fast/index.ts";
import { deepFreeze, model } from "../request-control-helpers.ts";

test("Fast requests priority without changing model, reasoning, cache keys or input", () => {
  const payload = deepFreeze({ model: "gpt-6-astra", input: [], service_tier: "flex", reasoning: { effort: "xhigh" }, prompt_cache_key: "session", parallel_tool_calls: true });
  const result = fastControl.transform(payload, "on");
  assert.deepEqual(result, { ...payload, service_tier: "priority" });
  assert.equal(result.input, payload.input);
  assert.equal(result.reasoning, payload.reasoning);
  assert.equal(payload.service_tier, "flex");
  assert.equal(fastControl.transform(payload, "off"), payload);
  assert.equal(fastControl.transform(result, "on"), result);
  assert.equal(fastControl.supported(model()), true);
  assert.equal(fastControl.supported(model("gpt-5.6-luna")), true);
  assert.equal(fastControl.supported(model("gpt-5.4-mini")), false);
  assert.equal(fastControl.supported(model("unknown")), false);
});

test("Fast labels distinguish ChatGPT credit multipliers and do not invent prices for unknown models", () => {
  assert.equal(fastCreditMultiplier("gpt-5.4"), 2);
  for (const id of ["gpt-6-astra", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) assert.equal(fastCreditMultiplier(id), 2.5);
  assert.equal(fastCreditMultiplier("unknown"), undefined);
  assert.equal(fastControl.formatValue!("on", model()), "on(2.5x)");
  assert.equal(fastControl.formatValue!("on", model("gpt-5.4")), "on(2x)");
  assert.equal(fastControl.formatValue!("off", model()), "off");
});
