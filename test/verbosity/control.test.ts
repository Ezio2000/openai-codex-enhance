import test from "node:test";
import assert from "node:assert/strict";
import { verbosityControl } from "../../src/capabilities/verbosity/index.ts";
import { deepFreeze, model } from "../request-control-helpers.ts";

test("verbosity preserves structured format and other request fields without mutating input", () => {
  const payload = deepFreeze({ text: { verbosity: "low", format: { type: "json_schema", schema: { type: "object" } } }, reasoning: { effort: "xhigh" }, instructions: "keep", tools: [] });
  for (const value of ["low", "medium", "high"]) {
    const result = verbosityControl.transform(payload, value);
    assert.deepEqual(result, { ...payload, text: { ...payload.text, verbosity: value } });
    assert.equal((result.text as any).format, payload.text.format);
    assert.equal(result.reasoning, payload.reasoning);
  }
  assert.equal(payload.text.verbosity, "low");
  assert.equal(verbosityControl.transform(payload, "off"), payload);
  assert.equal(verbosityControl.transform(payload, "invalid"), payload);
  assert.deepEqual(verbosityControl.transform({}, "medium"), { text: { verbosity: "medium" } });
  const malformed = { text: "do not rewrite this" };
  assert.equal(verbosityControl.transform(malformed, "high"), malformed);
  assert.equal(verbosityControl.supported(model("gpt-5.6-luna")), true);
  assert.equal(verbosityControl.supported(model("unknown")), false);
});
