import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, type Component, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { CONTROL_COMMAND, CONTROL_ENTRY, CONTROL_STATUS, controlStatus, defaultControlState, registerRequestControls, restoreControlState, transformControlledRequest } from "../../src/shared/request-controls.ts";
import type { ControlManagement } from "../../src/shared/control-management.ts";
import { FileControlSettings } from "../../src/shared/control-settings.ts";
import { controls, deepFreeze, model } from "../request-control-helpers.ts";

initTheme("dark", false);
const allOn = { verbosity: "high", "image-detail": "original", fast: "on" };
const payload = () => ({ model: "gpt-6-astra", input: [{ role: "user", content: [{ type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAAA" }] }], text: { verbosity: "low" }, tools: [], prompt_cache_key: "session" });
const saved = (values: Record<string, string>) => ({ type: "custom", customType: CONTROL_ENTRY, data: { version: 1, values } });

function harness(t: TestContext, initialBranch: unknown[] = [], existingPath?: string, management: readonly ControlManagement[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "codex-control-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new FileControlSettings(existingPath ?? join(dir, "settings.json"), controls);
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  let command: Parameters<ExtensionAPI["registerCommand"]>[1];
  let currentModel: ExtensionContext["model"] = model();
  let thinkingLevel: ExtensionContext["thinkingLevel"] = "low";
  let branch = [...initialBranch];
  let sessionId = "session-a";
  let hasUI = true;
  let failPersist = false;
  let panel: Component | undefined;
  let closed = 0;
  let footer: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
  let wrapper: ((current: AutocompleteProvider) => AutocompleteProvider) | undefined;
  const statuses = new Map<string, string>();
  const notifications: { text: string; level?: string }[] = [];
  const context = () => ({ model: currentModel, get thinkingLevel() { return thinkingLevel; }, hasUI, mode: hasUI ? "tui" : "print", cwd: "/unused",
    getContextUsage: () => ({ percent: 0 }),
    sessionManager: { getSessionId: () => sessionId, getBranch: () => branch, getEntries: () => branch, getSessionName: () => undefined },
    ui: {
      setStatus: (key: string, text: string | undefined) => { if (text === undefined) statuses.delete(key); else statuses.set(key, text); },
      notify: (text: string, level?: string) => notifications.push({ text, level }),
      addAutocompleteProvider: (factory: typeof wrapper) => { wrapper = factory; },
      setFooter: (factory: typeof footer) => { footer = factory; },
      custom: (factory: any) => new Promise<void>(resolve => {
        panel = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {},  () => { closed++; resolve(); });
      }),
    },
  }) as unknown as ExtensionContext;
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand: (name: string, definition: Parameters<ExtensionAPI["registerCommand"]>[1]) => { assert.equal(name, CONTROL_COMMAND); command = definition; },
    appendEntry: () => { throw new Error("New preferences must not be saved to session history"); },
  } as unknown as ExtensionAPI;
  registerRequestControls(pi, controls, { load: () => store.load(), update: (patch, fallback) => {
    if (failPersist) throw new Error("disk full");
    return store.update(patch, fallback);
  } }, management);
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, context());
  emit("session_start");
  return {
    footer: () => footer,
    emit, statuses, notifications, context, store, panel: () => panel!, closed: () => closed, wrapper: () => wrapper!,
    run: (args: string) => command.handler(args, context() as ExtensionCommandContext),
    complete: (prefix: string) => command.getArgumentCompletions!(prefix),
    request: (body: unknown = payload()) => emit("before_provider_request", { payload: body }),
    renderFooter: () => {
      assert.equal(typeof footer, "function");
      return footer!({ requestRender() {} } as any, { fg: (_colour: string, text: string) => text } as any, {
        getGitBranch: () => null,
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => {},
      } as any).render(120).join("\n");
    },
    setModel: (value: ExtensionContext["model"]) => { currentModel = value; emit("model_select", { model: value }); },
    setThinkingLevel: (value: ExtensionContext["thinkingLevel"]) => { thinkingLevel = value; emit("thinking_level_select", { level: value }); },
    setUI: (value: boolean) => { hasUI = value; },
    setBranch: (value: unknown[]) => { branch = value; emit("session_tree"); },
    setSession: (id: string, value: unknown[]) => { emit("session_shutdown"); sessionId = id; branch = value; emit("session_start"); },
    failPersist: () => { failPersist = true; },
  };
}

test("computer operations share command completion and panel without persisting grants/actions", async t => {
  const calls: string[] = [];
  const section: ControlManagement = {
    id: "computer", label: "Computer Use", status: () => "Computer Use: disconnected",
    actions: ["status", "reset", "revoke"].map(id => ({ id, description: id })),
    run: async action => { calls.push(action); return `Done ${action}`; },
  };
  const h = harness(t, [], undefined, [section]);
  assert.ok((await h.complete(""))!.some(i => i.value === "computer"));
  assert.deepEqual((await h.complete("computer "))!.map(i => i.value), ["computer status", "computer reset", "computer revoke"]);
  for (const action of ["status", "reset", "revoke"]) await h.run(`computer ${action}`);
  assert.deepEqual(calls, ["status", "reset", "revoke"]);
  await h.run("computer invalid");
  assert.equal(calls.length, 3);
  const pending = h.run("computer");
  const panel = h.panel();
  assert.match(panel.render(90).join("\n"), /Computer Use/);
  panel.handleInput!(" "); // Open management submenu; never reset on opening.
  assert.equal(calls.length, 3);
  panel.handleInput!("\x1b[B"); panel.handleInput!("\r");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1), "reset");
  assert.match(panel.render(90).join("\n"), /Done reset/);
  panel.handleInput!("\x1b"); // Back to settings, not close.
  assert.equal(h.closed(), 0);
  panel.handleInput!("\x1b"); await pending;
  panel.handleInput!("\r"); assert.equal(calls.length, 4);
  assert.equal(h.store.load(), undefined);
  h.setModel(model("other", "anthropic"));
  assert.deepEqual((await h.complete("computer "))!.map(i => i.value), ["computer status", "computer reset", "computer revoke"]);
  await h.run("computer reset"); assert.equal(calls.length, 5);
  const other = h.run("computer");
  h.panel().handleInput!(" "); h.panel().handleInput!("\r");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1), "status");
  h.panel().handleInput!("\x1b"); h.panel().handleInput!("\x1b"); await other;
  await h.run("status");
  assert.match(h.notifications.at(-1)!.text, /Computer Use: disconnected/);
  assert.equal(h.store.load(), undefined);
});

test("closed management panels cannot dispatch stale actions", async t => {
  let count = 0;
  const section: ControlManagement = { id: "computer", label: "Computer Use", status: () => "idle",
    actions: [{ id: "reset", description: "reset" }], run: async () => { count++; return "done"; } };
  const h = harness(t, [], undefined, [section]);
  const pending = h.run("computer");
  const panel = h.panel(); panel.handleInput!("\r");
  h.emit("session_shutdown"); await pending;
  panel.handleInput!("\r"); assert.equal(count, 0);
});

test("overrides default off and only change matching Codex Responses requests", () => {
  const body = deepFreeze(payload());
  assert.equal(transformControlledRequest(body, { model: model() }, controls, defaultControlState(controls)), body);
  const changed = transformControlledRequest(body, { model: model() }, controls, allOn) as any;
  assert.equal(changed.text.verbosity, "high");
  assert.equal(changed.input[0].content[0].detail, "original");
  assert.equal(changed.service_tier, "priority");
  assert.equal(changed.tools, body.tools);
  assert.equal(changed.prompt_cache_key, body.prompt_cache_key);
  for (const provider of ["anthropic", "openai", "other"]) assert.equal(transformControlledRequest(body, { model: model("gpt-6-astra", provider) }, controls, allOn), body);
  assert.equal(transformControlledRequest(body, { model: undefined }, controls, allOn), body);
  assert.equal(transformControlledRequest(body, { model: { ...model(), api: "openai-completions" } }, controls, allOn), body);
  assert.equal(transformControlledRequest(body, { model: model("gpt-5.6-luna") }, controls, allOn), body);
  for (const invalid of [null, [], "text", { model: "gpt-6-astra", messages: [] }]) assert.equal(transformControlledRequest(invalid, { model: model() }, controls, allOn), invalid);
});

test("unsupported overrides are skipped and marked n/a", () => {
  const oldModel = model("gpt-5.2");
  const body = { ...payload(), model: oldModel.id };
  const changed = transformControlledRequest(body, { model: oldModel }, controls, allOn) as any;
  assert.equal(changed.text.verbosity, "high");
  assert.equal(changed.input, body.input);
  assert.equal("service_tier" in changed, false);
  assert.match(controlStatus({ model: oldModel }, controls, allOn), /fast:on\(n\/a\)/);
  const unknown = { ...payload(), model: "unknown" };
  assert.equal(transformControlledRequest(unknown, { model: model("unknown") }, controls, allOn), unknown);
});

test("Space changes multiple settings without closing; values are already on disk before Esc", async t => {
  const h = harness(t);
  const pending = h.run("");
  const panel = h.panel();
  panel.handleInput!(" ");
  assert.equal(h.store.load()!.verbosity, "low");
  panel.handleInput!(" ");
  panel.handleInput!("\x1b[B");
  panel.handleInput!(" ");
  panel.handleInput!("\x1b[B");
  panel.handleInput!(" ");
  assert.deepEqual(h.store.load(), { ...allOn, verbosity: "medium" });
  assert.equal(h.closed(), 0);
  assert.match(panel.render(90).join("\n"), /Saved fast: on/);
  assert.match(h.statuses.get(CONTROL_STATUS)!, /verbosity:medium.*image-detail:original.*fast:on/);
  panel.handleInput!("\x1b");
  await pending;
  assert.equal(h.closed(), 1);
  assert.doesNotMatch(readFileSync(h.store.path, "utf8"), /image_url|Bearer|b64_json/);
});

test("subcommand opens the same panel focused on that setting; Enter also stays in the panel", async t => {
  const h = harness(t);
  const pending = h.run("fast");
  h.panel().handleInput!(" ");
  assert.equal(h.store.load()!.fast, "on");
  h.panel().handleInput!("\r");
  assert.equal(h.store.load()!.fast, "off");
  assert.equal(h.closed(), 0);
  h.panel().handleInput!("\x1b");
  await pending;
});

test("disk preferences survive extension recreation, new sessions, reload and branch navigation", async t => {
  const h = harness(t);
  await h.run("verbosity high");
  await h.run("image-detail on");
  await h.run("fast on");
  h.setBranch([]);
  h.setSession("new-empty-session", []);
  assert.equal((h.request() as any).service_tier, "priority");
  h.emit("session_start", { reason: "reload" });
  assert.equal((h.request() as any).text.verbosity, "high");
  h.emit("session_shutdown");
  const restarted = harness(t, [], h.store.path);
  assert.deepEqual(restarted.store.load(), allOn);
  assert.equal((restarted.request() as any).input[0].content[0].detail, "original");
});

test("non-Codex opens settings and saves inactive presets while keeping Codex-only footer/request gating", async t => {
  const h = harness(t);
  await h.run("fast on");
  const pending = h.run("");
  const oldPanel = h.panel();
  assert.equal(typeof h.wrapper(), "function");
  h.setModel(model("gpt-6-astra", "anthropic"));
  await pending;
  assert.equal(h.statuses.has(CONTROL_STATUS), false);
  assert.equal(h.footer(), undefined);
  assert.deepEqual((await h.complete(""))!.map(item => item.value), ["verbosity", "image-detail", "fast", "status"]);
  assert.equal(h.request(), undefined);
  await h.run("verbosity high");
  assert.match(h.notifications.at(-1)!.text, /Inactive.*n\/a/);
  oldPanel.handleInput!(" ");
  assert.equal(h.store.load()!.verbosity, "high");
  const otherPanel = h.run("verbosity");
  assert.match(h.panel().render(100).join("\n"), /n\/a/);
  h.panel().handleInput!(" ");
  assert.equal(h.store.load()!.verbosity, "off");
  h.panel().handleInput!("\x1b"); await otherPanel;
  await h.run("status");
  assert.match(h.notifications.at(-1)!.text, /fast:on.*\(n\/a\)/);
  h.setModel(model());
  assert.match(h.statuses.get(CONTROL_STATUS)!, /fast:on/);
  assert.equal(typeof h.footer(), "function");
  assert.deepEqual((await h.complete("verbosity h"))?.map(item => item.value), ["verbosity high"]);
  h.setModel(undefined);
  assert.equal(h.statuses.has(CONTROL_STATUS), false);
  const noModel = h.run("");
  assert.match(h.panel().render(100).join("\n"), /n\/a/);
  h.panel().handleInput!("\x1b"); await noModel;
});

test("registered slash completion stays visible across providers and stops after shutdown", async t => {
  const h = harness(t);
  const base = new CombinedAutocompleteProvider([{ name: CONTROL_COMMAND }, { name: "help" }], "/unused");
  const provider = h.wrapper()(base);
  const suggest = () => provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal });
  for (const selected of [model(), model("other", "anthropic"), undefined]) {
    h.setModel(selected);
    assert.ok((await suggest())?.items.some(item => item.value === CONTROL_COMMAND));
  }
  h.emit("session_shutdown");
  assert.deepEqual((await suggest())?.items.map(item => item.value), ["help"]);
  assert.equal(await h.complete(""), null);
});

test("failed save rolls back the displayed value, keeps the panel open and does not enable the override", async t => {
  const h = harness(t);
  await h.run("verbosity high");
  h.failPersist();
  const pending = h.run("fast");
  h.panel().handleInput!(" ");
  assert.equal(h.store.load()!.fast, "off");
  assert.equal("service_tier" in (h.request() as object), false);
  assert.match(h.panel().render(90).join("\n"), /Not saved: disk full/);
  assert.equal(h.closed(), 0);
  h.panel().handleInput!("\x1b");
  await pending;
});

test("headless requires explicit values; invalid arguments never overwrite preferences", async t => {
  const h = harness(t);
  h.setUI(false);
  await h.run("verbosity high");
  for (const args of ["", "verbosity", "fast", "verbosity ultra", "fast on extra", "unknown", "__proto__ on"]) await assert.rejects(h.run(args));
  assert.equal(h.store.load()!.verbosity, "high");
  h.failPersist();
  await assert.rejects(h.run("fast on"), /Not saved: disk full/);
});

test("old session preferences migrate once; old branches cannot override a global preference", async t => {
  const legacy = [saved(allOn), { type: "compaction", retainedTail: [] }, saved({ fast: "invalid" })];
  assert.deepEqual(restoreControlState(controls, legacy), allOn);
  const oldOff = harness(t, [saved(defaultControlState(controls))]);
  assert.deepEqual(oldOff.store.load(), defaultControlState(controls));
  oldOff.setSession("old-on-session", legacy);
  assert.equal(oldOff.store.load()!.fast, "off");
  const h = harness(t, legacy);
  assert.deepEqual(h.store.load(), allOn);
  await h.run("fast off");
  h.setSession("old-session", legacy);
  assert.equal(h.store.load()!.fast, "off");
  assert.equal("service_tier" in (h.request() as object), false);
});

test("shutdown/tree/reload close a panel and stale callbacks cannot save afterwards", async t => {
  for (const action of ["session", "tree", "reload"] as const) {
    const h = harness(t);
    const pending = h.run("verbosity");
    const panel = h.panel();
    if (action === "session") h.setSession("session-b", []);
    else if (action === "tree") h.setBranch([]);
    else { h.emit("session_shutdown"); h.emit("session_start"); }
    await pending;
    panel.handleInput!(" ");
    assert.equal(h.store.load(), undefined);
    assert.equal(h.request(), undefined);
  }
});

test("Shift+Tab thinking changes update the custom footer after a model selection", t => {
  const h = harness(t);
  h.setModel(model("gpt-5.5"));
  assert.match(h.renderFooter(), /gpt-5\.5 • low/);
  h.setThinkingLevel("high");
  assert.match(h.renderFooter(), /gpt-5\.5 • high/);
  assert.doesNotMatch(h.renderFooter(), /gpt-5\.5 • low/);
});

test("model event is authoritative; old requests cannot resurrect footer and completions remain universal", async t => {
  const h = harness(t);
  assert.equal(typeof h.footer(), "function");
  h.emit("model_select", { model: model("other-model", "anthropic") });
  assert.equal(h.footer(), undefined);
  assert.equal(h.statuses.has(CONTROL_STATUS), false);
  h.request(); // harness still supplies the old Codex context, as an in-flight request might.
  assert.equal(h.footer(), undefined);
  assert.ok((await h.complete(""))!.some(item => item.value === "status"));
});
