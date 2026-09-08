import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerComputer } from "../../src/capabilities/computer/index.ts";
import { ComputerSession } from "../../src/capabilities/computer/session.ts";
import { ComputerMcp } from "../../src/capabilities/computer/mcp.ts";
import type { Runtime } from "../../src/capabilities/computer/runtime.ts";

function harness() {
  let starts = 0;
  const runtime = async (): Promise<Runtime> => {
    starts++;
    return { command: process.execPath, args: [fileURLToPath(new URL("./fixture.mjs", import.meta.url))],
      cwd: process.cwd(), env: {}, dispose: async () => {} };
  };
  const session = new ComputerSession(runtime);
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const pi = { registerTool() {}, on: (name: string, fn: any) => handlers.set(name, fn) } as unknown as ExtensionAPI;
  registerComputer(pi, "/unused", session);
  let idle = true;
  const ctx = { hasUI: false, isIdle: () => idle, model: { provider: "openai-codex" } } as ExtensionContext;
  return { session, runtime, handlers, starts: () => starts, idle: (value: boolean) => { idle = value; },
    emit: (name: string, event = {}) => handlers.get(name)?.(event, ctx),
    run: (code: string, signal?: AbortSignal) => session.run({ code, title: "test", callId: "call", sessionId: "session", model: "test", timeoutMs: 1000, signal }),
  };
}

test("automatic continuation retains runtime until agent_settled; next task receives reinitialization context", async () => {
  const h = harness();
  try {
    assert.equal(await h.emit("before_agent_start"), undefined);
    const first = await h.run("next");
    assert.equal(first.bridgeFreshRuntime, true);
    assert.equal(h.handlers.has("agent_end"), false);
    await h.emit("agent_end"); // Low-level retry/compaction boundary must not disconnect.
    assert.equal(await h.emit("before_agent_start"), undefined);
    const next = await h.run("next");
    assert.equal(next.bridgeGeneration, first.bridgeGeneration);
    assert.equal(next.bridgeFreshRuntime, false);
    assert.equal(JSON.parse(next.content[0].text).counter, 2);
    await h.emit("agent_settled");
    const status = h.session.status();
    assert.equal(status.connected, false);
    assert.equal(status.jsState, "not_initialized");
    assert.equal(status.lastCleanup?.reason, "agent_settled");
    assert.equal(status.lastCleanup?.hook, "ok");
    assert.equal(status.lastCleanup?.shutdown?.processGroupStopped, true);
    assert.equal(status.lastCleanup?.shutdown?.workspaceRemoved, true);
    assert.deepEqual(status.lastCleanup?.shutdown?.signalsSent, []); // EOF is sufficient for this fixture.
    const notice = await h.emit("before_agent_start");
    assert.equal(notice.message.display, false);
    assert.match(notice.message.content, /All previous JS variables\/app bindings are invalid/);
    const fresh = await h.run("next");
    assert.notEqual(fresh.bridgeGeneration, first.bridgeGeneration);
    assert.equal(h.starts(), 2);
  } finally { await h.session.reset(); }
});

test("settled cleanup rechecks idle after queued work; it must not terminate a new active run", async () => {
  const h = harness();
  try {
    const work = h.run("slow");
    const cleanup = h.emit("agent_settled");
    h.idle(false);
    await work; await cleanup;
    assert.equal(h.session.status().connected, true);
    h.idle(true);
    await h.emit("agent_settled");
    assert.equal(h.session.status().connected, false);
  } finally { await h.session.reset(); }
});

test("runtime errors surface uncertain state without resetting or replaying actions", async () => {
  const h = harness();
  try {
    const first = await h.run("next");
    const result = await h.run("error");
    assert.equal(result.isError, true);
    assert.equal(result.bridgeGeneration, first.bridgeGeneration);
    assert.equal(h.session.status().jsState, "unknown");
    assert.match(result.bridgeRecovery, /kernel state is uncertain/);
    assert.match((await h.emit("before_agent_start")).message.content, /Never replay/);
    assert.equal(h.starts(), 1);
    await h.run("next");
    assert.equal(h.session.status().jsState, "available");
  } finally { await h.session.reset(); }
});

test("cancel stops and diagnoses the runtime before the next call, without waiting for settling", async () => {
  const h = harness();
  try {
    await h.run("next");
    const controller = new AbortController();
    const work = h.run("hang", controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(work, /All previous JS variables\/app bindings are invalid/);
    assert.equal(h.session.status().lastCleanup?.reason, "transport_failure");
    assert.equal(h.session.status().lastCleanup?.shutdown?.processGroupStopped, true);
    assert.equal(h.session.status().generation, undefined);
    assert.equal(h.starts(), 1);
  } finally { await h.session.reset(); }
});

test("failed cleanup hooks remain visible; tree and shutdown still stop immediately", async () => {
  const h = harness();
  try {
    await h.run("cleanup-error");
    await h.emit("agent_settled");
    assert.equal(h.session.status().lastCleanup?.hook, "error");
    for (const event of ["session_tree", "session_shutdown"]) {
      await h.run("next"); await h.emit(event);
      assert.equal(h.session.status().connected, false);
      assert.equal(h.session.status().lastCleanup?.reason, event);
    }
  } finally { await h.session.reset(); }
});

test("shutdown escalates a stubborn owned process and records workspace cleanup failure", async () => {
  const h = harness();
  const runtime = await h.runtime();
  const client = new ComputerMcp({ ...runtime, dispose: async () => { throw new Error("test disposal failure"); } }, async () => ({ action: "decline" }));
  try {
    await client.initialize();
    await client.call("js", { code: "stubborn" }, {}, 1000);
    await client.close();
    assert.deepEqual(client.shutdown?.signalsSent, ["SIGTERM", "SIGKILL"]);
    assert.equal(client.shutdown?.processGroupStopped, true);
    assert.equal(client.shutdown?.workspaceRemoved, false);
    const report = client.shutdown;
    await client.close();
    assert.equal(client.shutdown, report);
  } finally { await client.close(); }
});
