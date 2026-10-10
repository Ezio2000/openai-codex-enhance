import { Type } from "typebox";
import { Value } from "typebox/value";
import { resolve } from "node:path";
import type { Content, ExecutionContext, ToolDefinition, ToolResult } from "../../../core/src/contracts.ts";
import { AppsClient, type AppResult, type AppTool, type UploadedFile } from "./apps.ts";
import { resolveAppsAuth } from "./auth.ts";

const schemas = (names: readonly string[]) =>
  Type.Object(
    {
      action: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("call")], {
        description: "list operations, get the exact parameter schema, or call an operation.",
      }),
      tool: Type.Optional(Type.Union(names.map((name) => Type.Literal(name)))),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, default: 120 })),
    },
    { additionalProperties: false },
  );

export const SPACE_OPERATIONS = [
  "list_spaces",
  "get_space",
  "list_pages",
  "find_pages",
  "read_page",
  "create_page",
  "edit_page",
  "patch_page",
  "write_page_reference",
  "inspect_page_reference",
  "read_page_reference",
] as const;
export const SITES_OPERATIONS = [
  "list_sites",
  "get_site",
  "list_site_versions",
  "get_site_version",
  "get_deployment_status",
] as const;

export function appResult(result: AppResult): ToolResult {
  const content: Content[] = [];
  const structuredContent: ToolResult["structuredContent"] = result.structuredContent
    ? JSON.parse(JSON.stringify(result.structuredContent))
    : undefined;
  for (const part of result.content ?? []) {
    if (part.type === "text" && typeof part.text === "string")
      content.push({ type: "text", text: part.text });
    else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string")
      content.push({ type: "image", data: part.data, mimeType: part.mimeType });
    else if (part.type === "resource_link")
      content.push({ type: "text", text: `[${part.name || "Resource"}](${part.uri})` });
    else content.push({ type: "text", text: JSON.stringify(part) });
  }
  if (result.structuredContent) {
    const json = JSON.stringify(result.structuredContent);
    if (!content.some((c) => c.type === "text" && c.text === json))
      content.push({ type: "text", text: json });
  }
  if (result.isError)
    content.unshift({
      type: "text",
      text: "Tool error. Inspect the returned state before retrying a write.",
    });
  return {
    content,
    details: { remoteResult: result },
    ...(structuredContent ? { structuredContent } : {}),
    isError: result.isError ?? false,
  };
}

export function appsTool(
  kind: "space" | "sites",
  deps: { client(ctx: ExecutionContext): AppsClient } = {
    client: (ctx) => new AppsClient(() => resolveAppsAuth(ctx)),
  },
): ToolDefinition {
  const names = kind === "space" ? SPACE_OPERATIONS : SITES_OPERATIONS;
  const prefix = kind === "space" ? "chatgpt_space" : "sites";
  const connectorId =
    kind === "space" ? "connector_openai_pages" : "connector_20205bf7d4e99a89d7154bb849718324";
  const schema = schemas(names);
  return {
    name: kind,
    label: kind === "space" ? "Space 页面" : "Sites 查询",
    description:
      kind === "space"
        ? "Find, read, create and edit ordinary ChatGPT Space pages, and upload local images/files (up to 10 MiB) using existing Codex OAuth. Use action=get and a tool name to read its current parameter schema before calling. Uploads return references; insert the returned Markdown with edit_page. Native spreadsheets/slides/Canvas, schedules and sharing are not included."
        : "Query ChatGPT Sites, saved versions and deployment status using existing Codex OAuth. Read-only: no creation, deployment or scheduling. Use action=get with a tool name to read its current parameter schema, then action=call with arguments.",
    promptSnippet:
      kind === "space"
        ? "Read and write ChatGPT Space pages and upload attachments"
        : "Query ChatGPT Sites and deployment status",
    promptGuidelines: [
      "Use list to discover available operations; get returns the complete live schema and instructions. Follow returned pagination cursors, including empty pages with a next cursor.",
      "Copy exact IDs from results. A Space ID is not a Page ID; get_space returns its root_page_id.",
      ...(kind === "space"
        ? [
            "Read an existing page before editing; retain its guidance, block IDs and hashes. After a write, read back the affected page to verify.",
            "For write_page_reference, arguments.file accepts a local path relative to the working directory or an already uploaded file object. Uploading does not insert the image; use the returned reference/Markdown in edit_page.",
            "Writes are never automatically retried. Reuse idempotency keys when specified by the live schema; inspect remote state after an uncertain outcome.",
          ]
        : []),
    ],
    parameters: schema,
    async execute(_callId, args, signal, _onUpdate, ctx) {
      if (!Value.Check(schema, args))
        throw new Error(`Invalid ${kind} parameters; use the current tool schema.`);
      if (args.action === "list" && (args.tool || args.arguments))
        throw new Error("list does not accept tool or arguments.");
      if (args.action !== "list" && !args.tool) throw new Error("get and call require tool.");
      if (args.action !== "call" && args.arguments) throw new Error("Only call accepts arguments.");
      const deadline = AbortSignal.timeout((args.timeout_seconds ?? 120) * 1000);
      const signals = [deadline, signal, ctx.signal].filter((s): s is AbortSignal => !!s);
      const abort = AbortSignal.any(signals);
      abort.throwIfAborted();
      const client = deps.client({ ...ctx, signal: abort });
      let uploaded: UploadedFile | undefined;
      try {
        await client.connect(abort);
        const tools = (await client.listTools(abort)).filter(
          (t) =>
            t._meta?.connector_id === connectorId && names.some((name) => t.name === `${prefix}.${name}`),
        );
        if (args.action === "list")
          return appResult({
            structuredContent: {
              tools: tools.map((t) => ({
                name: t.name.slice(prefix.length + 1),
                description: t.description,
              })),
              ...(tools.length
                ? {}
                : {
                    guidance:
                      "No supported operations are available for this account. Check the ChatGPT app connection and account access.",
                  }),
            },
          });
        const tool = tools.find((t) => t.name === `${prefix}.${args.tool}`);
        if (!tool) throw new Error(`${args.tool} is not available for this account; use action=list.`);
        if (args.action === "get") {
          const view: AppTool = structuredClone(tool);
          if (args.tool === "write_page_reference")
            view.inputSchema.properties.file = {
              anyOf: [
                {
                  type: "string",
                  description:
                    "Local file path; at most 10 MiB. Relative paths resolve from the working directory.",
                },
                view.inputSchema.properties.file,
              ],
            };
          return appResult({ structuredContent: { ...view, name: args.tool } });
        }
        const parameters: Record<string, unknown> = { ...(args.arguments ?? {}) };
        if (args.tool === "write_page_reference" && typeof parameters.file === "string") {
          if (typeof parameters.page_id !== "string" || !parameters.page_id)
            throw new Error("write_page_reference requires page_id before uploading.");
          uploaded = await client.upload(resolve(ctx.cwd, parameters.file), abort);
          parameters.file = uploaded;
        }
        const result = appResult(await client.call(tool.name, parameters, abort));
        if (uploaded) {
          result.details.uploadedFile = uploaded;
          if (result.isError)
            result.content.push({
              type: "text",
              text: `The file was uploaded. Reuse this file object after resolving the attachment error: ${JSON.stringify(uploaded)}`,
            });
        }
        return result;
      } catch (error) {
        const message = abort.aborted
          ? "Operation cancelled or timed out."
          : error instanceof Error
            ? error.message
            : String(error);
        throw new Error(
          `${message} No operation was automatically retried.${uploaded ? ` File already uploaded; reuse arguments.file=${JSON.stringify(uploaded)}.` : ""}${args.action === "call" && kind === "space" ? " Check remote state before repeating a write." : ""}`,
        );
      } finally {
        await client.close();
      }
    },
  };
}
