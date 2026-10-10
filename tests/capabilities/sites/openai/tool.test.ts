import test from "node:test";
import assert from "node:assert/strict";
import { appsTool } from "../../../../packages/transports/openai/src/apps-tool.ts";
import type { AppsClient } from "../../../../packages/transports/openai/src/apps.ts";
import type { ExecutionContext } from "../../../../packages/core/src/contracts.ts";
const ctx: ExecutionContext = {
  cwd: "/workspace",
  sessionId: "s",
  host: "test",
  credentials: { resolve: async () => ({ status: "missing", guidance: "fixture" }) },
};
test("Sites filters its catalog to the five read operations and passes opaque IDs unchanged", async () => {
  const calls: unknown[] = [];
  const tools = ["list_sites", "get_site", "create_site"].map((name) => ({
    name: `sites.${name}`,
    _meta: { connector_id: "connector_20205bf7d4e99a89d7154bb849718324" },
    inputSchema: { type: "object" },
  }));
  const client = {
    connect: async () => {},
    listTools: async () => tools,
    close: async () => {},
    call: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { structuredContent: { id: "appgprj_exact" } };
    },
  } as unknown as AppsClient;
  const instance = appsTool("sites", { client: () => client });
  const list = await instance.execute("1", { action: "list" }, undefined, undefined, ctx);
  assert.deepEqual(
    (list.structuredContent?.tools as any[]).map((t) => t.name),
    ["list_sites", "get_site"],
  );
  await assert.rejects(
    instance.execute("2", { action: "call", tool: "create_site" }, undefined, undefined, ctx),
    /Invalid/,
  );
  await instance.execute(
    "3",
    { action: "call", tool: "get_site", arguments: { project_id: "appgprj_exact" } },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(calls, [{ name: "sites.get_site", args: { project_id: "appgprj_exact" } }]);
});
