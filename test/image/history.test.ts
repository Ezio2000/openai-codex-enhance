import test from "node:test";
import assert from "node:assert/strict";
import { contextMessages } from "../../src/shared/context.ts";
import { recentImages } from "../../src/capabilities/image/history.ts";

test("context reconstruction handles compaction retainedTail; images prefer originals", () => {
  const messages = contextMessages([
    { type: "compaction", retainedTail: [{ role: "user", content: "kept" }] },
    { type: "custom", data: { role: "user", content: "not a message" } },
    { type: "message", message: { role: "toolResult", toolName: "codex_image", details: { version: 1, images: [{ path: "/original.png" }] }, content: [{ type: "image", mimeType: "image/png", data: "preview" }] } },
  ]);
  assert.equal(messages.length, 2);
  assert.deepEqual(recentImages(messages, 1), [{ path: "/original.png" }]);
  assert.throws(() => recentImages(messages, 2), /Only 1/);
});
