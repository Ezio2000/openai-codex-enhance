import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ProtocolAuth, ResolveAuth } from "./types.ts";
import { abortable, isRecord, readJSON, readSSE, responseError } from "./http.ts";
import { clientInfo } from "../../version.ts";

export interface AppTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, any>;
  [key: string]: unknown;
}
export interface AppResult {
  content?: Array<Record<string, any>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}
export interface UploadedFile {
  file_id: string;
  download_url: string;
  file_name?: string;
  mime_type?: string;
}

/** One invocation owns one MCP session. No writes or failed calls are replayed. */
export class AppsClient {
  private id = 0;
  private session?: string;
  private protocol?: string;
  private auth?: ProtocolAuth;
  constructor(
    private readonly resolveAuth: ResolveAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, body: unknown, signal: AbortSignal, mcp = false): Promise<Response> {
    signal.throwIfAborted();
    const auth = await abortable(this.resolveAuth(), signal);
    if (
      this.auth &&
      new Headers(this.auth.headers).get("chatgpt-account-id") !==
        new Headers(auth.headers).get("chatgpt-account-id")
    )
      throw new Error(
        "The ChatGPT account changed during this operation; inspect its state before retrying.",
      );
    this.auth = auth;
    signal.throwIfAborted();
    const headers = new Headers(this.auth.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json, text/event-stream");
    if (mcp && this.session) headers.set("Mcp-Session-Id", this.session);
    if (mcp && this.protocol) headers.set("MCP-Protocol-Version", this.protocol);
    const response = await this.fetchImpl(new URL(path, this.auth.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      const error = await readJSON(response, 64 * 1024, signal).catch(() => ({}));
      throw responseError(error, response.status);
    }
    if (mcp) this.session = response.headers.get("mcp-session-id") ?? this.session;
    return response;
  }

  private async rpc(method: string, params: unknown, signal: AbortSignal, notify = false): Promise<any> {
    const id = ++this.id;
    const response = await this.request(
      "ps/mcp",
      {
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
        ...(notify ? {} : { id }),
      },
      signal,
      true,
    );
    if (notify) {
      await response.body?.cancel();
      return;
    }
    let reply: unknown;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for await (const event of readSSE(response, 32 * 1024 * 1024, signal)) {
        if (isRecord(event.data) && event.data.id === id) {
          reply = event.data;
          break;
        }
      }
    } else reply = await readJSON(response, 32 * 1024 * 1024, signal);
    if (!isRecord(reply) || reply.id !== id) throw new Error(`Missing MCP response for ${method}.`);
    if (reply.error) throw new Error(`MCP ${method}: ${JSON.stringify(reply.error)}`);
    if (!("result" in reply)) throw new Error(`Missing MCP result for ${method}.`);
    return reply.result;
  }

  async connect(signal: AbortSignal): Promise<void> {
    const result = await this.rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo,
      },
      signal,
    );
    this.protocol = result.protocolVersion;
    await this.rpc("notifications/initialized", undefined, signal, true);
  }

  async listTools(signal: AbortSignal): Promise<AppTool[]> {
    const tools: AppTool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.rpc("tools/list", cursor ? { cursor } : {}, signal);
      if (!Array.isArray(result.tools)) throw new Error("MCP returned an invalid tools catalog.");
      tools.push(...result.tools);
      cursor = result.nextCursor || undefined;
      if (cursor && cursors.has(cursor)) throw new Error("MCP repeated a tools cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<AppResult> {
    return this.rpc("tools/call", { name, arguments: args }, signal);
  }

  async upload(path: string, signal: AbortSignal): Promise<UploadedFile> {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    if (info.size > 10 * 1024 * 1024) throw new Error("Space attachments must be at most 10 MiB.");
    const bytes = await readFile(path, { signal });
    if (bytes.length > 10 * 1024 * 1024) throw new Error("Space attachments must be at most 10 MiB.");
    const create = {
      file_name: basename(path),
      file_size: bytes.length,
      use_case: "codex",
      codex_connector_id: "connector_openai_pages",
      codex_action_name: "write_page_reference",
    };
    const reservation: any = await readJSON(await this.request("files", create, signal), 64 * 1024, signal);
    if (!reservation.file_id || !reservation.upload_url)
      throw new Error("File reservation lacks its ID or upload URL.");
    const blob = await this.fetchImpl(reservation.upload_url, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-client-request-id": randomUUID(),
        "Content-Length": String(bytes.length),
      },
      body: bytes,
      signal,
      redirect: "error",
    });
    await blob.body?.cancel();
    if (!blob.ok)
      throw new Error(`Attachment byte upload failed (HTTP ${blob.status}); file_id=${reservation.file_id}.`);
    const until = Date.now() + 30_000;
    while (true) {
      const result: any = await readJSON(
        await this.request(
          `files/${encodeURIComponent(reservation.file_id)}/uploaded`,
          reservation.pdf_c2pa_reservation ? { pdf_c2pa_create_request: create } : {},
          signal,
        ),
        64 * 1024,
        signal,
      );
      if (result.status === "success" && typeof result.download_url === "string")
        return {
          file_id: reservation.file_id,
          download_url: result.download_url,
          file_name: result.file_name || basename(path),
          ...(result.mime_type ? { mime_type: result.mime_type } : {}),
        };
      if (result.status !== "retry" || Date.now() >= until)
        throw new Error(
          `Attachment finalization failed; file_id=${reservation.file_id}: ${result.error_message || result.status}`,
        );
      await delay(250, undefined, { signal });
    }
  }

  async close(): Promise<void> {
    if (!this.session || !this.auth) return;
    const headers = new Headers(this.auth.headers);
    headers.set("Mcp-Session-Id", this.session);
    if (this.protocol) headers.set("MCP-Protocol-Version", this.protocol);
    const response = await this.fetchImpl(new URL("ps/mcp", this.auth.baseUrl), {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    }).catch(() => undefined);
    await response?.body?.cancel();
    this.session = undefined;
  }
}
