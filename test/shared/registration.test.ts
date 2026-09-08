import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import enhance from "../../index.ts";
import { ctx } from "../helpers.ts";

function harness() {
  const tools: ToolDefinition<any, any>[] = [];
  const events = new Map<string, (event: any, context: ExtensionContext) => unknown>();
  const commands = new Map<string, { handler(args: string, context: ExtensionContext): Promise<void> }>();
  let active = ["read", "bash", "unrelated_tool"];
  const pi = {
    registerTool: (tool: ToolDefinition<any, any>) => tools.push(tool),
    registerCommand: (name: string, command: { handler(args: string, context: ExtensionContext): Promise<void> }) => commands.set(name, command),
    on: (name: string, handler: (event: any, context: ExtensionContext) => unknown) => {
      const previous = events.get(name);
      events.set(name, (event, context) => { previous?.(event, context); return handler(event, context); });
    },
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => { active = names; },
  } as unknown as ExtensionAPI;
  enhance(pi);
  return { tools, events, commands, active: () => active };
}

test("capability registration keeps all tools active across providers with one unified settings command", async () => {
  const h = harness();
  assert.deepEqual(h.tools.map(tool => tool.name), ["codex_web", "codex_image", "codex_computer"]);
  assert.deepEqual([...h.events.keys()].sort(), ["agent_settled", "before_agent_start", "before_provider_request", "model_select", "session_shutdown", "session_start", "session_tree", "thinking_level_select"]);
  assert.deepEqual([...h.commands.keys()], ["openai-codex-enhance"]);
  const context = ctx("/unused");
  h.events.get("session_start")!({}, context);
  assert.deepEqual(h.active(), ["read", "bash", "unrelated_tool", "codex_web", "codex_image", "codex_computer"]);
  h.events.get("model_select")!({}, context);
  assert.equal(h.active().filter(name => name === "codex_web").length, 1);
  const other = { ...context, model: { ...context.model!, provider: "other" } };
  h.events.get("model_select")!({}, other);
  assert.deepEqual(h.active(), ["read", "bash", "unrelated_tool", "codex_web", "codex_image", "codex_computer"]);
  h.events.get("model_select")!({}, { ...context, model: undefined });
  assert.deepEqual(h.active(), ["read", "bash", "unrelated_tool", "codex_web", "codex_image", "codex_computer"]);
  const otherStart = harness();
  otherStart.events.get("session_start")!({}, other);
  assert.deepEqual(otherStart.active(), h.active());
});

test("web/image on another provider still require stored Codex OAuth; computer stays cross-channel", async () => {
  const h = harness();
  const base = ctx("/unused");
  const context = { ...base, model: { ...base.model!, provider: "other" } };
  await assert.rejects(h.tools[0]!.execute("call", { time: [{ utc_offset: "+08:00" }] }, undefined, undefined, context), /login openai-codex/);
  await assert.rejects(h.tools[1]!.execute("call", { prompt: "test" }, undefined, undefined, context), /login openai-codex/);
  // codex_computer no longer gates on the provider; abort before touching the real local runtime.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.tools[2]!.execute("call", { code: "await cua.getState()" }, controller.signal, undefined, context), /abort/i);
});
