import test from "node:test";
import assert from "node:assert/strict";
import { appsTool, appResult } from "../../../../packages/transports/openai/src/apps-tool.ts";
import type { AppsClient, AppResult, AppTool } from "../../../../packages/transports/openai/src/apps.ts";
import type { ExecutionContext } from "../../../../packages/core/src/contracts.ts";
const ctx: ExecutionContext = {
  cwd: "/workspace",
  sessionId: "s",
  host: "test",
  credentials: { resolve: async () => ({ status: "missing", guidance: "fixture" }) },
};
const tool: AppTool = {
  name: "chatgpt_space.write_page_reference",
  _meta: { connector_id: "connector_openai_pages" },
  inputSchema: { properties: { file: { type: "object" } } },
};
const uploaded = { file_id: "file-1", download_url: "https://file.example/1" };
function fake(
  result: AppResult = {
    structuredContent: { reference: "library-file:libfile-1", markdown: "![image](library-file:libfile-1)" },
  },
) {
  const calls: any[] = [];
  let closed = 0;
  const client = {
    connect: async () => {},
    listTools: async () => [tool],
    upload: async (path: string) => {
      calls.push(path);
      return uploaded;
    },
    call: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return result;
    },
    close: async () => {
      closed++;
    },
  } as unknown as AppsClient;
  return { instance: appsTool("space", { client: () => client }), calls, closed: () => closed };
}

test("Space exposes a local-path upload schema and uploads before attaching without inserting", async () => {
  const f = fake();
  const schema = await f.instance.execute(
    "1",
    { action: "get", tool: "write_page_reference" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((schema.structuredContent?.inputSchema as any).properties.file.anyOf[0].type, "string");
  assert.equal(tool.inputSchema.properties.file.type, "object", "remote schema is not mutated");
  const result = await f.instance.execute(
    "2",
    { action: "call", tool: "write_page_reference", arguments: { page_id: "page-1", file: "image.png" } },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(f.calls, [
    "/workspace/image.png",
    { name: tool.name, args: { page_id: "page-1", file: uploaded } },
  ]);
  assert.match(JSON.stringify(result.content), /library-file/);
  assert.equal(f.closed(), 2);
});

test("Space preserves uploaded references after an attachment error and forwards existing objects without uploading again", async () => {
  const f = fake({ isError: true, structuredContent: { error: { code: "page_denied" } } });
  const result = await f.instance.execute(
    "1",
    { action: "call", tool: "write_page_reference", arguments: { page_id: "page-1", file: "image.png" } },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(result.isError, true);
  assert.deepEqual(result.details.uploadedFile, uploaded);
  assert.match(JSON.stringify(result.content), /Reuse this file object/);
  await f.instance.execute(
    "2",
    { action: "call", tool: "write_page_reference", arguments: { page_id: "page-1", file: uploaded } },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(f.calls.filter((call) => typeof call === "string").length, 1);
});

test("Space rejects unsupported operations and incomplete upload targets before uploading", async () => {
  const f = fake();
  await assert.rejects(
    f.instance.execute("1", { action: "call", tool: "execute_artifact_code" }, undefined, undefined, ctx),
    /Invalid/,
  );
  await assert.rejects(
    f.instance.execute(
      "2",
      { action: "call", tool: "write_page_reference", arguments: { file: "image.png" } },
      undefined,
      undefined,
      ctx,
    ),
    /page_id/,
  );
  assert.deepEqual(f.calls, []);
});

test("MCP structure, block hashes, images and errors remain visible to both hosts", () => {
  const remote = {
    structuredContent: { content: { blocks: [{ id: "b", hash: "hash", markdown: "hello" }] } },
    content: [{ type: "image", data: "png", mimeType: "image/png" }],
    isError: true,
  };
  const result = appResult(remote);
  assert.deepEqual(result.structuredContent, remote.structuredContent);
  assert.match(JSON.stringify(result.content), /hash/);
  assert.ok(result.content.some((part) => part.type === "image"));
  assert.equal(result.isError, true);
});
