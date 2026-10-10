import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppsClient } from "../../../packages/transports/openai/src/apps.ts";

const auth = async () => ({
  baseUrl: "https://chatgpt.com/backend-api/",
  headers: { Authorization: "Bearer fixture", "ChatGPT-Account-ID": "account" },
});
const json = (value: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json", ...headers } });
const signal = () => AbortSignal.timeout(5000);

test("Apps rereads refreshed credentials between requests without switching accounts", async () => {
  let resolved = 0;
  const seen: string[] = [];
  const client = new AppsClient(
    async () => ({
      baseUrl: "https://chatgpt.com/backend-api/",
      headers: {
        Authorization: `Bearer token-${++resolved}`,
        "ChatGPT-Account-ID": resolved < 3 ? "same" : "changed",
      },
    }),
    (async (_url, init) => {
      seen.push(new Headers(init?.headers).get("authorization")!);
      return json({ id: JSON.parse(String(init?.body)).id, result: { content: [] } });
    }) as typeof fetch,
  );
  await client.call("read_page", {}, signal());
  await client.call("read_page", {}, signal());
  await assert.rejects(client.call("edit_page", {}, signal()), /account changed/);
  assert.deepEqual(seen, ["Bearer token-1", "Bearer token-2"]);
});

test("Apps cancellation interrupts an unresponsive credential resolver", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("cancelled auth")), 20);
  try {
    const client = new AppsClient(
      () => new Promise(() => {}),
      async () => {
        throw new Error("unexpected network");
      },
    );
    await assert.rejects(client.connect(controller.signal), /cancelled auth/);
  } finally {
    clearTimeout(timer);
  }
});

test("Apps MCP negotiates session headers, follows catalogs and reads matching SSE without waiting for stream close", async () => {
  const requests: any[] = [];
  let streamCancelled = false;
  const client = new AppsClient(auth, (async (_url, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "DELETE") {
      assert.equal(headers.get("mcp-session-id"), "session");
      return new Response(null, { status: 204 });
    }
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    assert.equal(headers.get("authorization"), "Bearer fixture");
    if (request.method === "initialize")
      return json(
        { id: request.id, result: { protocolVersion: "2025-06-18" } },
        { "mcp-session-id": "session" },
      );
    assert.equal(headers.get("mcp-session-id"), "session");
    assert.equal(headers.get("mcp-protocol-version"), "2025-06-18");
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/list")
      return json({
        id: request.id,
        result: request.params.cursor ? { tools: [{ name: "b" }] } : { tools: [], nextCursor: "next" },
      });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ method: "notifications/progress" })}\r\n\r\ndata: ${JSON.stringify({ id: request.id, result: { structuredContent: { value: "中文" }, isError: false } })}\r\n\r\n`,
            ),
          );
        },
        cancel() {
          streamCancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch);
  await client.connect(signal());
  assert.equal((await client.listTools(signal()))[0]!.name, "b");
  assert.deepEqual((await client.call("b", {}, signal())).structuredContent, { value: "中文" });
  assert.equal(streamCancelled, true);
  assert.deepEqual(requests.at(-1).params, { name: "b", arguments: {} });
  await client.close();
});

test("Apps does not replay failed writes, preserves MCP tool errors, and stops repeated pagination", async () => {
  let calls = 0;
  const client = new AppsClient(auth, (async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === "tools/list")
      return json({ id: request.id, result: { tools: [], nextCursor: "same" } });
    calls++;
    return calls === 1
      ? new Response("failure", { status: 502 })
      : json({
          id: request.id,
          result: { isError: true, structuredContent: { error: { code: "conflict" } } },
        });
  }) as typeof fetch);
  await assert.rejects(client.call("create_page", {}, signal()), /HTTP 502/);
  assert.equal(calls, 1);
  assert.equal((await client.call("patch_page", {}, signal())).isError, true);
  await assert.rejects(client.listTools(signal()), /repeated/);
  const aborted = AbortSignal.abort();
  await assert.rejects(client.call("create_page", {}, aborted));
  assert.equal(calls, 2);
});

test("Space attachment upload sends bytes to the reservation URL, handles PDF reservation and finalization retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "apps-upload-"));
  const path = join(root, "sample.pdf");
  const bytes = Buffer.from("fixture bytes");
  await writeFile(path, bytes);
  const requests: any[] = [];
  let finalized = 0;
  try {
    const client = new AppsClient(auth, (async (url, init) => {
      requests.push({ url: String(url), init });
      if (init?.method === "PUT") {
        assert.equal(new Headers(init.headers).has("authorization"), false);
        assert.equal(new Headers(init.headers).get("x-ms-blob-type"), "BlockBlob");
        assert.deepEqual(init.body, bytes);
        return new Response(null, { status: 201 });
      }
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture");
      if (String(url).endsWith("/files"))
        return json({
          file_id: "file-1",
          upload_url: "https://blob.example/bytes",
          pdf_c2pa_reservation: true,
        });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.pdf_c2pa_create_request.codex_connector_id, "connector_openai_pages");
      assert.equal(body.pdf_c2pa_create_request.file_size, bytes.length);
      return json(
        ++finalized === 1
          ? { status: "retry" }
          : {
              status: "success",
              download_url: "https://download.example/file",
              mime_type: "application/pdf",
            },
      );
    }) as typeof fetch);
    assert.deepEqual(await client.upload(path, signal()), {
      file_id: "file-1",
      download_url: "https://download.example/file",
      file_name: "sample.pdf",
      mime_type: "application/pdf",
    });
    assert.equal(requests.length, 4);
    await writeFile(path, Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(client.upload(path, signal()), /10 MiB/);
    assert.equal(requests.length, 4, "oversize files are rejected before reserving an upload");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
