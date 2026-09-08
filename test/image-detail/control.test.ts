import test from "node:test";
import assert from "node:assert/strict";
import { imageDetailControl } from "../../src/capabilities/image-detail/index.ts";
import { deepFreeze, model } from "../request-control-helpers.ts";

test("original image detail patches user and tool image blocks, never embedded JSON, tool schemas or image bytes", () => {
  const image = { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAAA" };
  const fake = { type: "input_image", detail: "auto" };
  const payload = deepFreeze({ model: "gpt-6-astra", input: [
    { role: "user", content: [{ type: "input_text", text: JSON.stringify(fake) }, image] },
    { type: "message", role: "user", content: [image] },
    { type: "function_call_output", output: [image, { type: "input_text", text: "keep" }] },
    { type: "function_call_output", output: JSON.stringify([image]) },
    { type: "function_call", arguments: fake },
    { role: "assistant", content: [{ type: "output_text", text: "keep" }] },
    "unchanged", null,
  ], tools: [{ parameters: fake }], reasoning: { effort: "high" } });
  const result = imageDetailControl.transform(payload, "original") as typeof payload;
  const input = result.input as any[];
  assert.equal(input[0].content[1].detail, "original");
  assert.equal(input[1].content[0].detail, "original");
  assert.equal(input[2].output[0].detail, "original");
  assert.equal(input[0].content[1].image_url, image.image_url);
  assert.equal(input[0].content[0], (payload.input[0] as any).content[0]);
  for (let i = 3; i < payload.input.length; i++) assert.equal(input[i], payload.input[i]);
  assert.equal(result.tools, payload.tools);
  assert.equal(result.reasoning, payload.reasoning);
  assert.equal(image.detail, "auto");
  assert.equal(imageDetailControl.transform(payload, "off"), payload);
  assert.equal(imageDetailControl.transform(result, "original"), result);
  const noImages = { input: [{ role: "user", content: "plain text" }] };
  assert.equal(imageDetailControl.transform(noImages, "original"), noImages);
});

test("original detail requires both known model support and image input modality", () => {
  assert.equal(imageDetailControl.supported(model()), true);
  assert.equal(imageDetailControl.supported(model("gpt-5.6-luna")), true);
  assert.equal(imageDetailControl.supported(model("gpt-5.2")), false);
  assert.equal(imageDetailControl.supported(model("unknown")), false);
  assert.equal(imageDetailControl.supported({ ...model(), input: ["text"] }), false);
});
